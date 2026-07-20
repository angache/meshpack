import { x25519 } from "@noble/curves/curve25519";

import type { EncryptedBlob, WrappedFileKey } from "./types";
import { b64 } from "./util";

const enc = new TextEncoder();

function joinCipher(ciphertext: Uint8Array, mac: Uint8Array): Uint8Array {
  const out = new Uint8Array(ciphertext.length + mac.length);
  out.set(ciphertext, 0);
  out.set(mac, ciphertext.length);
  return out;
}

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

export async function unwrapFileKey(
  wrapped: WrappedFileKey,
  receiverPrivateKey: Uint8Array,
): Promise<Uint8Array> {
  const ephPublic = b64.dec(wrapped.ephemeral_public_key_b64);
  const shared = x25519.getSharedSecret(receiverPrivateKey, ephPublic);
  const wrapKey = await hkdfWrapKey(shared);
  const packed = joinCipher(
    b64.dec(wrapped.ciphertext_b64),
    b64.dec(wrapped.mac_b64),
  );
  const clear = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: b64.dec(wrapped.nonce_b64),
      additionalData: enc.encode("meshpack-file-key"),
    },
    wrapKey,
    packed,
  );
  return new Uint8Array(clear);
}

export async function decryptBytes(
  blob: EncryptedBlob,
  fileKey: Uint8Array,
  aad?: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", fileKey, "AES-GCM", false, ["decrypt"]);
  const packed = joinCipher(
    b64.dec(blob.ciphertext_b64),
    b64.dec(blob.mac_b64),
  );
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64.dec(blob.nonce_b64), additionalData: aad },
    key,
    packed,
  );
  return new Uint8Array(clear);
}

export function decodePayload(payload: Uint8Array): EncryptedBlob {
  if (payload.length < 32) throw new Error("Invalid encrypted payload.");
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const version = dv.getUint32(0, false);
  const nonce = payload.slice(4, 16);
  const mac = payload.slice(16, 32);
  const ciphertext = payload.slice(32);
  return {
    version,
    nonce_b64: b64.enc(nonce),
    mac_b64: b64.enc(mac),
    ciphertext_b64: b64.enc(ciphertext),
  };
}
