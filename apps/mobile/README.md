# MeshPack Mobile (E2EE)

Flutter istemcisi — uçtan uca şifreli vaka transferi (Klinik ↔ Lab).

Protokol: [`docs/E2EE_PROTOCOL.md`](../../docs/E2EE_PROTOCOL.md)

## Kurulum

```bash
cd apps/mobile
cp .env.example .env   # Supabase URL + anon key doldur
flutter pub get
flutter run -d macos   # veya ios / android
```

Supabase'de önce migration çalıştır:

`supabase/migrations/20260720100000_e2ee_schema.sql`

## Demo akış

1. İki hesap oluştur (cihaz veya iki simülatör)
2. Her hesapta **Anahtar üret** (güvenlik parolası)
3. Alıcı User ID'yi kopyala → göndericiye yapıştır
4. **Şifreli demo vaka gönder**
5. Alıcı realtime ile decrypt log'unu görür

## Yapı

```
lib/
├── crypto/       X25519, AES-GCM, ECIES
├── models/       EncryptedCase
├── services/     Supabase, key, gönderim, alma
└── main.dart     Auth + demo UI
```

Paylaşılan TS kripto: [`packages/crypto`](../../packages/crypto)
