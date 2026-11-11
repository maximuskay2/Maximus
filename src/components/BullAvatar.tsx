import { cn } from "@/lib/cn";

/** Colorizable bull mark: keeps the art's shading, takes hue from the bot gradient. */
export function BullAvatar({
  size,
  gradient,
  label,
  className,
}: {
  size: number;
  gradient: [string, string, string];
  label?: string | null;
  className?: string;
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
      data-bull-avatar=""
      className={cn("relative inline-block shrink-0 overflow-hidden", className)}
      style={{ width: size, height: size, isolation: "isolate" }}
    >
      <img
        src="/bull-avatar.png"
        alt=""
        draggable={false}
        width={size}
        height={size}
        className="block size-full object-contain"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(180deg, ${gradient[0]} 0%, ${gradient[1]} 45%, ${gradient[2]} 100%)`,
          mixBlendMode: "color",
        }}
      />
    </span>
  );
}
