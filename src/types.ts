export interface TabContent {
  id: string;
  text: string;
  title?: string;
  scrollTop?: number;
  isShared?: boolean;
  shareId?: string;
  shareHasPassword?: boolean;
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

