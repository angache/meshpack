# MeshPack Cloud — Backend (Supabase)

Klinik ↔ **MeshPack Lab** için isteğe bağlı bulut köprüsü: vaka kuyruğu, mesajlaşma, bildirimler.

## Ürün modeli

| Mod | Ne yapılır | Bulut gerekir mi? |
|-----|------------|-------------------|
| **Yerel (varsayılan)** | Ölçü organize et, planla, CasePackage ZIP, Drive / e-posta | Hayır |
| **MeshPack Lab** | Yukarıdakilere ek: doğrudan lab kuyruğu, mesaj, durum senkronu | Evet |

Klinik uygulaması **kurulumdan sonra internetsiz çalışabilir**. Bulut yalnızca laboratuvar **MeshPack Lab** kullanıyorsa ve klinik lab ile eşleştirilmişse devreye girer.

Diğer laboratuvarlarla çalışırken: ZIP kaydet, Drive, e-posta — mevcut kanallar yeterli.

## Neden Supabase?

- **Postgres** — vaka, mesaj, bildirim ilişkisel model
- **Storage** — CasePackage ZIP (private bucket)
- **Realtime** — yeni mesaj / vaka / durum anlık
- **Auth** — klinik ve lab kullanıcıları
- **RLS** — organizasyon bazlı erişim
- **EU bölge** — KVKK için Frankfurt önerilir (+ DPA)

Firebase ile de yapılabilir; MeshPack veri modeli SQL’e daha yakın olduğu için Supabase tercih edildi.

## Mimari

```
┌─────────────────┐     CasePackage ZIP      ┌─────────────────┐
│ meshpack-clinic │ ───────────────────────► │ Supabase        │
│ (yerel SQLite)  │     manifest + metadata  │ Storage + DB    │
└─────────────────┘                          └────────┬────────┘
                                                        │ Realtime
                                               ┌────────▼────────┐
                                               │ meshpack-lab    │
                                               │ (vaka kuyruğu)  │
                                               └─────────────────┘
```

**Yerel-first:** Tüm hasta/vaka verisi SQLite'ta kalır. Buluta yalnızca MeshPack Lab'a gönderilen vaka gider.

## Gönderim kanalları

| Kanal | Ne zaman |
|-------|----------|
| ZIP kaydet / e-posta / Drive | Her lab (varsayılan) |
| MeshPack Lab (bulut) | Lab MeshPack Lab kullanıyorsa + klinik eşleşmişse |

## Tablolar

| Tablo | Amaç |
|-------|------|
| `organizations` | Klinik veya lab |
| `organization_members` | Kullanıcı ↔ org |
| `clinic_lab_links` | Hangi klinik hangi lab ile eşli |
| `cloud_cases` | Ortak vaka kaydı (`MP-…` + manifest özeti) |
| `case_messages` | Vaka bazlı chat |
| `notifications` | Okunmamış bildirimler |

Detaylı SQL: `supabase/migrations/20260706100000_meshpack_cloud.sql`

## Gönderim akışı (MeshPack Lab)

1. Klinik planlar → lab eşleşmişse **MeshPack Lab'a gönder**
2. ZIP → `case-packages/{clinic_org_id}/{case_id}.zip`
3. `cloud_cases` satırı oluşturulur (`status: sent`)
4. Lab org üyelerine `new_case` bildirimi
5. Lab uygulaması Realtime ile kuyruğu günceller
6. Mesajlar `case_messages` + push bildirimi

Drive / e-posta / ZIP **her zaman** kullanılabilir; bulut alternatif değil, MeshPack Lab'e özel kanaldır.

## Kurulum

1. [Supabase](https://supabase.com) projesi oluştur (region: **EU**)
2. SQL migration'ı çalıştır (Dashboard → SQL veya `supabase db push`)
3. `.env` dosyası:

```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

4. İlk organizasyonları seed edin (Dashboard SQL):

```sql
-- Örnek klinik + lab
INSERT INTO organizations (id, name, org_type, pairing_code)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Demo Klinik', 'clinic', 'KLINIK-DEMO'),
  ('00000000-0000-0000-0000-000000000002', 'Demo Lab', 'lab', 'LAB-DEMO');

INSERT INTO clinic_lab_links (clinic_org_id, lab_org_id)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
);
```

5. Auth ile kullanıcı oluştur → `organization_members` ekle

## KVKK notları

- Ölçü dosyaları kişisel veri içerir
- EU bölge + DPA zorunlu değerlendirme
- Storage private; RLS ile sadece eşli klinik/lab erişir
- Yerel dosya yolu manifest’e yazılmaz (zaten clinic tarafında böyle)

## Yerel oturum güvenliği

Supabase refresh token **localStorage yerine** şifreli kasada tutulur:

| Katman | Konum |
|--------|--------|
| Ana anahtar | macOS Keychain / Windows Credential Manager (`keyring`) |
| Yedek anahtar | `~/Library/Application Support/meshpack/secure/master.key` (0600) |
| Oturum verisi | `secure/vault.enc` — AES-256-GCM |

Kod: `src-tauri/src/secure_storage.rs` · `src/cloud/secureStorage.js`

Çıkış yapınca `sb-*` anahtarları kasadan silinir. İleride yerel PIN ile kasa anahtarı türetilecek.

## Yerel kullanıcılar (hesap + PIN)

Her klinik personeli **kendi hesabı** ile giriş yapar — denetim kaydında `user_name` saklanır.

| Özellik | Detay |
|---------|--------|
| İlk kurulum | Doktor adı + PIN |
| Giriş | Kullanıcı seç + PIN |
| Hash | Argon2 — `local_users` tablosu (SQLite) |
| Roller | `doctor` (kullanıcı ekler) · `assistant` |
| Idle timeout | Ayarlar → Genel → Oturum zaman aşımı |
| Eski tek PIN | `lock.json` → otomatik «Doktor» hesabına taşınır |

**Not:** Oturum ekranı uygulamayı bloke eder. SQLite dosyası henüz SQLCipher ile şifrelenmiyor (ileride).

Kod: `src-tauri/src/local_users.rs` · `src/appLock.js` · `src/localUsersUI.js`

## İşlem günlüğü (`activity_log`)

Tüm önemli işlemler tek tabloda — **Ayarlar → Günlük**.

| Kategori | Örnekler |
|----------|----------|
| `auth` | Giriş, oturum kapatma, ilk hesap |
| `scan` | Ölçü bağlama, yeniden atama, kaldırma |
| `patient` | Hasta oluşturma, silme |
| `case` | Planlama, durum değişimi |
| `send` | ZIP, e-posta, Drive, MeshPack Lab |
| `user` | Yeni kullanıcı ekleme |

Her kayıtta: zaman, kullanıcı adı, özet. Filtrelerle kategori bazlı görüntüleme.

Kod: `src-tauri/src/activity_log.rs` · `src/activityLog.js` · `src/auditLogUI.js`

## Kod

| Dosya | Açıklama |
|-------|----------|
| `src/cloud/supabaseClient.js` | Client + yapılandırma |
| `src/cloud/auth.js` | Giriş / oturum |
| `src/cloud/cases.js` | Vaka yükleme |
| `src/cloud/messages.js` | Mesajlaşma |
| `src/cloud/notifications.js` | Bildirimler + realtime |

## Sıradaki adımlar

- [ ] meshpack-lab uygulaması (aynı Supabase)
- [ ] Klinik–lab pairing UI (pairing_code)
- [ ] Desktop bildirimleri (Tauri notification plugin)
- [ ] Durum geçişleri: received → in_production → …
