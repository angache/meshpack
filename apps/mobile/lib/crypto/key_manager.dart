import "dart:typed_data";

import "package:cryptography/cryptography.dart";
import "package:cryptography/helpers.dart";

import "e2ee_models.dart";

typedef RandomBytesFn = List<int> Function(int length);

class KeyManager {
  KeyManager({
    X25519? x25519,
    AesGcm? aesGcm,
    Argon2id? argon2id,
    RandomBytesFn? randomBytesFn,
  })  : _x25519 = x25519 ?? X25519(),
        _aesGcm = aesGcm ?? AesGcm.with256bits(),
        _argon2id = argon2id ??
            Argon2id(
              parallelism: 1,
              memory: 64 * 1024,
              iterations: 3,
              hashLength: 32,
            ),
        _randomBytes = randomBytesFn ?? randomBytes;

  final X25519 _x25519;
  final AesGcm _aesGcm;
  final Argon2id _argon2id;
  final RandomBytesFn _randomBytes;

  Future<SimpleKeyPair> generateIdentityKeyPair() async {
    return _x25519.newKeyPair();
  }

  Future<Uint8List> exportPublicKey(SimpleKeyPair keyPair) async {
    final pk = await keyPair.extractPublicKey();
    return Uint8List.fromList(pk.bytes);
  }

  Future<KeyBackup> backupPrivateKey({
    required SimpleKeyPair identityKeyPair,
    required String securityPassphrase,
  }) async {
    final keyData = await identityKeyPair.extract();
    final privateBytes = Uint8List.fromList(keyData.bytes);
    final publicBytes = Uint8List.fromList(keyData.publicKey.bytes);

    final salt = Uint8List.fromList(_randomBytes(16));
    final nonce = Uint8List.fromList(_randomBytes(12));
    final passwordBytes = Uint8List.fromList(securityPassphrase.codeUnits);

    final derived = await _argon2id.deriveKey(
      secretKey: SecretKey(passwordBytes),
      nonce: salt,
    );

    final encrypted = await _aesGcm.encrypt(
      privateBytes,
      secretKey: derived,
      nonce: nonce,
      aad: utf8Aad,
    );

    return KeyBackup(
      algorithm: "x25519",
      kdfAlgorithm: "argon2id",
      salt: salt,
      nonce: nonce,
      ciphertext: Uint8List.fromList(encrypted.cipherText),
      mac: Uint8List.fromList(encrypted.mac.bytes),
      publicKey: publicBytes,
      kdfParams: const {
        "memoryKib": 65536,
        "iterations": 3,
        "parallelism": 1,
        "length": 32,
      },
    );
  }

  Future<SimpleKeyPairData> restorePrivateKey({
    required KeyBackup backup,
    required String securityPassphrase,
  }) async {
    final argon = Argon2id(
      parallelism: (backup.kdfParams["parallelism"] as num?)?.toInt() ?? 1,
      memory: (backup.kdfParams["memoryKib"] as num?)?.toInt() ?? 64 * 1024,
      iterations: (backup.kdfParams["iterations"] as num?)?.toInt() ?? 3,
      hashLength: (backup.kdfParams["length"] as num?)?.toInt() ?? 32,
    );

    final passwordBytes = Uint8List.fromList(securityPassphrase.codeUnits);
    final derived = await argon.deriveKey(
      secretKey: SecretKey(passwordBytes),
      nonce: backup.salt,
    );

    final clear = await _aesGcm.decrypt(
      SecretBox(
        backup.ciphertext,
        nonce: backup.nonce,
        mac: Mac(backup.mac),
      ),
      secretKey: derived,
      aad: utf8Aad,
    );

    return SimpleKeyPairData(
      clear,
      publicKey: SimplePublicKey(backup.publicKey, type: KeyPairType.x25519),
      type: KeyPairType.x25519,
    );
  }

  static final utf8Aad = "meshpack-key-backup-v1".codeUnits;
}
