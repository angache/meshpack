import "dart:convert";
import "dart:typed_data";

class WrappedFileKey {
  const WrappedFileKey({
    required this.version,
    required this.ephemeralPublicKey,
    required this.nonce,
    required this.ciphertext,
    required this.mac,
  });

  final int version;
  final Uint8List ephemeralPublicKey;
  final Uint8List nonce;
  final Uint8List ciphertext;
  final Uint8List mac;

  Map<String, dynamic> toJson() {
    return {
      "version": version,
      "ephemeral_public_key_b64": base64Encode(ephemeralPublicKey),
      "nonce_b64": base64Encode(nonce),
      "ciphertext_b64": base64Encode(ciphertext),
      "mac_b64": base64Encode(mac),
    };
  }

  static WrappedFileKey fromJson(Map<String, dynamic> json) {
    return WrappedFileKey(
      version: int.parse(json["version"].toString()),
      ephemeralPublicKey:
          base64Decode(json["ephemeral_public_key_b64"] as String),
      nonce: base64Decode(json["nonce_b64"] as String),
      ciphertext: base64Decode(json["ciphertext_b64"] as String),
      mac: base64Decode(json["mac_b64"] as String),
    );
  }
}

class EncryptedBlob {
  const EncryptedBlob({
    required this.version,
    required this.nonce,
    required this.ciphertext,
    required this.mac,
  });

  final int version;
  final Uint8List nonce;
  final Uint8List ciphertext;
  final Uint8List mac;

  Map<String, dynamic> toJson() {
    return {
      "version": version,
      "nonce_b64": base64Encode(nonce),
      "ciphertext_b64": base64Encode(ciphertext),
      "mac_b64": base64Encode(mac),
    };
  }

  static EncryptedBlob fromJson(Map<String, dynamic> json) {
    return EncryptedBlob(
      version: int.parse(json["version"].toString()),
      nonce: base64Decode(json["nonce_b64"] as String),
      ciphertext: base64Decode(json["ciphertext_b64"] as String),
      mac: base64Decode(json["mac_b64"] as String),
    );
  }
}

class KeyBackup {
  const KeyBackup({
    required this.algorithm,
    required this.kdfAlgorithm,
    required this.salt,
    required this.nonce,
    required this.ciphertext,
    required this.mac,
    required this.publicKey,
    required this.kdfParams,
  });

  final String algorithm;
  final String kdfAlgorithm;
  final Uint8List salt;
  final Uint8List nonce;
  final Uint8List ciphertext;
  final Uint8List mac;
  final Uint8List publicKey;
  final Map<String, dynamic> kdfParams;

  Map<String, dynamic> toJson() {
    return {
      "algorithm": algorithm,
      "kdf_algorithm": kdfAlgorithm,
      "kdf_salt_base64": base64Encode(salt),
      "private_key_nonce_base64": base64Encode(nonce),
      "encrypted_private_key": base64Encode(ciphertext),
      "private_key_mac_base64": base64Encode(mac),
      "public_key": base64Encode(publicKey),
      "kdf_params": kdfParams,
    };
  }

  static KeyBackup fromJson(Map<String, dynamic> json) {
    return KeyBackup(
      algorithm: json["algorithm"] as String,
      kdfAlgorithm: json["kdf_algorithm"] as String,
      salt: base64Decode(json["kdf_salt_base64"] as String),
      nonce: base64Decode(json["private_key_nonce_base64"] as String),
      ciphertext: base64Decode(json["encrypted_private_key"] as String),
      mac: base64Decode(json["private_key_mac_base64"] as String),
      publicKey: base64Decode(json["public_key"] as String),
      kdfParams: Map<String, dynamic>.from(json["kdf_params"] as Map),
    );
  }
}
