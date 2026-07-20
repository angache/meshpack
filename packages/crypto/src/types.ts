export type WrappedFileKey = {
  version: number;
  ephemeral_public_key_b64: string;
  nonce_b64: string;
  ciphertext_b64: string;
  mac_b64: string;
};

export type EncryptedBlob = {
  version: number;
  nonce_b64: string;
  ciphertext_b64: string;
  mac_b64: string;
};

export type KeyBackup = {
  algorithm: "x25519";
  kdf_algorithm: "argon2id";
  kdf_salt_base64: string;
  private_key_nonce_base64: string;
  encrypted_private_key: string;
  private_key_mac_base64: string;
  public_key: string;
  kdf_params: {
    memoryKib: number;
    iterations: number;
    parallelism: number;
    length: number;
  };
};

export type EncryptedCaseEnvelope = {
  id: string;
  sender_id: string;
  receiver_id: string;
  encrypted_metadata: EncryptedBlob;
  encrypted_file_key: WrappedFileKey;
  storage_bucket: string;
  storage_object_path: string;
};
