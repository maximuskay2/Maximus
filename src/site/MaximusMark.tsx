// The Maximus mark: a two-tone M (paper left, ember right) on the dark tile.
// Same geometry as public/app-icon.svg; decorative next to the wordmark.
export function MaximusMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true" focusable="false">
      <rect width="1024" height="1024" rx="224" fill="#14110B" />
      <path d="M240 712 V312 L512 616 L784 312 V712" fill="none" stroke="#F5F1E8" strokeWidth="96" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M512 616 L784 312 V712" fill="none" stroke="#C2410C" strokeWidth="96" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
