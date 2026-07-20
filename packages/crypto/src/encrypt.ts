import { x25519 } from "@noble/curves/curve25519";

import type { EncryptedBlob, WrappedFileKey } from "./types";
import { b64, concatBytes, u32be } from "./util";

const enc = new TextEncoder();

async function hkdfWrapKey(sharedSecret: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: enc.encode("meshpack-ecies-v1"),
      info: enc.encode("wrap-file-key"),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function splitGcm(bytes: Uint8Array): { ciphertext: Uint8Array; mac: Uint8Array } {
  return {
    ciphertext: bytes.slice(0, -16),
    mac: bytes.slice(-16),
  };
}

export function generateFileKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function encryptBytes(
  clear: Uint8Array,
  fileKey: Uint8Array,
  aad?: Uint8Array,
): Promise<EncryptedBlob> {
  const key = await crypto.subtle.importKey("raw", fileKey, "AES-GCM", false, ["encrypt"]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad },
    key,
    clear,
  );
  const { ciphertext, mac } = splitGcm(new Uint8Array(cipher));
  return {
    version: 1,
    nonce_b64: b64.enc(nonce),
    ciphertext_b64: b64.enc(ciphertext),
    mac_b64: b64.enc(mac),
  };
}

export async function wrapFileKeyForReceiver(
  fileKey: Uint8Array,
  receiverPublicKey: Uint8Array,
): Promise<WrappedFileKey> {
  const ephPrivate = x25519.utils.randomPrivateKey();
  const ephPublic = x25519.getPublicKey(ephPrivate);
  const shared = x25519.getSharedSecret(ephPrivate, receiverPublicKey);
  const wrapKey = await hkdfWrapKey(shared);
  const nonce = crypto.getRandomValues(new Uint8Array(12));

  const packed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: enc.encode("meshpack-file-key") },
    wrapKey,
    fileKey,
  );
  const { ciphertext, mac } = splitGcm(new Uint8Array(packed));
  return {
    version: 1,
    ephemeral_public_key_b64: b64.enc(ephPublic),
    nonce_b64: b64.enc(nonce),
    ciphertext_b64: b64.enc(ciphertext),
    mac_b64: b64.enc(mac),
  };
}

export function encodePayload(blob: EncryptedBlob): Uint8Array {
  const nonce = b64.dec(blob.nonce_b64);
  const mac = b64.dec(blob.mac_b64);
  const ciphertext = b64.dec(blob.ciphertext_b64);
  return concatBytes(u32be(blob.version), nonce, mac, ciphertext);
}
