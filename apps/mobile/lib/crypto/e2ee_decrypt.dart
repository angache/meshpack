import "dart:convert";
import "dart:typed_data";

import "package:cryptography/cryptography.dart";

import "e2ee_models.dart";

class E2eeDecrypt {
  E2eeDecrypt({
    X25519? x25519,
    Hkdf? hkdf,
    AesGcm? aesGcm,
  })  : _x25519 = x25519 ?? X25519(),
        _hkdf = hkdf ?? Hkdf(hmac: Hmac.sha256(), outputLength: 32),
        _aesGcm = aesGcm ?? AesGcm.with256bits();

  final X25519 _x25519;
  final Hkdf _hkdf;
  final AesGcm _aesGcm;

  Future<SecretKey> unwrapFileKey({
    required WrappedFileKey wrappedKey,
    required SimpleKeyPairData receiverPrivateKey,
  }) async {
    final sharedSecret = await _x25519.sharedSecretKey(
      keyPair: receiverPrivateKey,
      remotePublicKey: SimplePublicKey(
        wrappedKey.ephemeralPublicKey,
        type: KeyPairType.x25519,
      ),
    );

    final wrapKey = await _hkdf.deriveKey(
      secretKey: sharedSecret,
      nonce: utf8.encode("meshpack-ecies-v1"),
      info: utf8.encode("wrap-file-key"),
    );

    final fileKeyBytes = await _aesGcm.decrypt(
      SecretBox(
        wrappedKey.ciphertext,
        nonce: wrappedKey.nonce,
        mac: Mac(wrappedKey.mac),
      ),
      secretKey: wrapKey,
      aad: utf8.encode("meshpack-file-key"),
    );

    return SecretKey(fileKeyBytes);
  }

  Future<Uint8List> decryptBytes({
    required EncryptedBlob encryptedBlob,
    required SecretKey fileKey,
    List<int> aad = const [],
  }) async {
    final clear = await _aesGcm.decrypt(
      SecretBox(
        encryptedBlob.ciphertext,
        nonce: encryptedBlob.nonce,
        mac: Mac(encryptedBlob.mac),
      ),
      secretKey: fileKey,
      aad: aad,
    );
    return Uint8List.fromList(clear);
  }

  Future<Map<String, dynamic>> decryptMetadata({
    required EncryptedBlob encryptedBlob,
    required SecretKey fileKey,
  }) async {
    final clearBytes = await decryptBytes(
      encryptedBlob: encryptedBlob,
      fileKey: fileKey,
      aad: utf8.encode("metadata:v1"),
    );
    return jsonDecode(utf8.decode(clearBytes)) as Map<String, dynamic>;
  }
}
