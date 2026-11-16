/** One free Muse grant is keyed by a mailbox, not by every alias a provider delivers. */

const PLUS_DOT_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function canonicalGrantEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return trimmed;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (PLUS_DOT_DOMAINS.has(domain)) {
    const plus = local.indexOf("+");
    if (plus >= 0) local = local.slice(0, plus);
    local = local.replaceAll(".", "");
  }
  return local && domain ? `${local}@${domain}` : trimmed;
}

const INSTALL_ID = /^[A-Za-z0-9._:-]{8,320}$/;

export function grantInstallId(raw: unknown): string {
  return typeof raw === "string" && INSTALL_ID.test(raw.trim()) ? raw.trim() : "";
}
