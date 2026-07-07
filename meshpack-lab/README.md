# MeshPack Lab

Laboratuvar tarafı masaüstü uygulaması — klinikten gelen vakaları kuyrukta görür, CasePackage ZIP indirir, durum günceller ve klinikle mesajlaşır.

## Gereksinimler

- Node.js 20+
- Rust (Tauri için)
- Supabase projesi (klinik ile aynı)

## Kurulum

```bash
cd meshpack-lab
npm install
```

`.env` dosyası (klinik ile aynı Supabase projesi):

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

İpucu: Kök dizindeki `.env` dosyasını kopyalayabilirsiniz:

```bash
cp ../.env .env
```

## Çalıştırma

```bash
# Masaüstü (önerilen)
npm run tauri dev

# Yalnızca web (hızlı test)
npm run dev
```

Web: http://localhost:1430

## İlk kullanım

1. **Kayıt ol** — laboratuvar adı + e-posta + şifre (`org_type: lab`)
2. **Eşleştirme kodunu** kliniğe verin (üst çubukta görünür)
3. Klinik tarafında: Ayarlar → MeshPack Cloud → lab kodunu girerek bağla
4. Klinik planlama sayfasından **MeshPack Lab** ile vaka gönder
5. Lab uygulamasında vaka kuyruğunda görünür → ZIP indir, durum güncelle, mesaj yaz

## Özellikler (MVP)

- Vaka kuyruğu (durum filtresi)
- Realtime güncelleme (yeni vaka, durum değişimi)
- CasePackage ZIP indirme (Tauri kaydet diyaloğu)
- Durum akışı: Gönderildi → Alındı → Üretimde → …
- Vaka açılınca otomatik **Alındı** işaretleme
- Klinik ↔ lab mesajlaşma (Realtime)

## Sorun giderme

### Kayıt 500 hatası (`signup` failed)

Supabase Dashboard → **Authentication → Providers → Email**:

- Geliştirme için **Confirm email** kapalı olsun
- SMTP ayarlanmadıysa e-posta onayı açıkken kayıt 500 verebilir

Aynı e-posta daha önce kayıtlıysa **Giriş** sekmesini kullanın.

### `dialog.message not allowed`

Tauri capabilities eksikse oluşur. `src-tauri/capabilities/default.json` içinde `dialog:default` olmalı. Değişiklikten sonra uygulamayı yeniden başlatın:

```bash
npm run tauri dev
```


- 3B önizleme (PLY viewer)
- Desktop bildirimleri
- E2E şifreli paket çözme
- Çoklu lab kullanıcısı / roller
