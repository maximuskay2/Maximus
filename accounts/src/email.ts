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

export function buildOTPEmail(from: string, input: OTPEmailInput) {
  const subject = SUBJECTS[input.type];
  const text = `${subject}\n\nYour one-time code is: ${input.otp}\n\nIt expires in 10 minutes. If you did not request this code, you can ignore this email.`;
  const html = `<!doctype html><html><body><h1>${subject}</h1><p>Your one-time code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:0.15em">${input.otp}</p><p>It expires in 10 minutes. If you did not request this code, you can ignore this email.</p></body></html>`;
  return {
    to: input.email,
    from: { email: from, name: "Maximus" },
    subject,
    html,
    text,
  };
}

/** Local-dev OTP transport: DEV_OTP_LOG=1 prints the code to the server log
 * instead of emailing it. Only a local shell may set "1". Never set it as a
 * production secret. */
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
