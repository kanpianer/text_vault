export interface TabContent {
  id: string;
  text: string;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "pwd_changed";

export interface VaultSalts {
  exists: boolean;
  salt_enc?: string;
  salt_auth?: string;
}
