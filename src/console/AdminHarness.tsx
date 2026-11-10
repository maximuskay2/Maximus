import { useState } from "react";

import { t } from "../lib/i18n";
import type { ConfigStatus } from "../state/config-status";
import { KEY_CATALOG, KEY_SECTIONS, type KeyEntry, type SavedState } from "../components/keys/key-catalog";
import { formatWhen } from "./AdminPage";
import {
  HarnessError,
  type HarnessBotView,
  type HarnessMessageView,
  type HarnessPairing,
  type SignInLists,
} from "./harness";

const muted = "text-[13px] text-ink-secondary";
const textInput = "w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px] outline-none focus:border-accent-border";
const smallButton = "rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50";
const dangerLink = "text-[13px] text-danger underline disabled:opacity-50";

function keyEntries(): KeyEntry[] {
  return KEY_CATALOG.filter((entry) => entry.kind === "key" && entry.target);
}

export function keySavedState(entry: KeyEntry, config: unknown): SavedState {
  const status = config as unknown as ConfigStatus;
  try {
    if (entry.status) return entry.status(status);
    return entry.target?.saved(status) ?? { configured: false };
  } catch {
    return { configured: false };
  }
}

export function AccessLists({ lists, busy, onSave }: {
  lists: SignInLists;
  busy: boolean;
  onSave: (next: SignInLists) => void;
}) {
  const [admins, setAdmins] = useState(lists.admins.join("\n"));
  const [members, setMembers] = useState(lists.members.join("\n"));
  const [draft, setDraft] = useState(lists);
  if (draft !== lists) {
    setDraft(lists);
    setAdmins(lists.admins.join("\n"));
    setMembers(lists.members.join("\n"));
  }
  const parse = (value: string): string[] => value.split(/[\n,]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="block text-[12px] font-medium text-ink-secondary" htmlFor="harness-admins">{t("console.harness.admins")}</label>
          <textarea id="harness-admins" rows={4} className={`${textInput} mt-1 font-mono text-[13px]`} value={admins} disabled={busy} spellCheck={false}
            onChange={(event) => setAdmins(event.target.value)} />
        </div>
        <div>
          <label className="block text-[12px] font-medium text-ink-secondary" htmlFor="harness-members">{t("console.harness.members")}</label>
          <textarea id="harness-members" rows={4} className={`${textInput} mt-1 font-mono text-[13px]`} value={members} disabled={busy} spellCheck={false}
            onChange={(event) => setMembers(event.target.value)} />
        </div>
      </div>
      <p className={`mt-1 ${muted}`}>{t("console.harness.allowHint")}</p>
      <button type="button" className={`${smallButton} mt-3`} disabled={busy}
        onClick={() => onSave({ admins: parse(admins), members: parse(members) })}>
        {t("console.harness.saveAccess")}
      </button>
    </div>
  );
}

export function PairingPanel({ pairings, busy, onCreate }: {
  pairings: HarnessPairing[];
  busy: boolean;
  onCreate: (label: string) => void;
}) {
  const [label, setLabel] = useState("");
  return (
    <div className="mt-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(label.trim());
          setLabel("");
        }}
      >
        <div className="min-w-[200px] flex-1">
          <label className="block text-[12px] font-medium text-ink-secondary" htmlFor="harness-pair-label">{t("console.harness.pairLabel")}</label>
          <input id="harness-pair-label" className={`${textInput} mt-1`} value={label} disabled={busy} maxLength={80}
            onChange={(event) => setLabel(event.target.value)} />
        </div>
        <button type="submit" className={smallButton} disabled={busy}>{t("console.harness.pairCreate")}</button>
      </form>
      {pairings.length === 0 ? (
        <p className={`mt-2 ${muted}`}>{t("console.harness.noPairings")}</p>
      ) : (
        <ul className="mt-3 space-y-2 text-[14px]">
          {pairings.map((pairing) => (
            <li key={pairing.code} className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="font-mono text-[13px]">{pairing.code}</span>
              <span className={muted}>{[pairing.label, pairing.expiresAt ? formatWhen(pairing.expiresAt) : ""].filter(Boolean).join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function KeysManager({ config, busy, onSave }: {
  config: Record<string, unknown>;
  busy: boolean;
  onSave: (entry: KeyEntry, value: string, firstKey: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const entries = keyEntries();
  return (
    <div className="mt-3 space-y-6">
      {KEY_SECTIONS.map((section) => {
        const rows = entries.filter((entry) => entry.section === section.id);
        if (rows.length === 0) return null;
        return (
          <div key={section.id}>
            <h3 className="text-[14px] font-medium">{t(section.titleKey)}</h3>
            <ul className="mt-2 space-y-3">
              {rows.map((entry) => {
                const state = keySavedState(entry, config);
                const draft = drafts[entry.id] ?? "";
                return (
                  <li key={entry.id} className="rounded-md border border-hairline/40 px-3 py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[14px] font-medium">{t(entry.labelKey)}</span>
                      <span className={muted}>
                        {state.configured ? t("console.harness.keySet") : t("console.harness.keyMissing")}
                        {state.configured && state.last4 ? ` ··${state.last4}` : ""}
                      </span>
                    </div>
                    <p className={muted}>{t(entry.purposeKey)}</p>
                    <form
                      className="mt-2 flex flex-wrap gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!draft.trim()) return;
                        onSave(entry, draft.trim(), !state.configured);
                        setDrafts((current) => ({ ...current, [entry.id]: "" }));
                      }}
                    >
                      <input
                        aria-label={t(entry.labelKey)}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        className={`${textInput} min-w-[200px] flex-1 font-mono text-[13px]`}
                        placeholder={entry.target?.placeholder ?? "…"}
                        value={draft}
                        disabled={busy}
                        onChange={(event) => setDrafts((current) => ({ ...current, [entry.id]: event.target.value }))}
                      />
                      <button type="submit" className={smallButton} disabled={busy || !draft.trim()}>{t("console.harness.keySave")}</button>
                      {state.configured && (
                        <button
                          type="button"
                          className={dangerLink}
                          disabled={busy}
                          onClick={() => {
                            onSave(entry, "", false);
                            setDrafts((current) => ({ ...current, [entry.id]: "" }));
                          }}
                        >
                          {t("console.harness.keyRemove")}
                        </button>
                      )}
                    </form>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function MessagesManager({ bots, busy, onRead, onSend }: {
  bots: HarnessBotView[];
  busy: boolean;
  onRead: (botId: string, threadId: string) => Promise<HarnessMessageView[]>;
  onSend: (botId: string, threadId: string, text: string) => Promise<void>;
}) {
  const [botId, setBotId] = useState(bots[0]?.id ?? "");
  const [threadId, setThreadId] = useState("");
  const [messages, setMessages] = useState<HarnessMessageView[]>([]);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const bot = bots.find((row) => row.id === botId) ?? null;
  const threads = bot?.threads ?? [];
  const activeThread = threadId || bot?.threadId || threads[0]?.threadId || "";
  if (bots.length > 0 && !bot) {
    const first = bots[0]!;
    setBotId(first.id);
    setThreadId("");
    setMessages([]);
  }
  const refresh = (nextBot: string, nextThread: string): void => {
    if (!nextBot || !nextThread) return;
    setNotice(null);
    onRead(nextBot, nextThread).then(setMessages, (thrown: unknown) => {
      setMessages([]);
      setNotice(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong"));
    });
  };
  if (bots.length === 0) return <p className={`mt-2 ${muted}`}>{t("console.harness.noBots")}</p>;
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <select aria-label={t("console.harness.bot")} className="rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px]" value={botId} disabled={busy}
          onChange={(event) => {
            setBotId(event.target.value);
            setThreadId("");
            setMessages([]);
          }}>
          {bots.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        <select aria-label={t("console.harness.thread")} className="min-w-[200px] rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px]" value={activeThread} disabled={busy || threads.length === 0}
          onChange={(event) => {
            setThreadId(event.target.value);
            refresh(botId, event.target.value);
          }}>
          {threads.map((thread) => <option key={thread.threadId} value={thread.threadId}>{thread.title}</option>)}
        </select>
        <button type="button" className="rounded-md border border-hairline/40 px-3 py-2 text-[13px] text-ink-secondary disabled:opacity-50"
          disabled={busy || !activeThread} onClick={() => refresh(botId, activeThread)}>
          {t("console.harness.read")}
        </button>
      </div>
      {notice && <p role="alert" className="mt-3 text-[13px] text-danger">{notice}</p>}
      <ul className="mt-3 max-h-[320px] space-y-2 overflow-y-auto text-[13px]">
        {messages.map((message) => (
          <li key={message.id} className="rounded-md border border-hairline/40 px-3 py-2">
            <span className="font-medium">{message.role}</span>
            <span className="text-ink-secondary"> · {message.kind}</span>
            {message.text ? <p className="mt-1 whitespace-pre-wrap break-words">{message.text.slice(0, 2000)}</p> : null}
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim() || !activeThread) return;
          const outgoing = text.trim();
          setText("");
          setNotice(null);
          onSend(botId, activeThread, outgoing).then(
            () => refresh(botId, activeThread),
            (thrown: unknown) => setNotice(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong")),
          );
        }}
      >
        <input aria-label={t("console.harness.sendLabel")} className={`${textInput} min-w-[240px] flex-1`} value={text} disabled={busy || !activeThread}
          onChange={(event) => setText(event.target.value)} />
        <button type="submit" className={smallButton} disabled={busy || !text.trim() || !activeThread}>{t("console.harness.send")}</button>
      </form>
    </div>
  );
}
