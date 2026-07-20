import "dart:convert";
import "dart:typed_data";

import "package:cryptography/cryptography.dart";
import "package:cryptography/helpers.dart";

import "e2ee_models.dart";

typedef RandomBytesFn = List<int> Function(int length);

class E2eeEncrypt {
  E2eeEncrypt({
    X25519? x25519,
    Hkdf? hkdf,
    AesGcm? aesGcm,
    RandomBytesFn? randomBytesFn,
  })  : _x25519 = x25519 ?? X25519(),
        _hkdf = hkdf ?? Hkdf(hmac: Hmac.sha256(), outputLength: 32),
        _aesGcm = aesGcm ?? AesGcm.with256bits(),
        _randomBytes = randomBytesFn ?? randomBytes;

  final X25519 _x25519;
  final Hkdf _hkdf;
  final AesGcm _aesGcm;
  final RandomBytesFn _randomBytes;

  Future<SecretKey> generateFileKey() async {
    return SecretKey(_randomBytes(32));
  }

  Future<EncryptedBlob> encryptBytes({
    required Uint8List clearBytes,
    required SecretKey fileKey,
    List<int> aad = const [],
  }) async {
    final nonce = Uint8List.fromList(_randomBytes(12));
    final secretBox = await _aesGcm.encrypt(
      clearBytes,
      secretKey: fileKey,
      nonce: nonce,
      aad: aad,
    );
    return EncryptedBlob(
      version: 1,
      nonce: nonce,
      ciphertext: Uint8List.fromList(secretBox.cipherText),
      mac: Uint8List.fromList(secretBox.mac.bytes),
    );
  }

  Future<EncryptedBlob> encryptMetadata({
    required Map<String, dynamic> metadata,
    required SecretKey fileKey,
  }) async {
    final bytes = Uint8List.fromList(utf8.encode(jsonEncode(metadata)));
    return encryptBytes(
      clearBytes: bytes,
      fileKey: fileKey,
      aad: utf8.encode("metadata:v1"),
    );
  }

  Future<WrappedFileKey> wrapFileKeyForReceiver({
    required SecretKey fileKey,
    required SimplePublicKey receiverPublicKey,
  }) async {
    final ephemeral = await _x25519.newKeyPair();
    final sharedSecret = await _x25519.sharedSecretKey(
      keyPair: ephemeral,
      remotePublicKey: receiverPublicKey,
    );

    final wrapKey = await _hkdf.deriveKey(
      secretKey: sharedSecret,
      nonce: utf8.encode("meshpack-ecies-v1"),
      info: utf8.encode("wrap-file-key"),
    );

    final nonce = Uint8List.fromList(_randomBytes(12));
    final fileKeyBytes = await fileKey.extractBytes();
    final wrapped = await _aesGcm.encrypt(
      fileKeyBytes,
      secretKey: wrapKey,
      nonce: nonce,
      aad: utf8.encode("meshpack-file-key"),
    );

    final epk = await ephemeral.extractPublicKey();
    return WrappedFileKey(
      version: 1,
      ephemeralPublicKey: Uint8List.fromList(epk.bytes),
      nonce: nonce,
      ciphertext: Uint8List.fromList(wrapped.cipherText),
      mac: Uint8List.fromList(wrapped.mac.bytes),
    );
  }
}
