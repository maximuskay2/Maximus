// Exact app-owned browser state that belongs in an encrypted full backup.
// Never include cookies, authentication tokens, connection caches or unknown keys.
export const WORKSPACE_BACKUP_CLIENT_KEYS = [
  "maximus-drafts",
  "maximus-draft-attachments",
  "maximus-draft-send-ids",
  "maximus-draft-channel-modes",
  "maximus-skin",
  "maximus-show-threads",
  "maximus-show-run-card",
  "maximus-send-key",
  "maximus-color-user-bubbles",
  "maximus-chat-width",
  "maximus.sidebarDensity",
  "maximus.sidebarToolsLayout",
  "maximus.sidebarCollapsedSections.v1",
  "maximus.sidebarSectionOrder.v1",
  "maximus-analytics-opt-out",
  "maximus.remote-voice.v1",
] as const;

export type WorkspaceBackupClientState = Partial<Record<(typeof WORKSPACE_BACKUP_CLIENT_KEYS)[number], string>>;
