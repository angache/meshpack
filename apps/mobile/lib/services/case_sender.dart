import "dart:convert";
import "dart:typed_data";

import "package:cryptography/cryptography.dart";
import "package:supabase_flutter/supabase_flutter.dart";

import "../crypto/e2ee_encrypt.dart";
import "../crypto/e2ee_models.dart";
import "supabase_service.dart";

class CaseSender {
  CaseSender({
    SupabaseClient? client,
    E2eeEncrypt? encryptor,
  })  : _client = client ?? SupabaseService.client,
        _encryptor = encryptor ?? E2eeEncrypt();

  final SupabaseClient _client;
  final E2eeEncrypt _encryptor;

  Future<SimplePublicKey> fetchReceiverPublicKey(String receiverId) async {
    final row = await _client
        .from("user_keys")
        .select("public_key")
        .eq("user_id", receiverId)
        .single();

    final b64 = row["public_key"] as String;
    return SimplePublicKey(base64Decode(b64), type: KeyPairType.x25519);
  }

  Future<String> sendEncryptedCase({
    required String receiverId,
    required Map<String, dynamic> patientMetadata,
    required Uint8List clearFileBytes,
    required String originalFilename,
  }) async {
    final senderId = _client.auth.currentUser?.id;
    if (senderId == null) {
      throw StateError("Gonderim icin once oturum acilmali.");
    }

    final receiverPub = await fetchReceiverPublicKey(receiverId);
    final fileKey = await _encryptor.generateFileKey();
    final encryptedMetadata = await _encryptor.encryptMetadata(
      metadata: patientMetadata,
      fileKey: fileKey,
    );
    final encryptedFile = await _encryptor.encryptBytes(
      clearBytes: clearFileBytes,
      fileKey: fileKey,
      aad: utf8.encode("file:v1:$originalFilename"),
    );
    final wrappedKey = await _encryptor.wrapFileKeyForReceiver(
      fileKey: fileKey,
      receiverPublicKey: receiverPub,
    );

    final inserted = await _client
        .from("cases")
        .insert({
          "sender_id": senderId,
          "receiver_id": receiverId,
          "encrypted_metadata": encryptedMetadata.toJson(),
          "encrypted_file_key": wrappedKey.toJson(),
          "storage_bucket": "encrypted-cases",
          "storage_object_path": "$senderId/$receiverId/pending/payload.enc",
          "status": "sent",
        })
        .select("id")
        .single();

    final caseId = inserted["id"] as String;
    final objectPath = "$senderId/$receiverId/$caseId/payload.enc";
    final payload = _encodePayload(encryptedFile);

    await _client.storage.from("encrypted-cases").uploadBinary(
          objectPath,
          payload,
          fileOptions: const FileOptions(
            contentType: "application/octet-stream",
            upsert: true,
          ),
        );

    await _client.from("cases").update({
      "storage_object_path": objectPath,
      "file_size_bytes": payload.length,
      "file_sha256": null,
    }).eq("id", caseId);

    return caseId;
  }

  Uint8List _encodePayload(EncryptedBlob blob) {
    final out = BytesBuilder();
    out.add(_u32(blob.version));
    out.add(blob.nonce);
    out.add(blob.mac);
    out.add(blob.ciphertext);
    return out.toBytes();
  }

  Uint8List _u32(int value) {
    final b = ByteData(4);
    b.setUint32(0, value, Endian.big);
    return b.buffer.asUint8List();
  }
}
