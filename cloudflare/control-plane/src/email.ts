export interface TransactionalEmailSender {
  send(message: {
    to: string;
    from: { email: string; name: string };
    subject: string;
    html: string;
    text: string;
  }): Promise<void>;
}

export interface OTPEmailInput {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification" | "forget-password" | "change-email";
}

const SUBJECTS = {
  "sign-in": "Your Maximus sign-in code",
  "email-verification": "Verify your Maximus email",
  "forget-password": "Reset your Maximus password",
  "change-email": "Confirm your Maximus email change",
} as const satisfies Record<OTPEmailInput["type"], string>;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function otpHtml(subject: string, otp: string): string {
  const title = escapeHtml(subject);
  const code = escapeHtml(otp);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0f0f0f">
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
            <p style="margin:0 0 8px">Your one-time code:</p>
            <div style="margin:20px 0;padding:18px 20px;background:#0f0f0f;border:1px solid #2a2a2a;border-radius:12px;text-align:center">
              <p style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:28px;font-weight:700;letter-spacing:0.18em;color:#f5f5f5">${code}</p>
            </div>
            <p style="margin:0;color:#a3a3a3">It expires in 10 minutes. If you did not ask for this, ignore this email.</p>
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.4;color:#737373">Maximus · meetnote</p>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function buildOTPEmail(from: string, input: OTPEmailInput) {
  const subject = SUBJECTS[input.type];
  const text = `${subject}\n\nYour one-time code is: ${input.otp}\n\nIt expires in 10 minutes. If you did not request this code, you can ignore this email.`;
  return {
    to: input.email,
    from: { email: from, name: "Maximus" },
    subject,
    html: otpHtml(subject, input.otp),
    text,
  };
}

/** Local-dev OTP transport: DEV_OTP_LOG=1 prints the code to the wrangler
 * terminal instead of emailing it. The committed default is "0"; only a
 * local .dev.vars may set "1". Never set it as a production secret. */
export function resolveOTPTransport(env: unknown, email: TransactionalEmailSender): TransactionalEmailSender {
  const flag = (env as { DEV_OTP_LOG?: unknown } | null | undefined)?.DEV_OTP_LOG;
  if (flag !== "1") return email;
  return {
    send: async (message) => {
      console.log(`[dev-otp] to=${message.to}\n${message.text}`);
    },
  };
}

export async function sendOTPEmail(
  sender: TransactionalEmailSender,
  from: string,
  input: OTPEmailInput,
  requestId: string,
): Promise<void> {
  try {
    await sender.send(buildOTPEmail(from, input));
  } catch {
    // Authentication responses stay enumeration-safe. Do not log the address,
    // code, provider error, message object, or any other credential material.
    console.error(JSON.stringify({ message: "transactional email send failed", requestId }));
  }
}
