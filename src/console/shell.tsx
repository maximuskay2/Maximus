import type { ReactNode } from "react";

export const fieldInput = "mt-1 w-full rounded-md border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink outline-none focus:border-accent-border";
export const fieldLabel = "mt-4 block text-[12px] font-medium text-ink-secondary";
export const primaryButton = "mt-5 w-full rounded-md bg-accent px-4 py-2 text-[14px] font-medium text-accent-ink disabled:opacity-50";
export const ghostButton = "mt-3 w-full rounded-md border border-hairline/40 px-4 py-2 text-[14px] text-ink-secondary disabled:opacity-50";

export function ConsoleShell({ title, subtitle, children, compact, marketing }: { title: string; subtitle?: string; children: ReactNode; compact?: boolean; marketing?: boolean }) {
  if (marketing) {
    return (
      <main className="site-auth flex flex-1 items-center justify-center px-5 py-16">
        <div className="site-rise w-full max-w-[440px] rounded-3xl border border-white/10 bg-[#121214]/85 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:p-8">
          <h1 className="text-[28px] font-semibold tracking-tight text-[#F4F1EA]">{title}</h1>
          {subtitle ? <p className="mt-2 text-[14px] leading-relaxed text-[#A39E93]">{subtitle}</p> : null}
          {children}
        </div>
      </main>
    );
  }
  return (
    <main className={compact
      ? "flex flex-1 items-center justify-center bg-app px-6 py-10 text-ink"
      : "flex min-h-screen items-center justify-center bg-app px-6 py-10 text-ink"}>
      <div className="w-full max-w-[440px]">
        <h1 className="text-[20px] font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] text-ink-secondary">{subtitle}</p> : null}
        {children}
      </div>
    </main>
  );
}

export function ConsoleError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-ink">
      {message}
    </p>
  );
}
