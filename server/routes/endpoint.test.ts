import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import { createEndpointRoute, endpointState } from "./endpoint.ts";

function setup(options: { env?: NodeJS.ProcessEnv; settings?: string; isPackaged?: boolean; up?: string[] } = {}) {
  let settings = options.settings ?? "";
  const calls: { status: number; body: unknown }[] = [];
  const res = { setHeader: () => undefined } as unknown as ServerResponse;
  const json = (_res: ServerResponse, status: number, body: unknown): void => {
    calls.push({ status, body });
  };
  const req = { url: "/", headers: {} } as IncomingMessage;
  const up = new Set(options.up ?? []);
  const fetchImpl = (async (input: string | URL | Request) => ({ ok: up.has(String(input).replace(/\/api\/health$/, "")) })) as unknown as typeof fetch;
  const route = createEndpointRoute({
    env: options.env ?? {},
    isPackaged: options.isPackaged ?? true,
    readSettings: () => settings,
    saveSettings: (url) => { settings = url; },
    fetchImpl,
  });
  const readBody = (body: unknown) => async () => body;
  return { req, res, calls, json, route, readBody, settings: () => settings };
}

describe("control-plane endpoint", () => {
  it("resolves env, then settings, then the packaged default", () => {
    expect(endpointState({ env: { MAXIMUS_CONTROL_PLANE_URL: "https://svc.example" }, isPackaged: true, readSettings: () => "http://127.0.0.1:8787" }))
      .toMatchObject({ url: "https://svc.example", source: "env", managedByEnv: true });
    expect(endpointState({ env: {}, isPackaged: true, readSettings: () => "http://127.0.0.1:8787" }))
      .toMatchObject({ url: "http://127.0.0.1:8787", source: "settings", managedByEnv: false });
    expect(endpointState({ env: {}, isPackaged: true, readSettings: () => "" }))
      .toMatchObject({ url: "https://accounts.meetnote.cc", source: "production" });
    expect(endpointState({ env: {}, isPackaged: false, readSettings: () => "" }))
      .toMatchObject({ url: "", source: "none" });
    expect(endpointState({ env: {}, isPackaged: true, readSettings: () => "notaurl" }))
      .toMatchObject({ url: "https://accounts.meetnote.cc", source: "production" });
  });

  it("serves the current endpoint and declines other paths", async () => {
    const { req, res, calls, json, route, readBody } = setup({ settings: "http://127.0.0.1:8787" });
    expect(await route(req, res, "/api/other", "GET", json, readBody(null))).toBe(false);
    expect(await route(req, res, "/api/auth/endpoint", "GET", json, readBody(null))).toBe(true);
    expect(calls[0]?.status).toBe(200);
    expect(calls[0]?.body).toMatchObject({ url: "http://127.0.0.1:8787", source: "settings" });
  });

  it("saves presets, validates custom addresses, and probes them", async () => {
    const { req, res, calls, json, route, readBody, settings } = setup({ up: ["http://127.0.0.1:8787"] });
    expect(await route(req, res, "/api/auth/endpoint", "POST", json, readBody({ preset: "local" }))).toBe(true);
    expect(calls[0]?.status).toBe(200);
    expect(settings()).toBe("http://127.0.0.1:8787");
    expect(await route(req, res, "/api/auth/endpoint", "POST", json, readBody({ preset: "production" }))).toBe(true);
    expect(settings()).toBe("");
    expect(await route(req, res, "/api/auth/endpoint", "POST", json, readBody({ url: "http://example.com/evil?q=1" }))).toBe(true);
    expect(calls[2]?.status).toBe(400);
    expect(await route(req, res, "/api/auth/endpoint", "POST", json, readBody({ url: "http://127.0.0.1:9999" }))).toBe(true);
    expect(calls[3]).toMatchObject({ status: 400, body: { code: "endpoint_unreachable" } });
    expect(await route(req, res, "/api/auth/endpoint", "POST", json, readBody({ url: "http://127.0.0.1:8787/" }))).toBe(true);
    expect(calls[4]?.status).toBe(200);
    expect(settings()).toBe("http://127.0.0.1:8787");
  });

  it("refuses changes while the environment owns the address", async () => {
    const { req, res, calls, json, route, readBody } = setup({ env: { MAXIMUS_CONTROL_PLANE_URL: "https://svc.example" } });
    expect(await route(req, res, "/api/auth/endpoint", "POST", json, readBody({ preset: "local" }))).toBe(true);
    expect(calls[0]).toMatchObject({ status: 409, body: { code: "endpoint_env_managed" } });
  });
});
