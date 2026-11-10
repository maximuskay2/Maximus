// Read before main.tsx's first-paint writes: applySkin stamps maximus-skin on every boot.
const PRIOR_RUN_KEYS = ["maximus-skin", "maximus-installed", "maximus-email-gate", "maximus-drafts", "maximus-show-threads"];

export function hasPriorRun(store: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return PRIOR_RUN_KEYS.some((key) => store?.getItem(key) != null);
  } catch {
    return false;
  }
}
