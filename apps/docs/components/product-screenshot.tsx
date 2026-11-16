const screenshotNames = [
  'hero',
  'model-picker',
  'computer-panel',
  'approval-card',
  'marketplace',
  'composio-multi-account',
  'context-menu',
  'app-settings',
  'ubuntu-computer-panel',
  'docs-onboarding',
  'docs-engine-detection',
  'docs-fresh-bot',
  'docs-model-picker',
  'docs-computer-panel',
  'docs-connected-apps',
  'docs-automations',
  'docs-my-cloud-compare',
  'docs-my-cloud-strip',
  'docs-my-cloud-switcher',
] as const;

type ScreenshotName = (typeof screenshotNames)[number];

/** Product UI shots were removed; docs pages show the bull mark until fresh captures land. */
export function ProductScreenshot({
  name: _name,
  alt,
  caption,
  position = 'center',
}: {
  name: ScreenshotName;
  alt: string;
  caption?: string;
  position?: 'center' | 'top';
}) {
  return (
    <figure className="maximus-product-shot">
      <div className="maximus-product-shot-frame">
        <img
          src="/screenshots/bull-avatar.png"
          alt={alt}
          loading="lazy"
          className={position === 'top' ? 'object-top' : 'object-center'}
        />
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}
