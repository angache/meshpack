import "dart:convert";

import "package:cryptography/cryptography.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:supabase_flutter/supabase_flutter.dart";

import "../crypto/e2ee_models.dart";
import "../crypto/key_manager.dart";
import "supabase_service.dart";

/// Yerel private key + Supabase `user_keys` kaydı.
class KeyService {
  KeyService({
    KeyManager? keyManager,
    FlutterSecureStorage? storage,
    SupabaseClient? client,
  })  : _keys = keyManager ?? KeyManager(),
        _storage = storage ?? const FlutterSecureStorage(),
        _client = client ?? SupabaseService.client;

  final KeyManager _keys;
  final FlutterSecureStorage _storage;
  final SupabaseClient _client;

  static const _localPrivateKey = "meshpack_private_key_b64";
  static const _localPublicKey = "meshpack_public_key_b64";

  Future<bool> hasLocalKey() async {
    final v = await _storage.read(key: _localPrivateKey);
    return v != null && v.isNotEmpty;
  }

  Future<SimpleKeyPairData?> loadLocalKeyPair() async {
    final privB64 = await _storage.read(key: _localPrivateKey);
    final pubB64 = await _storage.read(key: _localPublicKey);
    if (privB64 == null || pubB64 == null) return null;
    return SimpleKeyPairData(
      base64Decode(privB64),
      publicKey: SimplePublicKey(base64Decode(pubB64), type: KeyPairType.x25519),
      type: KeyPairType.x25519,
    );
  }

  Future<void> _saveLocal(SimpleKeyPairData data) async {
    await _storage.write(
      key: _localPrivateKey,
      value: base64Encode(data.bytes),
    );
    await _storage.write(
      key: _localPublicKey,
      value: base64Encode(data.publicKey.bytes),
    );
  }

  /// Yeni X25519 keypair üret, cihaza kaydet, Supabase'e yedekle.
  Future<void> registerIdentity({required String securityPassphrase}) async {
    final userId = _client.auth.currentUser?.id;
    if (userId == null) {
      throw StateError("Anahtar kaydı için oturum gerekli.");
    }

    final pair = await _keys.generateIdentityKeyPair();
    final data = await pair.extract();
    await _saveLocal(data);

    final backup = await _keys.backupPrivateKey(
      identityKeyPair: pair,
      securityPassphrase: securityPassphrase,
    );

    await _client.from("user_keys").upsert({
      "user_id": userId,
      "algorithm": "x25519",
      "public_key": base64Encode(backup.publicKey),
      "encrypted_private_key": base64Encode(backup.ciphertext),
      "private_key_mac_base64": base64Encode(backup.mac),
      "kdf_algorithm": backup.kdfAlgorithm,
      "kdf_salt_base64": base64Encode(backup.salt),
      "kdf_params": backup.kdfParams,
      "private_key_nonce_base64": base64Encode(backup.nonce),
      "key_version": 1,
    });
  }

  /// Supabase yedekten private key'i geri yükle (cihaz değişimi).
  Future<void> restoreIdentity({required String securityPassphrase}) async {
    final userId = _client.auth.currentUser?.id;
    if (userId == null) {
      throw StateError("Anahtar geri yükleme için oturum gerekli.");
    }

    final row = await _client
        .from("user_keys")
        .select()
        .eq("user_id", userId)
        .single();

    final backup = KeyBackup(
      algorithm: row["algorithm"] as String? ?? "x25519",
      kdfAlgorithm: row["kdf_algorithm"] as String,
      salt: base64Decode(row["kdf_salt_base64"] as String),
      nonce: base64Decode(row["private_key_nonce_base64"] as String),
      ciphertext: base64Decode(row["encrypted_private_key"] as String),
      mac: base64Decode(row["private_key_mac_base64"] as String),
      publicKey: base64Decode(row["public_key"] as String),
      kdfParams: Map<String, dynamic>.from(row["kdf_params"] as Map),
    );

    final data = await _keys.restorePrivateKey(
      backup: backup,
      securityPassphrase: securityPassphrase,
    );
    await _saveLocal(data);
  }

  Future<String?> currentUserId() async => _client.auth.currentUser?.id;
}
