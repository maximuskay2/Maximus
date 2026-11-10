// Public installer downloads for the marketing page: lists the packaged
// desktop builds in the release dir and streams them. Unauthenticated by
// design — answered before the auth gate, like the console public routes.
import { createReadStream, promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join } from "node:path";

type Json = (res: ServerResponse, status: number, body: unknown) => void;

export type DownloadOs = "mac" | "windows" | "linux";

export interface DownloadFile {
  os: DownloadOs;
  arch: string | null;
  kind: "installer" | "image" | "package";
  file: string;
  bytes: number;
}

export interface DownloadDeps {
  releaseDir: string;
  version: string;
}

const BUILD = /^Maximus-(.+)\.(dmg|exe|AppImage|deb)$/;
const DEB = /^maximus_([\d.]+)_(\w+)\.deb$/;

function normalArch(tag: string): string | null {
  if (tag.endsWith("-arm64")) return "arm64";
  if (tag.endsWith("-x64") || tag.endsWith("-x86_64") || tag.endsWith("-amd64")) return "x64";
  return null;
}

const MIME: Record<string, string> = {
  dmg: "application/x-apple-diskimage",
  exe: "application/vnd.microsoft.portable-executable",
  AppImage: "application/octet-stream",
  deb: "application/vnd.debian.binary-package",
};

/** Zips are update-feed artifacts (and the mac/win x64 zips share a name), so only user-facing builds list. */
export function classifyDownload(name: string): { os: DownloadOs; arch: string | null; kind: DownloadFile["kind"] } | null {
  const deb = DEB.exec(name);
  if (deb) return { os: "linux", arch: deb[2]!, kind: "package" };
  const build = BUILD.exec(name);
  if (!build) return null;
  const [, tag, ext] = build as unknown as [string, string, string];
  const arch = normalArch(tag);
  if (ext === "dmg") return { os: "mac", arch, kind: "image" };
  if (ext === "exe") return tag.includes("setup") ? { os: "windows", arch: arch ?? "x64", kind: "installer" } : null;
  if (ext === "AppImage") return { os: "linux", arch: arch ?? "x64", kind: "installer" };
  if (ext === "deb") return { os: "linux", arch: arch ?? "x64", kind: "package" };
  return null;
}

export async function listDownloads(releaseDir: string): Promise<DownloadFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(releaseDir);
  } catch {
    return [];
  }
  const order: Record<DownloadOs, number> = { mac: 0, windows: 1, linux: 2 };
  const files: DownloadFile[] = [];
  for (const name of names.sort()) {
    const kind = classifyDownload(name);
    if (!kind) continue;
    try {
      const stat = await fs.stat(join(releaseDir, name));
      if (!stat.isFile()) continue;
      files.push({ ...kind, file: name, bytes: stat.size });
    } catch {
      continue;
    }
  }
  return files.sort((a, b) => order[a.os] - order[b.os] || a.file.localeCompare(b.file));
}

export function createDownloadsRoute(deps: DownloadDeps): (
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  method: string,
  json: Json,
) => Promise<boolean> {
  return async (_req, res, path, method, json): Promise<boolean> => {
    if (method === "GET" && path === "/api/downloads") {
      res.setHeader("cache-control", "no-store");
      json(res, 200, { version: deps.version, files: await listDownloads(deps.releaseDir) });
      return true;
    }
    const prefix = "/api/downloads/file/";
    if ((method === "GET" || method === "HEAD") && path.startsWith(prefix)) {
      const name = decodeURIComponent(path.slice(prefix.length));
      if (basename(name) !== name || !classifyDownload(name)) {
        json(res, 404, { error: "no such download" });
        return true;
      }
      let stat;
      try {
        stat = await fs.stat(join(deps.releaseDir, name));
        if (!stat.isFile()) throw new Error("not a file");
      } catch {
        json(res, 404, { error: "no such download" });
        return true;
      }
      const ext = name.split(".").pop() ?? "";
      res.writeHead(200, {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "content-length": stat.size,
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      if (method === "HEAD") {
        res.end();
        return true;
      }
      await new Promise<void>((resolve) => {
        const stream = createReadStream(join(deps.releaseDir, name));
        stream.once("error", () => { res.destroy(); resolve(); });
        stream.pipe(res);
        res.once("finish", () => resolve());
      });
      return true;
    }
    return false;
  };
}
