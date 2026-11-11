import { useEffect, useState } from "react";

import { t } from "../../lib/i18n";
import { AccessLists, KeysManager, MessagesManager } from "../AdminHarness";
import {
  harnessBots,
  harnessConfig,
  harnessDelivery,
  harnessEdition,
  harnessHealth,
  saveHarnessDelivery,
  harnessSendMessage,
  HARNESS_SIGN_IN,
  harnessSession,
  harnessThreadMessages,
  HarnessError,
  saveHarnessConfig,
  toSignInLists,
  type DeliveryView,
  type HarnessBotView,
  type HarnessSessionView,
  type SignInLists,
} from "../harness";
import { ConsoleError as ErrorBox } from "../shell";
import { LoadingState } from "./ui";

function NeedsSession() {
  return (
    <div>
      <p className="mt-3 text-[14px] text-ink-secondary">{t("console.harness.needsSession")}</p>
      <a href={HARNESS_SIGN_IN} className="mt-5 block w-full rounded-md bg-accent px-4 py-2 text-center text-[14px] font-medium text-accent-ink no-underline">
        {t("console.harness.openSignin")}
      </a>
    </div>
  );
}

function useHarnessAdmin(load: () => Promise<void>): { session: HarnessSessionView | null; loading: boolean; busy: boolean; error: string | null; setBusy: (busy: boolean) => void; fail: (thrown: unknown) => void } {
  const [session, setSession] = useState<HarnessSessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (thrown: unknown): void => {
    setError(thrown instanceof HarnessError ? thrown.message : t("console.somethingWrong"));
    setBusy(false);
  };
  useEffect(() => {
    let live = true;
    harnessSession().then((current) => {
      if (!live) return;
      setSession(current);
      if (current.kind === "none" || !current.admin) {
        setLoading(false);
        return;
      }
      load().then(() => {
        if (live) setLoading(false);
      }, (thrown: unknown) => {
        if (!live) return;
        fail(thrown);
        setLoading(false);
      });
    }, (thrown: unknown) => {
      if (!live) return;
      fail(thrown);
      setLoading(false);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { session, loading, busy, error, setBusy, fail };
}

export function KeysPage() {
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const { session, loading, busy, error, setBusy, fail } = useHarnessAdmin(async () => {
    setConfig(await harnessConfig());
  });
  if (loading) return <LoadingState />;
  if (!session || session.kind === "none") return <NeedsSession />;
  if (!session.admin) return <p className={`mt-3 text-[14px] text-ink-secondary`}>{t("console.harness.adminOnly")}</p>;
  return (
    <div>
      <p className="mb-4 text-[13px] text-ink-secondary">{t("console.harness.subtitle")}</p>
      <KeysManager
        config={config}
        busy={busy}
        onSave={(entry, value, firstKey) => {
          if (!entry.target) return;
          setBusy(true);
          const credential = window.ogb?.setCredential && entry.target.slot
            ? window.ogb.setCredential(entry.target.slot, value).then(() => harnessConfig())
            : saveHarnessConfig(entry.target.patch(value, firstKey));
          credential.then((next) => {
            setConfig(next);
            setBusy(false);
          }, fail);
        }}
      />
      <ErrorBox message={error} />
    </div>
  );
}

export function MessagesPage() {
  const [bots, setBots] = useState<HarnessBotView[]>([]);
  const { session, loading, busy, error } = useHarnessAdmin(async () => {
    setBots(await harnessBots().then((answer) => answer.bots));
  });
  if (loading) return <LoadingState />;
  if (!session || session.kind === "none") return <NeedsSession />;
  if (!session.admin) return <p className={`mt-3 text-[14px] text-ink-secondary`}>{t("console.harness.adminOnly")}</p>;
  return (
    <div>
      <p className="mb-4 text-[13px] text-ink-secondary">{t("console.harness.subtitle")}</p>
      <MessagesManager
        bots={bots}
        busy={busy}
        onRead={(_botId, threadId) => harnessThreadMessages(threadId, 50).then((answer) => answer.messages)}
        onSend={(botId, threadId, text) => harnessSendMessage(botId, { text, threadId }).then(() => undefined)}
      />
      <ErrorBox message={error} />
    </div>
  );
}

const fieldClass = "mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[13px] outline-none focus:border-accent-border";

function ceilingText(ceilings: Record<string, number>): string {
  return Object.entries(ceilings).map(([bot, usd]) => `${bot} ${usd}`).join("\n");
}

function parseCeilings(text: string): Record<string, number> | null {
  const ceilings: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = /^([A-Za-z0-9_-]{1,80})\s+([0-9]+(?:\.[0-9]+)?)$/.exec(trimmed);
    if (!match?.[1] || !match[2]) return null;
    ceilings[match[1]] = Number(match[2]);
  }
  return ceilings;
}

function DeliveryForm(props: { initial: DeliveryView; busy: boolean; onSave: (patch: Record<string, unknown>) => void }) {
  const [host, setHost] = useState(props.initial.host);
  const [port, setPort] = useState(String(props.initial.port || 587));
  const [username, setUsername] = useState(props.initial.username);
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState(props.initial.from);
  const [formatModel, setFormatModel] = useState(props.initial.formatModel);
  const [ceilings, setCeilings] = useState(ceilingText(props.initial.ceilings));
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form
      className="mt-8 rounded-lg border border-hairline/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = parseCeilings(ceilings);
        const portNumber = Number(port);
        if (!parsed || !Number.isInteger(portNumber)) {
          setProblem(t("console.delivery.ceilingInvalid"));
          return;
        }
        setProblem(null);
        props.onSave({ host, port: portNumber, username, password, from, formatModel, ceilings: parsed });
      }}
    >
      <h2 className="text-[15px] font-semibold">{t("console.delivery.title")}</h2>
      <p className="mt-1 text-[13px] text-ink-secondary">{t("console.delivery.hint")}</p>
      <label className="mt-4 block text-[12px] font-medium text-ink-secondary" htmlFor="delivery-host">{t("console.delivery.host")}</label>
      <input id="delivery-host" className={fieldClass} value={host} disabled={props.busy} autoComplete="off" onChange={(event) => setHost(event.target.value)} />
      <label className="mt-4 block text-[12px] font-medium text-ink-secondary" htmlFor="delivery-port">{t("console.delivery.port")}</label>
      <input id="delivery-port" className={fieldClass} value={port} disabled={props.busy} inputMode="numeric" onChange={(event) => setPort(event.target.value)} />
      <label className="mt-4 block text-[12px] font-medium text-ink-secondary" htmlFor="delivery-username">{t("console.delivery.username")}</label>
      <input id="delivery-username" className={fieldClass} value={username} disabled={props.busy} autoComplete="off" onChange={(event) => setUsername(event.target.value)} />
      <label className="mt-4 block text-[12px] font-medium text-ink-secondary" htmlFor="delivery-password">{t("console.delivery.password")}</label>
      <input id="delivery-password" className={fieldClass} type="password" value={password} disabled={props.busy} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} />
      <p className="mt-1 text-[12px] text-ink-faint">{props.initial.passwordSet ? t("console.delivery.passwordHint") : ""}</p>
      <label className="mt-4 block text-[12px] font-medium text-ink-secondary" htmlFor="delivery-from">{t("console.delivery.from")}</label>
      <input id="delivery-from" className={fieldClass} type="email" value={from} disabled={props.busy} autoComplete="off" onChange={(event) => setFrom(event.target.value)} />
      <label className="mt-4 block text-[12px] font-medium text-ink-secondary" htmlFor="delivery-format">{t("console.delivery.formatModel")}</label>
      <input id="delivery-format" className={fieldClass} value={formatModel} disabled={props.busy} autoComplete="off" spellCheck={false} onChange={(event) => setFormatModel(event.target.value)} />
      <p className="mt-1 text-[12px] text-ink-faint">{t("console.delivery.formatHint")}</p>
      <label className="mt-4 block text-[12px] font-medium text-ink-secondary" htmlFor="delivery-ceilings">{t("console.delivery.ceilings")}</label>
      <textarea id="delivery-ceilings" className={`${fieldClass} min-h-20 font-mono`} value={ceilings} disabled={props.busy} spellCheck={false} onChange={(event) => setCeilings(event.target.value)} />
      <p className="mt-1 text-[12px] text-ink-faint">{t("console.delivery.ceilingsHint")}</p>
      {problem && <p role="alert" className="mt-3 text-[13px] text-danger">{problem}</p>}
      <button type="submit" className="mt-4 rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50" disabled={props.busy}>
        {props.busy ? t("console.sending") : t("console.dashboard.save")}
      </button>
    </form>
  );
}

export function SettingsPage() {
  const [lists, setLists] = useState<SignInLists>({ admins: [], members: [] });
  const [info, setInfo] = useState<{ version: string; edition: string }>({ version: "", edition: "" });
  const [mail, setMail] = useState<DeliveryView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { session, loading, busy, error, setBusy, fail } = useHarnessAdmin(async () => {
    const [config, health, edition, delivery] = await Promise.all([harnessConfig(), harnessHealth(), harnessEdition(), harnessDelivery()]);
    setLists(toSignInLists(config));
    setInfo({ version: health.version, edition: edition.edition });
    setMail(delivery);
  });
  if (loading) return <LoadingState />;
  if (!session || session.kind === "none") return <NeedsSession />;
  if (!session.admin) return <p className={`mt-3 text-[14px] text-ink-secondary`}>{t("console.harness.adminOnly")}</p>;
  return (
    <div>
      <p className="mb-4 text-[13px] text-ink-secondary">{t("console.harness.allowHint")}</p>
      <h2 className="text-[15px] font-semibold">{t("console.harness.users")}</h2>
      <div className="mt-3">
        <AccessLists
          lists={lists}
          busy={busy}
          onSave={(next) => {
            setBusy(true);
            saveHarnessConfig({ signIn: next }).then((config) => {
              setLists(toSignInLists(config));
              setBusy(false);
            }, fail);
          }}
        />
      </div>
      <section className="mt-8 rounded-lg border border-hairline/40 p-4">
      <h2 className="text-[15px] font-semibold">{t("console.harness.server")}</h2>
      <dl className="mt-3 grid gap-3 text-[14px] sm:grid-cols-2">
        <div>
          <dt className="text-[13px] text-ink-secondary">{t("console.harness.edition")}</dt>
          <dd className="font-medium">{info.edition || "—"}</dd>
        </div>
        <div>
          <dt className="text-[13px] text-ink-secondary">{t("console.dashboard.version")}</dt>
          <dd className="font-medium">{info.version || "—"}</dd>
        </div>
      </dl>
      </section>
      {mail && (
        <DeliveryForm
          key={`${mail.host}:${mail.from}:${mail.formatModel}:${mail.passwordSet}`}
          initial={mail}
          busy={busy}
          onSave={(patch) => {
            setBusy(true);
            setNotice(null);
            saveHarnessDelivery(patch).then((saved) => {
              setMail(saved);
              setNotice(saved.synced === false ? t("console.delivery.syncFailed") : t("console.delivery.saved"));
              setBusy(false);
            }, fail);
          }}
        />
      )}
      {notice && <p className="mt-3 text-[13px] text-ink-secondary">{notice}</p>}
      <ErrorBox message={error} />
    </div>
  );
}
