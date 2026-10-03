export interface TabContent {
  id: string;
  text: string;
  title?: string;
  scrollTop?: number;
  isShared?: boolean;
  shareId?: string;
  shareHasPassword?: boolean;
  /** Raw AES key (hex) for unprotected shares. Lives only in the encrypted vault and the link #fragment. */
  shareKey?: string;
  /** Per-share owner secret; server stores only sha256(token). Legacy shares fall back to the vault auth hash. */
  shareOwnerToken?: string;
  isPinned?: boolean;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "pwd_changed";

export interface VaultSalts {
  exists: boolean;
  salt_enc?: string;
  salt_auth?: string;
}

export interface SharedDocPayload {
  title: string;
  text: string;
  createdAt: string;
}

export interface ShareInfoResponse {
  exists: boolean;
  hasPassword?: boolean;
  salt_enc?: string;
  salt_auth?: string;
  encrypted_data?: string;
  key_unprotected?: string;
  error?: string;
}

