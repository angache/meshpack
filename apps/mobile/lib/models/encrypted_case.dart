class EncryptedCase {
  const EncryptedCase({
    required this.id,
    required this.senderId,
    required this.receiverId,
    required this.encryptedMetadata,
    required this.encryptedFileKey,
    required this.storageBucket,
    required this.storageObjectPath,
    required this.createdAt,
  });

  final String id;
  final String senderId;
  final String receiverId;
  final Map<String, dynamic> encryptedMetadata;
  final Map<String, dynamic> encryptedFileKey;
  final String storageBucket;
  final String storageObjectPath;
  final DateTime createdAt;

  factory EncryptedCase.fromRow(Map<String, dynamic> row) {
    return EncryptedCase(
      id: row["id"] as String,
      senderId: row["sender_id"] as String,
      receiverId: row["receiver_id"] as String,
      encryptedMetadata: Map<String, dynamic>.from(row["encrypted_metadata"] as Map),
      encryptedFileKey: Map<String, dynamic>.from(row["encrypted_file_key"] as Map),
      storageBucket: row["storage_bucket"] as String,
      storageObjectPath: row["storage_object_path"] as String,
      createdAt: DateTime.parse(row["created_at"] as String),
    );
  }
}
