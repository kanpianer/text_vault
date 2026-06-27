export interface TabContent {
  id: string;
  text: string;
  title?: string;
  scrollTop?: number;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "pwd_changed";

export interface VaultSalts {
  exists: boolean;
  salt_enc?: string;
  salt_auth?: string;
}
