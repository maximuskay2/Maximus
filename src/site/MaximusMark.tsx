/** The bull mark. `live` adds the ember aura used on the marketing hero. The lids blink in both sizes. */
export function MaximusMark({ size = 28, live = false }: { size?: number; live?: boolean }) {
  return (
    <span className={live ? "bull-mark bull-mark-live" : "bull-mark"} style={{ width: size, height: size }} aria-hidden="true">
      {live && <span className="bull-aura" />}
      <img src="/bull-avatar.png" alt="" width={size} height={size} draggable={false} />
      <span className="bull-lid bull-lid-left" />
      <span className="bull-lid bull-lid-right" />
    </span>
  );
}
