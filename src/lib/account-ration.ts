const listeners = new Set<() => void>();

export function refreshAccountRation(): void {
  for (const listener of listeners) listener();
}

export function watchAccountRation(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
