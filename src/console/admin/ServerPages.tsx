import { useEffect, useState } from "react";

import { t } from "../../lib/i18n";
import { AccessLists, KeysManager, MessagesManager } from "../AdminHarness";
import {
  harnessBots,
  harnessConfig,
  harnessEdition,
  harnessHealth,
  harnessSendMessage,
  HARNESS_SIGN_IN,
  harnessSession,
  harnessThreadMessages,
  HarnessError,
  saveHarnessConfig,
  toSignInLists,
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

export function SettingsPage() {
  const [lists, setLists] = useState<SignInLists>({ admins: [], members: [] });
  const [info, setInfo] = useState<{ version: string; edition: string }>({ version: "", edition: "" });
  const { session, loading, busy, error, setBusy, fail } = useHarnessAdmin(async () => {
    const [config, health, edition] = await Promise.all([harnessConfig(), harnessHealth(), harnessEdition()]);
    setLists(toSignInLists(config));
    setInfo({ version: health.version, edition: edition.edition });
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
      <ErrorBox message={error} />
    </div>
  );
}
