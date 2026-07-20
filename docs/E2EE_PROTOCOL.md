# MeshPack E2EE Protocol v1

Bu dokuman, Klinik <-> Lab vaka transferi icin sifreleme protokolunu tanimlar.
Supabase plaintext saglik verisi gormez; yalnizca sifreli zarflari tasir.

## 1. Hedefler

- Zero-knowledge veri transferi
- Cihaz degisikliginde private key geri kazanimi
- Flutter ve Tauri/TS istemcileri arasinda wire-format uyumu
- Supabase RLS ile sadece gonderen/alici erisimi

## 2. Kripto Bilesenleri

| Islem | Algoritma |
|------|-----------|
| Kimlik keypair | X25519 |
| Dosya sifreleme | AES-256-GCM |
| File-key wrapping | ECIES (X25519 ECDH + HKDF + AES-256-GCM) |
| Key backup KDF | Argon2id (uygulama yoksa PBKDF2 fallback) |

## 3. Kayit (Registration)

1. Istemci `X25519` keypair uretir.
2. `public_key` dogrudan `user_keys.public_key` alanina yazilir.
3. `private_key` kullanicinin guvenlik parolasi ile sifrelenir:
   - KDF: Argon2id -> 32-byte AES key
   - Encrypt: AES-256-GCM
4. Ciphertext + salt + nonce + kdf params `user_keys` tablosuna yazilir.

## 4. Vaka Gonderme (Clinic -> Lab)

1. Gonderen, alicinin `public_key` bilgisini Supabase `user_keys` tablosundan alir.
2. Tek kullanimlik 32-byte `file_key` uretir.
3. Hasta metadata (json) AES-GCM ile sifrelenir -> `encrypted_metadata`.
4. Dosya bytes AES-GCM ile sifrelenir -> payload.
5. `file_key`, alici public key ile ECIES wrap edilir -> `encrypted_file_key`.
6. `cases` tablosuna satir insert edilir.
7. Sifreli payload `encrypted-cases` bucket'ina yuklenir.
8. `cases.storage_object_path` alanina dosya yolu update edilir.

## 5. Vaka Alma (Lab)

1. Alici, Realtime ile yeni `cases` kaydini yakalar.
2. Storage'dan sifreli payload indirir.
3. Kendi private key'i ile `encrypted_file_key` unwrap eder -> `file_key`.
4. `file_key` ile metadata + dosya decrypt eder.
5. Durumu `received` yapar.

## 6. Wire Format

### 6.1 `encrypted_file_key` (JSON)

```json
{
  "version": 1,
  "ephemeral_public_key_b64": "...",
  "nonce_b64": "...",
  "ciphertext_b64": "...",
  "mac_b64": "..."
}
```

### 6.2 `encrypted_metadata` (JSON)

```json
{
  "version": 1,
  "nonce_b64": "...",
  "ciphertext_b64": "...",
  "mac_b64": "..."
}
```

### 6.3 Storage payload binary

```
[4 bytes: version (u32 big-endian)]
[12 bytes: nonce]
[16 bytes: mac/tag]
[N bytes: ciphertext]
```

## 7. Supabase RLS Ozeti

- `user_keys`
  - SELECT: authenticated kullanicilar (key directory)
  - INSERT/UPDATE/DELETE: yalnizca `auth.uid() = user_id`
- `cases`
  - SELECT: sender veya receiver
  - INSERT: yalnizca sender kendi uid'siyle
  - UPDATE: sender/receiver status guncelleyebilir, kripto alanlar degismez
- `storage.objects` (`encrypted-cases` bucket)
  - SELECT: object path segment 1 veya 2 kullanici uid'si
  - INSERT/UPDATE/DELETE: yalnizca segment 1 (sender)

## 8. Tehdit Modeli Notlari

- Supabase DB dump: yalnizca ciphertext
- Supabase Storage compromise: yalnizca ciphertext
- Service-role veya DBA: plaintext goremez
- Tek zayif halka: kullanicinin guvenlik parolasi

## 9. Uretim Notlari

- Argon2id icin platformlarda audited native/lib secin.
- Parola deneme limiti + cihaz kilidi ekleyin.
- Key rotation ve eski vaka re-key stratejisi planlayin.
- Buyuk STL/OBJ dosyalari icin chunked encryption + resumable upload dusunun.
