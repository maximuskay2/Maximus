export type SensitivePage = "captcha" | "two-factor" | "checkout" | "outbound email";

export function sensitivePageReason(text: string): SensitivePage | null {
  const page = text.toLowerCase();
  if (/\bcaptcha\b|i'm not a robot/.test(page)) return "captcha";
  if (/\btwo-factor\b|\bone-time code\b|\bauthenticator app\b/.test(page)) return "two-factor";
  if (/\bplace order\b|\bpay now\b|\bcard number\b/.test(page)) return "checkout";
  if (/\bsend email\b|\bsend message\b/.test(page)) return "outbound email";
  return null;
}

export function guardedBrowserAction(pageText: string, submit: () => void): { submitted: boolean; approval: SensitivePage | null } {
  const approval = sensitivePageReason(pageText);
  if (approval) return { submitted: false, approval };
  submit();
  return { submitted: true, approval: null };
}
