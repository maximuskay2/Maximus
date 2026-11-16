/** HTML + plain text for Maximus transactional mail. Table layout for mail clients. */

export function escapeMailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface TransactionalMailParts {
  subject: string;
  text: string;
  html: string;
}

export function transactionalMailDocument(input: {
  preview: string;
  title: string;
  bodyHtml: string;
  cta?: { label: string; href: string };
  footnote?: string;
}): string {
  const preview = escapeMailHtml(input.preview);
  const title = escapeMailHtml(input.title);
  const footnote = escapeMailHtml(input.footnote ?? "Maximus · meetnote");
  const cta = input.cta
    ? `<tr><td style="padding:28px 0 8px">
        <a href="${escapeMailHtml(input.cta.href)}" style="display:inline-block;background:#c2410c;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:1;padding:14px 22px;border-radius:10px">${escapeMailHtml(input.cta.label)}</a>
      </td></tr>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${preview}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f0f;padding:32px 16px">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#171717;border:1px solid #2a2a2a;border-radius:16px;overflow:hidden">
        <tr>
          <td style="padding:28px 32px 12px;border-bottom:1px solid #2a2a2a">
            <p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#e86a3a">Maximus</p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 8px">
            <h1 style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:24px;line-height:1.25;font-weight:700;color:#f5f5f5">${title}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#d4d4d4">
            ${input.bodyHtml}
            ${cta}
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.4;color:#737373">${footnote}</p>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function codeBlock(code: string): string {
  return `<div style="margin:20px 0;padding:18px 20px;background:#0f0f0f;border:1px solid #2a2a2a;border-radius:12px;text-align:center">
  <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:0.18em;color:#f5f5f5">${escapeMailHtml(code)}</p>
</div>`;
}

export function otpMailParts(subject: string, otp: string): TransactionalMailParts {
  const text = `${subject}\n\nYour one-time code is: ${otp}\n\nIt expires in 10 minutes. If you did not request this code, you can ignore this email.`;
  const html = transactionalMailDocument({
    preview: `Your Maximus code is ${otp}`,
    title: subject,
    bodyHtml: `<p style="margin:0 0 8px">Your one-time code:</p>${codeBlock(otp)}<p style="margin:0;color:#a3a3a3">It expires in 10 minutes. If you did not ask for this, ignore this email.</p>`,
  });
  return { subject, text, html };
}

export function passwordResetMailParts(link: string): TransactionalMailParts {
  const subject = "Reset your Maximus password";
  const text =
    `Use this link to choose a new Maximus password:\n\n${link}\n\n` +
    "It works once, for the next hour. If you did not ask for a reset, ignore this email.\n";
  const html = transactionalMailDocument({
    preview: "Choose a new Maximus password",
    title: subject,
    bodyHtml: `<p style="margin:0 0 12px">Use the button below to choose a new password. The link works once for the next hour.</p>
<p style="margin:0;color:#a3a3a3;font-size:13px;word-break:break-all">${escapeMailHtml(link)}</p>`,
    cta: { label: "Choose a new password", href: link },
    footnote: "If you did not ask for a reset, ignore this email.",
  });
  return { subject, text, html };
}

export function signInCodeMailParts(code: string): TransactionalMailParts {
  const subject = "Your Maximus sign-in code";
  const spaced = `${code.slice(0, 4)} ${code.slice(4)}`;
  const text =
    `Your code to sign in to Maximus is\n\n    ${spaced}\n\nIt works once, for the next ten minutes.\n` +
    "If you did not ask to sign in, ignore this email: nobody gets in without the code.\n";
  const html = transactionalMailDocument({
    preview: `Your Maximus sign-in code is ${spaced}`,
    title: subject,
    bodyHtml: `<p style="margin:0 0 8px">Enter this code to sign in. It works once for the next ten minutes.</p>${codeBlock(spaced)}<p style="margin:0;color:#a3a3a3">If you did not ask to sign in, ignore this email.</p>`,
  });
  return { subject, text, html };
}

export interface CreditGrantMailInput {
  creditUsd?: number;
  tokens?: number;
  plan?: string | null;
  leftUsd?: number;
  note?: string;
  appUrl?: string | null;
}

function money(value: number): string {
  return `$${value.toFixed(value >= 1 || value === 0 ? 2 : 4)}`;
}

function planLabel(plan: string): string {
  if (plan === "byo") return "Your model";
  if (plan === "starter") return "Starter";
  if (plan === "plus") return "Plus";
  if (plan === "pro") return "Pro";
  return plan;
}

export function creditGrantMailParts(input: CreditGrantMailInput): TransactionalMailParts {
  const lines: string[] = [];
  const rows: string[] = [];
  if (input.plan) {
    lines.push(`Plan: ${planLabel(input.plan)}`);
    rows.push(`<tr><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;color:#a3a3a3">Plan</td><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;text-align:right;color:#f5f5f5;font-weight:600">${escapeMailHtml(planLabel(input.plan))}</td></tr>`);
  }
  if (typeof input.creditUsd === "number" && input.creditUsd > 0) {
    lines.push(`Credit added: ${money(input.creditUsd)}`);
    rows.push(`<tr><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;color:#a3a3a3">Credit added</td><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;text-align:right;color:#f5f5f5;font-weight:600">${escapeMailHtml(money(input.creditUsd))}</td></tr>`);
  }
  if (typeof input.tokens === "number" && input.tokens > 0) {
    lines.push(`Spark tokens added: ${input.tokens.toLocaleString("en-US")}`);
    rows.push(`<tr><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;color:#a3a3a3">Spark tokens</td><td style="padding:10px 0;border-bottom:1px solid #2a2a2a;text-align:right;color:#f5f5f5;font-weight:600">${escapeMailHtml(input.tokens.toLocaleString("en-US"))}</td></tr>`);
  }
  if (typeof input.leftUsd === "number") {
    lines.push(`Balance now: ${money(input.leftUsd)}`);
    rows.push(`<tr><td style="padding:10px 0;color:#a3a3a3">Balance now</td><td style="padding:10px 0;text-align:right;color:#f5f5f5;font-weight:600">${escapeMailHtml(money(input.leftUsd))}</td></tr>`);
  }
  if (input.note?.trim()) {
    lines.push(`Note: ${input.note.trim()}`);
  }
  const subject = typeof input.creditUsd === "number" && input.creditUsd > 0
    ? `${money(input.creditUsd)} Muse credit added to your Maximus account`
    : input.plan
      ? `Your Maximus plan is now ${planLabel(input.plan)}`
      : "Your Maximus Muse balance was updated";
  const text = [
    subject,
    "",
    ...lines,
    "",
    input.appUrl ? `Open Maximus: ${input.appUrl}` : "",
    "If you did not expect this, contact the person who runs your Maximus workspace.",
  ].filter(Boolean).join("\n");
  const noteHtml = input.note?.trim()
    ? `<p style="margin:16px 0 0;color:#a3a3a3;font-size:13px">${escapeMailHtml(input.note.trim())}</p>`
    : "";
  const html = transactionalMailDocument({
    preview: subject,
    title: "Muse balance updated",
    bodyHtml: `<p style="margin:0 0 16px">An admin added Muse credit or a plan to your Maximus account.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;border-collapse:collapse">${rows.join("")}</table>
${noteHtml}`,
    cta: input.appUrl ? { label: "Open Maximus", href: input.appUrl } : undefined,
    footnote: "If you did not expect this, contact the person who runs your Maximus workspace.",
  });
  return { subject, text, html };
}
