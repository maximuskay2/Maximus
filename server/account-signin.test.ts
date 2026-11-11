import { describe, expect, it } from "vitest";

import { allowedScopes, createEmailSignIn, parseAllowList, sessionScopesForEmail, signInEnabled } from "./account-signin.ts";
import { startControlPlaneStub } from "./testing/control-plane-stub.ts";

describe("the sign-in allow-list", () => {
  it("splits on commas, spaces and newlines and ignores case", () => {
    expect(parseAllowList(" Her@Example.test, @Agentada.test\nstaff@example.test ")).toEqual(["her@example.test", "@agentada.test", "staff@example.test"]);
    expect(parseAllowList(undefined)).toEqual([]);
  });

  it("maps addresses and @domains to scopes, and never matches a look-alike domain", () => {
    const list = { admins: ["her@example.test", "@agentada.test"], members: ["staff@example.test", "@partner.test"] };
    expect(allowedScopes("HER@example.test", list)).toEqual(["admin", "client"]);
    expect(allowedScopes("anyone@agentada.test", list)).toEqual(["admin", "client"]);
    expect(allowedScopes("staff@example.test", list)).toEqual(["client"]);
    expect(allowedScopes("x@partner.test", list)).toEqual(["client"]);
    expect(allowedScopes("x@evilagentada.test", list)).toBeNull();
    expect(allowedScopes("x@agentada.test.evil", list)).toBeNull();
    expect(allowedScopes("@agentada.test", list)).toBeNull();
    expect(allowedScopes("stranger@example.test", list)).toBeNull();
    expect(signInEnabled(list)).toBe(true);
    expect(signInEnabled({ admins: [], members: [] })).toBe(false);
  });

  it("keeps a password account signed in when that email is off the OTP allow-list", () => {
    const empty = { admins: [] as string[], members: [] as string[] };
    const owner = { email: "owner@example.test", salt: "aa", hash: "bb", createdAt: 1 };
    const member = { email: "member@example.test", salt: "cc", hash: "dd", createdAt: 2 };
    expect(sessionScopesForEmail("member@example.test", empty, [owner, member])).toEqual(["client"]);
    expect(sessionScopesForEmail("owner@example.test", empty, [owner, member])).toEqual(["admin", "client"]);
    expect(sessionScopesForEmail("owner@example.test", { admins: [], members: ["owner@example.test"] }, [owner, member])).toEqual(["admin", "client"]);
    expect(sessionScopesForEmail("stranger@example.test", empty, [owner, member])).toBeNull();
    expect(sessionScopesForEmail("her@example.test", { admins: ["her@example.test"], members: [] }, [member])).toEqual(["admin", "client"]);
  });
});

describe("the exchange with the control plane", () => {
  it("sends a code only to welcome addresses, turns the right code into scopes, and explains the wrong one", async () => {
    const stub = await startControlPlaneStub();
    try {
      const signIn = createEmailSignIn({
        allow: { admins: ["her@example.test"], members: ["@team.test"] },
        env: { ...process.env, MAXIMUS_CONTROL_PLANE_URL: stub.url },
      });
      expect(signIn.enabled()).toBe(true);
      expect(await signIn.start("nobody@example.test")).toMatchObject({ ok: false, status: 403 });
      expect(await signIn.start("not an email")).toMatchObject({ ok: false, status: 400 });
      expect(stub.calls).not.toContain("POST /api/auth/email-otp/send-verification-otp");
      expect(await signIn.start("Her@Example.test")).toEqual({ ok: true });
      expect(stub.calls).toContain("POST /api/auth/email-otp/send-verification-otp");

      const wrong = await signIn.verify("her@example.test", "00000000");
      expect(wrong).toMatchObject({ ok: false, status: 401 });
      expect(wrong.ok ? "" : wrong.error).toMatch(/wrong or has expired/);
      expect(await signIn.verify("her@example.test", "12")).toMatchObject({ ok: false, status: 400 });
      expect(await signIn.verify("nobody@example.test", stub.otp)).toMatchObject({ ok: false, status: 403 });

      const admin = await signIn.verify("her@example.test", stub.otp);
      expect(admin).toEqual({ ok: true, email: "her@example.test", userId: "user_stub", scopes: ["admin", "client"] });
      const member = await signIn.verify("someone@team.test", stub.otp);
      expect(member).toMatchObject({ ok: true, scopes: ["client"] });
      await new Promise((r) => setTimeout(r, 50));
      expect(stub.calls.filter((call) => call === "POST /api/auth/sign-out").length).toBe(2);
    } finally {
      await stub.close();
    }
  });

  it("lets the first verified email claim an unclaimed install, then closes the door", async () => {
    const stub = await startControlPlaneStub();
    try {
      let claimed: string | null = null;
      let open = true;
      const signIn = createEmailSignIn({
        allow: { admins: [], members: [] },
        env: { ...process.env, MAXIMUS_CONTROL_PLANE_URL: stub.url },
        claimable: () => open,
        onClaim: (email) => { claimed = email; open = false; },
      });
      expect(signIn.enabled()).toBe(true);
      expect(await signIn.start("first@example.test")).toEqual({ ok: true });
      expect(await signIn.verify("first@example.test", "00000000")).toMatchObject({ ok: false, status: 401 });
      expect(claimed).toBeNull();
      const admin = await signIn.verify("first@example.test", stub.otp);
      expect(admin).toMatchObject({ ok: true, email: "first@example.test", scopes: ["admin", "client"] });
      expect(claimed).toBe("first@example.test");
      expect(signIn.enabled()).toBe(false);
      expect(await signIn.verify("second@example.test", stub.otp)).toMatchObject({ ok: false, status: 403 });
    } finally {
      await stub.close();
    }
  });

  it("follows the saved endpoint without a restart", async () => {
    const first = await startControlPlaneStub();
    const second = await startControlPlaneStub();
    try {
      let saved = first.url;
      const signIn = createEmailSignIn({
        allow: { admins: ["her@example.test"], members: [] },
        env: {},
        settingsURL: () => saved,
      });
      expect(await signIn.start("her@example.test")).toEqual({ ok: true });
      expect(first.calls).toContain("POST /api/auth/email-otp/send-verification-otp");
      expect(second.calls).not.toContain("POST /api/auth/email-otp/send-verification-otp");
      saved = second.url;
      expect(await signIn.start("her@example.test")).toEqual({ ok: true });
      expect(second.calls).toContain("POST /api/auth/email-otp/send-verification-otp");
    } finally {
      await first.close();
      await second.close();
    }
  });

  it("is off with an empty allow-list and says so when the sign-in service is down", async () => {
    const off = createEmailSignIn({ allow: () => ({ admins: [], members: [] }) });
    expect(off.enabled()).toBe(false);
    const down = createEmailSignIn({ allow: { admins: ["a@b.test"], members: [] }, env: { ...process.env, MAXIMUS_CONTROL_PLANE_URL: "http://127.0.0.1:9" } });
    expect(await down.start("a@b.test")).toMatchObject({ ok: false, status: 502 });
  });
});
