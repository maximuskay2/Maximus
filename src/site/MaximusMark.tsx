/** Maximus bull bot avatar. Transparent PNG; tile is optional behind it. */
export function MaximusMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/bull-avatar.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}
