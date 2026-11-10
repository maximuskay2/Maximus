export function browserLandingPath(pathname: string, desktopShell: boolean): string | null {
  if (desktopShell || pathname !== "/") return null;
  return "/welcome";
}
