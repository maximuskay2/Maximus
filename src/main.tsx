import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  previewBrowserSignIn, readSessionState, takeBrowserSignInFromLocation, takePairingCodeFromLocation, takeInvitedEmailFromLocation,
} from "./lib/session";
import { bootstrapBrand, productName } from "./lib/brand";
import { t } from "./lib/i18n";
import { loadPageLanguage } from "./lib/language-preference";
import { applySkinChoice, readSkinChoice } from "./lib/skins";
import { applyChatWidth, readChatWidth } from "./lib/chat-width";
import { applyFont, readFont } from "./lib/fonts";
import { settleAdvancedModeDefault } from "./lib/interface-mode";
import { BrowserSignInPage } from "./pair/BrowserSignInPage";
import { PairPage } from "./pair/PairPage";
import { AdminPage } from "./console/AdminPage";
import { ForgotPasswordPage, ResetPasswordPage } from "./console/ForgotPasswordPage";
import { JoinPage } from "./console/JoinPage";
import { PricingPage } from "./console/PricingPage";
import { SigninPage } from "./console/SigninPage";
import { SignupPage } from "./console/SignupPage";
import { browserLandingPath, scrollingDocument } from "./site/landing";
import { AboutPage, PrivacyPage, TermsPage } from "./site/LegalPages";
import { WelcomePage } from "./site/WelcomePage";
import { HomeScreen, SignedOutAtHome } from "./components/HomeScreen";
import { PageBoundary } from "./components/PageBoundary";
import { endedBeforeReload, forgetEndedSession } from "./lib/session-ended";
import "./styles.css";

// Before first paint; settleAdvancedModeDefault must run before applySkin writes maximus-skin.
settleAdvancedModeDefault();
applySkinChoice(readSkinChoice());
applyFont(readFont());
applyChatWidth(readChatWidth());
const pageLanguage = loadPageLanguage();

const landing = browserLandingPath(location.pathname, Boolean(window.ogb));
if (landing) history.replaceState(null, "", `${landing}${location.search}${location.hash}`);

// The app is its own chunk, so these pages don't parse it. Everywhere else its fetch starts now, alongside the session
// read, instead of after it. A failed fetch renders as a throw, so PageBoundary offers a reload.
const PAGES_WITHOUT_THE_APP = new Set([
  "/home", "/pair", "/desktop-viewer", "/signup", "/join", "/pricing", "/signin", "/forgot", "/reset",
  "/about", "/terms", "/privacy", "/admin", "/welcome",
]);
const loadApp = () => import("./App").catch((error: unknown) => ({ default: (): never => { throw error; } }));
const appPage = PAGES_WITHOUT_THE_APP.has(location.pathname) ? null : loadApp();

async function chooseRoot(): Promise<React.ReactNode> {
  const home = window.ogb?.home;
  if (location.pathname === "/home" && home) return <HomeScreen bridge={home} manage={window.ogb?.cloudPlan?.manage} />;
  if (location.pathname === "/pair") {
    const signIn = takeBrowserSignInFromLocation();
    if (signIn) {
      const preview = await previewBrowserSignIn(signIn);
      await pageLanguage;
      return preview ? <BrowserSignInPage credential={signIn} owner={preview.owner} /> : <PairPage initialCode={null} reason={t("pair.browser.signInFailed")} />;
    }
    return <PairPage initialCode={takePairingCodeFromLocation()} initialEmail={takeInvitedEmailFromLocation()} />;
  }
  // Public console pages: hosted signup, invite accept, and pricing need no harness session.
  if (location.pathname === "/signup") {
    await pageLanguage;
    return <SignupPage />;
  }
  if (location.pathname === "/join") {
    await pageLanguage;
    return <JoinPage />;
  }
  if (location.pathname === "/pricing") {
    await pageLanguage;
    return <PricingPage />;
  }
  if (location.pathname === "/signin") {
    await pageLanguage;
    return <SigninPage />;
  }
  if (location.pathname === "/forgot") {
    await pageLanguage;
    return <ForgotPasswordPage />;
  }
  if (location.pathname === "/reset") {
    await pageLanguage;
    return <ResetPasswordPage />;
  }
  if (location.pathname === "/about") {
    await pageLanguage;
    return <AboutPage />;
  }
  if (location.pathname === "/terms") {
    await pageLanguage;
    return <TermsPage />;
  }
  if (location.pathname === "/privacy") {
    await pageLanguage;
    return <PrivacyPage />;
  }
  if (location.pathname === "/admin") {
    await pageLanguage;
    return <AdminPage />;
  }
  if (location.pathname === "/welcome") {
    await pageLanguage;
    const welcomeSession = await readSessionState();
    const signedIn = welcomeSession.kind === "session";
    if (scrollingDocument(location.pathname, signedIn)) document.documentElement.dataset.page = "site";
    else delete document.documentElement.dataset.page;
    if (signedIn) {
      const { default: App } = await loadApp();
      return <App />;
    }
    return <WelcomePage />;
  }
  const session = await readSessionState();
  if (session.kind === "unauthenticated") {
    await pageLanguage;
    const ended = endedBeforeReload();
    if (!ended && !home) {
      const next = `${location.pathname}${location.search}${location.hash}`;
      history.replaceState(null, "", `/signin?next=${encodeURIComponent(next || "/app")}`);
      return <SigninPage />;
    }
    const pair = <PairPage initialCode={null} reason={ended ? t("pair.sessionEnded") : undefined} />;
    return home ? <SignedOutAtHome bridge={home} fallback={pair} /> : pair;
  }
  forgetEndedSession();
  if (session.kind !== "session") {
    await pageLanguage;
    const reason = session.kind === "loopback" && session.trust === "service"
      ? t("pair.serviceTrust")
      : session.kind === "unreachable" ? session.error : undefined;
    return <PairPage initialCode={null} reason={reason} />;
  }
  if (location.pathname === "/desktop-viewer") {
    const { DesktopViewer } = await import("./components/DesktopViewer");
    return <DesktopViewer />;
  }
  const { default: App } = await (appPage ?? loadApp());
  return <App />;
}

// The window is named before the brand file is asked for: the answer only ever renames it.
document.title = productName();
if (scrollingDocument(location.pathname, false) && location.pathname !== "/welcome") {
  document.documentElement.dataset.page = "site";
}
void Promise.all([bootstrapBrand(), chooseRoot(), pageLanguage]).then(([, root]) => {
  createRoot(document.getElementById("root")!).render(<StrictMode><PageBoundary>{root}</PageBoundary></StrictMode>);
});
