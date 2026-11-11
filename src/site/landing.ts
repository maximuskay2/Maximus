export function browserLandingPath(pathname: string, desktopShell: boolean): string | null {
  if (desktopShell || pathname !== "/") return null;
  return "/welcome";
}

/** Marketing routes scroll the document. A signed-in `/welcome` is the app and keeps the fixed viewport. */
export function scrollingDocument(pathname: string, signedIn: boolean): boolean {
  if (pathname === "/desktop-viewer") return false;
  if (pathname === "/welcome") return !signedIn;
  return pathname === "/home"
    || pathname === "/pair"
    || pathname === "/signup"
    || pathname === "/join"
    || pathname === "/pricing"
    || pathname === "/signin"
    || pathname === "/admin";
}
