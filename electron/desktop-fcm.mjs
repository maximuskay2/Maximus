import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SENDER = /^[0-9]{5,20}$/;
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

function loadReceiver() {
  try {
    return require(path.join(here, "vendor/push-receiver.cjs"));
  } catch {
    try {
      return require("push-receiver");
    } catch {
      return null;
    }
  }
}

function payloadOf(message) {
  const note = message && typeof message === "object" ? message.notification ?? message : null;
  const data = note && typeof note === "object" && note.data && typeof note.data === "object" ? note.data : {};
  const title = typeof note?.title === "string" ? note.title : typeof data.title === "string" ? data.title : "";
  const body = typeof note?.body === "string" ? note.body : typeof data.body === "string" ? data.body : "";
  const botId = typeof data.botId === "string" ? data.botId : "";
  const threadId = typeof data.threadId === "string" ? data.threadId : "";
  return { title, body, botId, threadId };
}

/**
 * @param {{ ipcMain: { handle(channel: string, handler: Function): void },
 *   userData: string,
 *   onMessage: (note: { title: string, body: string, botId: string, threadId: string }) => void,
 *   registerImpl?: (senderId: string, creds: unknown) => Promise<{ fcm?: { token?: string } }>,
 *   listenImpl?: (creds: unknown, onNote: Function) => Promise<unknown>,
 *   read?: typeof fs.readFileSync,
 *   write?: typeof fs.writeFileSync,
 * }} deps
 */
export function installDesktopFcm(deps) {
  const file = path.join(deps.userData, "fcm-credentials.json");
  const read = deps.read ?? ((target) => fs.readFileSync(target, "utf8"));
  const write = deps.write ?? ((target, text) => fs.writeFileSync(target, text));
  let listening = false;

  const stored = () => {
    try {
      return JSON.parse(read(file));
    } catch {
      return null;
    }
  };

  deps.ipcMain.handle("desktop-fcm:token", async (_event, senderId) => {
    if (!SENDER.test(String(senderId ?? ""))) return null;
    const receiver = loadReceiver();
    const register = deps.registerImpl ?? receiver?.register;
    const listen = deps.listenImpl ?? receiver?.listen;
    if (typeof register !== "function") return null;
    let credentials = stored();
    if (!credentials?.fcm?.token) {
      credentials = await register(String(senderId));
      if (!credentials?.fcm?.token) return null;
      write(file, JSON.stringify(credentials));
    }
    if (!listening && typeof listen === "function") {
      listening = true;
      void listen(credentials, (message) => {
        const note = payloadOf(message);
        if (note.title && note.botId && note.threadId) deps.onMessage(note);
      }).catch(() => { listening = false; });
    }
    return credentials.fcm.token;
  });
}
