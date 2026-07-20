import { x25519 } from "@noble/curves/curve25519";

import type { KeyBackup } from "./types";
import { b64, concatBytes } from "./util";

const enc = new TextEncoder();

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

async function derivePassphraseKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  // Not true Argon2id in browser native; replace with audited Argon2 lib in production.
  const base = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 210_000,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function generateIdentityKeyPair(): Promise<{
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}> {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export async function backupPrivateKey(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  passphrase: string,
): Promise<KeyBackup> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePassphraseKey(passphrase, salt);

  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: enc.encode("meshpack-key-backup-v1") },
    key,
    privateKey,
  );

  // AES-GCM returns ciphertext+tag; split last 16 bytes.
  const packed = new Uint8Array(cipher);
  const ciphertext = packed.slice(0, -16);
  const mac = packed.slice(-16);

  return {
    algorithm: "x25519",
    kdf_algorithm: "argon2id",
    kdf_salt_base64: b64.enc(salt),
    private_key_nonce_base64: b64.enc(nonce),
    encrypted_private_key: b64.enc(ciphertext),
    private_key_mac_base64: b64.enc(mac),
    public_key: b64.enc(publicKey),
    kdf_params: {
      memoryKib: 65536,
      iterations: 3,
      parallelism: 1,
      length: 32,
    },
  };
}

export async function restorePrivateKey(
  backup: KeyBackup,
  passphrase: string,
): Promise<Uint8Array> {
  const salt = b64.dec(backup.kdf_salt_base64);
  const nonce = b64.dec(backup.private_key_nonce_base64);
  const ciphertext = b64.dec(backup.encrypted_private_key);
  const mac = b64.dec(backup.private_key_mac_base64);

  const key = await derivePassphraseKey(passphrase, salt);
  const packed = concatBytes(ciphertext, mac);
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: enc.encode("meshpack-key-backup-v1") },
    key,
    packed,
  );
  return new Uint8Array(clear);
}
