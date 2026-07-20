import "dart:convert";
import "dart:typed_data";

import "package:cryptography/cryptography.dart";
import "package:supabase_flutter/supabase_flutter.dart";

import "../crypto/e2ee_decrypt.dart";
import "../crypto/e2ee_models.dart";
import "../models/encrypted_case.dart";
import "supabase_service.dart";

class DecryptedCasePayload {
  const DecryptedCasePayload({
    required this.caseEnvelope,
    required this.metadata,
    required this.fileBytes,
  });

  final EncryptedCase caseEnvelope;
  final Map<String, dynamic> metadata;
  final Uint8List fileBytes;
}

class CaseReceiver {
  CaseReceiver({
    SupabaseClient? client,
    E2eeDecrypt? decryptor,
  })  : _client = client ?? SupabaseService.client,
        _decryptor = decryptor ?? E2eeDecrypt();

  final SupabaseClient _client;
  final E2eeDecrypt _decryptor;

  RealtimeChannel subscribeIncoming({
    required void Function(EncryptedCase incomingCase) onCase,
  }) {
    final uid = _client.auth.currentUser?.id;
    if (uid == null) throw StateError("Realtime icin oturum gerekli.");

    final channel = _client.channel("incoming_cases_$uid")
      ..onPostgresChanges(
        event: PostgresChangeEvent.insert,
        schema: "public",
        table: "cases",
        filter: PostgresChangeFilter(
          type: PostgresChangeFilterType.eq,
          column: "receiver_id",
          value: uid,
        ),
        callback: (payload) => onCase(
          EncryptedCase.fromRow(payload.newRecord),
        ),
      )
      ..subscribe();

    return channel;
  }

  Future<DecryptedCasePayload> fetchAndDecryptCase({
    required EncryptedCase encryptedCase,
    required SimpleKeyPairData receiverPrivateKey,
  }) async {
    final wrapped = WrappedFileKey.fromJson(encryptedCase.encryptedFileKey);
    final metadataBlob = EncryptedBlob.fromJson(encryptedCase.encryptedMetadata);

    final encryptedPayload = await _client.storage
        .from(encryptedCase.storageBucket)
        .download(encryptedCase.storageObjectPath);

    final fileBlob = _decodePayload(encryptedPayload);
    final fileKey = await _decryptor.unwrapFileKey(
      wrappedKey: wrapped,
      receiverPrivateKey: receiverPrivateKey,
    );

    final metadata = await _decryptor.decryptMetadata(
      encryptedBlob: metadataBlob,
      fileKey: fileKey,
    );

    final fileBytes = await _decryptor.decryptBytes(
      encryptedBlob: fileBlob,
      fileKey: fileKey,
      aad: utf8.encode("file:v1:${metadata["originalFilename"] ?? ""}"),
    );

    await _client.from("cases").update({
      "status": "received",
    }).eq("id", encryptedCase.id);

    return DecryptedCasePayload(
      caseEnvelope: encryptedCase,
      metadata: metadata,
      fileBytes: fileBytes,
    );
  }

  EncryptedBlob _decodePayload(Uint8List payload) {
    if (payload.length < 32) {
      throw const FormatException("Invalid encrypted payload.");
    }

    final bd = ByteData.sublistView(payload);
    final version = bd.getUint32(0, Endian.big);
    final nonce = payload.sublist(4, 16);
    final mac = payload.sublist(16, 32);
    final ciphertext = payload.sublist(32);
    return EncryptedBlob(
      version: version,
      nonce: Uint8List.fromList(nonce),
      ciphertext: Uint8List.fromList(ciphertext),
      mac: Uint8List.fromList(mac),
    );
  }
}
