import { describe, expect, it } from "vitest";

import { defaultSentinelOut, isInside } from "./paths.ts";

describe("sentinel paths", () => {
  it("keeps Sentinel's files in the platform's state folder, outside the data dir", () => {
    expect(defaultSentinelOut("/Users/maus/.maximus", "darwin", "/Users/maus", {})).toBe("/Users/maus/Library/Application Support/maximus-sentinel");
    expect(defaultSentinelOut("/home/maus/.maximus", "linux", "/home/maus", {})).toBe("/home/maus/.local/state/maximus-sentinel");
    expect(defaultSentinelOut("/home/maus/.maximus", "linux", "/home/maus", { XDG_STATE_HOME: "/var/state/maus" })).toBe("/var/state/maus/maximus-sentinel");
    // a relative XDG_STATE_HOME is invalid by the spec and ignored
    expect(defaultSentinelOut("/home/maus/.maximus", "linux", "/home/maus", { XDG_STATE_HOME: "state" })).toBe("/home/maus/.local/state/maximus-sentinel");
    expect(defaultSentinelOut("C:\\Users\\maus\\.maximus", "win32", "C:\\Users\\maus", { LOCALAPPDATA: "D:\\Local" })).toBe("D:\\Local\\maximus-sentinel");
  });

  it("gives any other data dir its own subfolder, the same one every time", () => {
    const other = defaultSentinelOut("/srv/maximus-data", "linux", "/home/maus", {});
    expect(other).toMatch(/^\/home\/maus\/\.local\/state\/maximus-sentinel\/data-[0-9a-f]{12}$/);
    expect(defaultSentinelOut("/srv/maximus-data", "linux", "/home/maus", {})).toBe(other);
    expect(defaultSentinelOut("/srv/maximus-data-2", "linux", "/home/maus", {})).not.toBe(other);
  });

  it("knows when a folder is inside another", () => {
    expect(isInside("/d/maximus/sentinel", "/d/maximus", "linux")).toBe(true);
    expect(isInside("/d/maximus", "/d/maximus", "linux")).toBe(true);
    expect(isInside("/d/maximus-sentinel", "/d/maximus", "linux")).toBe(false);
    expect(isInside("/d", "/d/maximus", "linux")).toBe(false);
    expect(isInside("C:\\d\\maximus\\x", "C:\\d\\maximus", "win32")).toBe(true);
  });
});
