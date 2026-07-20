# Supabase — MeshPack Cloud (MeshPack Lab köprüsü)

Bulut altyapısı **isteğe bağlıdır**. Klinik uygulaması yerelde tam çalışır; Supabase yalnızca MeshPack Lab kullanan laboratuvarlarla iletişim içindir.

## Hızlı başlangıç

```bash
# Supabase CLI (opsiyonel)
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

CLI yoksa: Dashboard → **SQL Editor** → sırayla çalıştırın:

1. `migrations/20260706100000_meshpack_cloud.sql` (şema)
2. `migrations/20260706110000_meshpack_onboarding.sql` (kayıt RPC)
3. `migrations/20260706120000_meshpack_lab_linking.sql` (lab listesi + istek/onay)
4. `migrations/20260706130000_fix_handle_new_user.sql` (kayıt HTTP 500 düzeltmesi — gerekirse)
5. `migrations/20260720100000_e2ee_schema.sql` (E2EE vaka transferi — `user_keys`, `cases`, `encrypted-cases`)

Veya tek seferde: `setup_mpack.sql`

## Ortam değişkenleri

Proje kökünde `.env` (gitignore'da):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

`npm run tauri dev` öncesi `.env` dosyasının dolu olduğundan emin olun.

## Kullanıcı ve organizasyon

**Manuel SQL gerekmez.** Uygulama içinden:

1. **Ayarlar → MeshPack Cloud → Kayıt ol** — e-posta, şifre, klinik/lab adı
2. Lab hesabı: eşleştirme kodu otomatik gösterilir (kliniğe verin)
3. Klinik ↔ lab bağlantısı (üç yöntem):
   - **Kod ile anında bağlan** — klinik lab kodunu girer (onay gerekmez)
   - **Lab ara / istek gönder** — klinik listeden lab bulur, lab onaylar
   - **Lab kliniğe istek atar** — lab klinik kodunu girer veya arar, klinik onaylar

Geliştirme için Supabase → **Authentication → Providers → Email** → "Confirm email" kapatabilirsiniz.

**Kayıt HTTP 500 alıyorsanız:**
1. Confirm email → **kapalı** → Save (değişikliği kaydettiğinizden emin olun)
2. **Authentication → Users** — yarım kalmış kullanıcıyı silin, tekrar deneyin
3. **Logs → Auth** — gerçek hata mesajına bakın
4. Hâlâ 500 ise SQL Editor'da `migrations/20260706130000_fix_handle_new_user.sql` çalıştırın

Oturum token'ları `~/Library/Application Support/meshpack/secure/` altında şifreli kasada tutulur (Keychain + AES-256-GCM).

## MeshPack Lab (laboratuvar uygulaması)

Ayrı masaüstü uygulaması: `meshpack-lab/`

```bash
cd meshpack-lab
cp ../.env .env   # aynı Supabase projesi
npm install
npm run tauri dev
```

Lab hesabı kaydı → eşleştirme kodunu kliniğe verin → klinik bağlasın → vakalar kuyrukta görünür.

Demo org seed (`setup_mpack.sql` içinde) isteğe bağlıdır; gerçek kullanımda kayıt akışı yeterlidir.
