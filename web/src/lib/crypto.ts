/**
 * AES-256-GCM encryption for credential storage.
 * Uses a server-side encryption key from CREDENTIALS_ENCRYPTION_KEY env var.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!key) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY environment variable is required");
  }
  // Key should be 64 hex chars (32 bytes)
  if (key.length !== 64) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY must be 64 hex characters (256 bits)");
  }
  return Buffer.from(key, "hex");
}

export interface EncryptedData {
  encryptedData: string; // hex
  iv: string; // hex
  authTag: string; // hex
}

/**
 * Encrypt a plaintext string using AES-256-GCM
 */
export function encrypt(plaintext: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  return {
    encryptedData: encrypted,
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

/**
 * Decrypt an AES-256-GCM encrypted string
 */
export function decrypt(encrypted: EncryptedData): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(encrypted.iv, "hex");
  const authTag = Buffer.from(encrypted.authTag, "hex");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted.encryptedData, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
