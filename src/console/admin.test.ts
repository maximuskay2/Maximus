import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AdminPlan } from "./harness";
import { OverviewView } from "./admin/OverviewPage";
import { PlanModal, planFormOf, planInputOf, validatePlanForm } from "./admin/PlansPage";
import { DashboardShell, dashboardViewFromParam } from "./admin/Shell";
import { DataTable, MetricCard, pageRows, sortRows, Sparkline, sparkTrend } from "./admin/ui";
import { buildUserRows, filterUserRows, UserModal, validateUserEntry, validAccessEntry } from "./admin/UsersPage";

const noop = (): void => undefined;

describe("dashboard shell", () => {
  it("reads the view param and falls back to overview", () => {
    expect(dashboardViewFromParam("users")).toBe("users");
    expect(dashboardViewFromParam("keys")).toBe("keys");
    expect(dashboardViewFromParam("nope")).toBe("overview");
    expect(dashboardViewFromParam(null)).toBe("overview");
  });

  it("renders sidebar links, the header, and logout", () => {
    const html = renderToStaticMarkup(createElement(DashboardShell, {
      view: "users",
      onView: noop,
      identity: "ada@example.com",
      onLogout: noop,
      children: "body",
    }));
    expect(html).toContain("ada@example.com");
    expect(html).toContain("Users");
    expect(html).toContain("aria-current=\"page\"");
    expect(html).toContain("body");
  });
});

describe("dashboard widgets", () => {
  it("sorts and pages table rows without mutating", () => {
    const rows = [{ id: "b", name: "b" }, { id: "a", name: "a" }, { id: "c", name: "c" }];
    const valueOf = (row: { id: string; name: string }): string => row.name;
    expect(sortRows(rows, null, "asc", valueOf)).toEqual(rows);
    expect(sortRows(rows, "name", "asc", valueOf).map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(sortRows(rows, "name", "desc", valueOf).map((row) => row.id)).toEqual(["c", "b", "a"]);
    expect(rows.map((row) => row.id)).toEqual(["b", "a", "c"]);
    expect(pageRows(rows, 0, 2)).toHaveLength(2);
    expect(pageRows(rows, 1, 2)).toHaveLength(1);
    expect(pageRows(rows, 5, 2)).toEqual([]);
  });

  it("reads trends off halves and renders cards, sparklines, and tables", () => {
    expect(sparkTrend([1, 1, 10, 10]).direction).toBe("up");
    expect(sparkTrend([10, 10, 1, 1]).direction).toBe("down");
    expect(sparkTrend([5, 5, 5, 5]).direction).toBe("flat");
    expect(sparkTrend([1]).direction).toBe("flat");
    expect(sparkTrend([null, null, null, null]).direction).toBe("flat");
    const card = renderToStaticMarkup(createElement(MetricCard, { label: "Users", value: "12", trend: { direction: "up", text: "+9%" } }));
    expect(card).toContain("12");
    const spark = renderToStaticMarkup(createElement(Sparkline, { values: [1, 2, 3], label: "trend" }));
    expect(spark).toContain("<svg");
    const table = renderToStaticMarkup(createElement(DataTable<{ id: string; name: string }>, {
      labelledBy: "t",
      columns: [
        { key: "name", header: "Name", sortable: true, render: (row) => row.name },
        { key: "static", header: "Static", render: () => "x" },
      ],
      rows: [{ id: "a", name: "Ada" }],
      emptyTitle: "Empty",
      valueOf: (row) => row.name,
    }));
    expect(table).toContain("Ada");
    const empty = renderToStaticMarkup(createElement(DataTable<{ id: string }>, {
      labelledBy: "t",
      columns: [],
      rows: [],
      emptyTitle: "Nothing here",
      valueOf: () => "",
    }));
    expect(empty).toContain("Nothing here");
  });
});

describe("overview view", () => {
  it("renders metrics, the trend, and recent activity", () => {
    const html = renderToStaticMarkup(createElement(OverviewView, {
      loading: false,
      error: null,
      model: {
        metrics: { totalUsers: 3, activeSessions: 1, bots: 2, workspaces: 1, monthTokens: "1,000 tokens", monthCost: "$0.25" },
        trend: [1, 2, 3, 4],
        trendLabel: "Tokens per day",
        activity: [{ id: "a1", category: "session", action: "session.revoke", summary: "ada@example.com", createdAt: 7 }],
        edition: "maximus",
        healthy: true,
      },
    }));
    expect(html).toContain("1,000 tokens");
    expect(html).toContain("session.revoke");
    expect(html).toContain("<svg");
    const loading = renderToStaticMarkup(createElement(OverviewView, { loading: true, error: null, model: null }));
    expect(loading).toContain('role="status"');
  });
});

describe("users view", () => {
  const lists = { admins: ["ada@example.com"], members: ["@example.com"] };

  it("merges access, sessions, and members into searchable rows", () => {
    const rows = buildUserRows({
      lists,
      sessions: [{ id: "s1", label: "Laptop", email: "ada@example.com", scopes: ["admin", "client"], expiresAt: 9, current: true }],
      members: [{ email: "c@d.co", role: "member" }],
      usage: [{ key: "ada@example.com", label: "ada@example.com", input: 10, output: 5, costUsd: 0.25 }],
    });
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.id === "session:s1")).toMatchObject({ role: "admin", current: true, usage: "$0.25" });
    expect(filterUserRows(rows, "laptop")).toHaveLength(1);
    expect(filterUserRows(rows, "member")).toHaveLength(2);
    expect(filterUserRows(rows, "")).toHaveLength(4);
    expect(filterUserRows(rows, "nobody")).toHaveLength(0);
  });

  it("validates allow-list entries like the server matcher", () => {
    expect(validAccessEntry("ada@example.com")).toBe(true);
    expect(validAccessEntry("@example.com")).toBe(true);
    expect(validAccessEntry("nope")).toBe(false);
    expect(validAccessEntry("@nope")).toBe(false);
    expect(validateUserEntry("new@example.com", lists)).toBeNull();
    expect(validateUserEntry("ada@example.com", lists)).toBe("console.dashboard.userTaken");
    expect(validateUserEntry("ada@example.com", lists, "ada@example.com")).toBeNull();
    expect(validateUserEntry("nope", lists)).toBe("console.dashboard.userInvalid");
  });

  it("renders the add and edit modal", () => {
    const add = renderToStaticMarkup(createElement(UserModal, { original: null, lists, busy: false, serverError: null, onClose: noop, onSubmit: noop }));
    expect(add).toContain("dashboard-user-email");
    expect(add).toContain('role="dialog"');
    const edit = renderToStaticMarkup(createElement(UserModal, {
      original: { email: "ada@example.com", role: "admin" },
      lists,
      busy: false,
      serverError: "boom",
      onClose: noop,
      onSubmit: noop,
    }));
    expect(edit).toContain("ada@example.com");
    expect(edit).toContain("boom");
  });

  it("validates plan forms like the server", () => {
    const team: AdminPlan = { id: "team", name: "Team", blurb: "", features: [], baseUsd: 20, allowanceUsd: 20, hardCapUsd: null, entitlements: [], source: "stored", editable: true };
    const existing = [team];
    const good = planFormOf(team);
    expect(validatePlanForm(good, [...existing], "team")).toBeNull();
    expect(validatePlanForm({ ...good, id: "Bad!" }, [], null)).toBe("console.dashboard.planInvalidId");
    const freeRow: AdminPlan = { ...team, id: "free", name: "Free", baseUsd: 0, allowanceUsd: 0, source: "builtin" };
    expect(validatePlanForm({ ...good, id: "free" }, [freeRow], null)).toBe("console.dashboard.planTaken");
    expect(validatePlanForm(planFormOf(freeRow), [freeRow], "free")).toBeNull();
    expect(validatePlanForm({ ...good, id: "team" }, [...existing], null)).toBe("console.dashboard.planTaken");
    expect(validatePlanForm({ ...good, name: " " }, [], null)).toBe("console.dashboard.planInvalidName");
    expect(validatePlanForm({ ...good, baseUsd: "-1" }, [], null)).toBe("console.dashboard.planInvalidMoney");
    expect(validatePlanForm({ ...good, hardCapUsd: "5" }, [], null)).toBe("console.dashboard.planInvalidCap");
    expect(planInputOf(good)).toMatchObject({ id: "team", baseUsd: 20, allowanceUsd: 20, hardCapUsd: null });
    expect(planInputOf({ ...good, hardCapUsd: "50" }).hardCapUsd).toBe(50);
  });

  it("renders the plan modal", () => {
    const html = renderToStaticMarkup(createElement(PlanModal, {
      original: null,
      existing: [],
      busy: false,
      serverError: null,
      onClose: noop,
      onSubmit: noop,
    }));
    expect(html).toContain("dashboard-plan-id");
    expect(html).toContain("dashboard-plan-features");
    expect(html).toContain('role="dialog"');
  });

  it("keeps shell callbacks wired", () => {
    const onView = vi.fn();
    const html = renderToStaticMarkup(createElement(DashboardShell, { view: "overview", onView, identity: "", onLogout: noop, children: null }));
    expect(html).toContain("Overview");
    expect(onView).not.toHaveBeenCalled();
  });
});
