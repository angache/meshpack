# MeshPack — Oturum özeti ve devam listesi

> Son güncelleme: **2026-07-07**  
> Kapanıp açıldığında buradan devam edin. Detaylı yol haritası için `todo.md`.

---

## Son commit

| Commit | Mesaj |
|--------|--------|
| `8abdeb1` | MeshPack Cloud, Lab uygulaması ve vaka mesajlaşma merkezini ekle. |

**Henüz commit edilmemiş değişiklikler var** (hizalama export, ana sayfa HTML fix sonrası düzeltmeler). Aşağıda “Bu oturumda commit dışı” bölümüne bakın.

---

## Ne yaptık? (özet)

### MeshPack Cloud (Supabase)

- Migration'lar: `supabase/migrations/`
  - `20260706100000_meshpack_cloud.sql` — temel şema, RLS, `case_messages`, `notifications`
  - `20260706120000_meshpack_lab_linking.sql` — klinik–lab bağlama RPC'leri
  - `20260707124500_fix_case_package_select_policy.sql` — lab'ın `case-packages` bucket'tan ZIP okuması
- Kurulum: `supabase/setup_mpack.sql`, `supabase/README.md`
- Klinik cloud UI: `src/cloud/` (`auth.js`, `cloudUI.js`, `labLinks.js`, `cases.js`)

### meshpack-lab (laboratuvar uygulaması)

- Ayrı Tauri + Vite uygulaması: `meshpack-lab/`
- Vaka kuyruğu, durum güncelleme, ZIP indirme
- 3B önizleme: `meshpack-lab/src/ui/meshPreview.js`
- Vaka detayında sağ sidebar mesajlar
- **Mesajlar sekmesi** (header): konuşma listesi + sohbet + bildirim paneli
- Klinik bağlantıları paneli (istek / onay / kod ile)

### Mesajlaşma ve bildirimler

| Taraf | Nerede | Dosyalar |
|-------|--------|----------|
| **Klinik** | Üst bar → **💬 Mesajlar** (tam ekran merkez) | `src/messagesHubUI.js`, `src/cloud/messagingHub.js`, `src/cloud/notifications.js` |
| **Klinik** | Planlama → Laboratuvar mesajları (küçük panel) | `src/planningCaseMessages.js` |
| **Lab** | Header → **Mesajlar** sekmesi | `meshpack-lab/src/ui/messagesHubUI.js` |
| **Lab** | Vaka detayı → sağ sidebar | `meshpack-lab/src/ui/app.js` |

Özellikler: konuşma listesi, arama, okunmamış rozet, realtime mesaj, bildirim merkezi, “tümünü okundu işaretle”, vakaya git / planlamada aç.

### Lab önizleme ve hizalama (kısmen)

- Önizleme infinite loop / titreme sorunları giderildi (`previewKey`, queue refresh patch)
- Klinik ile aynı mantık: varsayılan **tarayıcı hizası**; otomatik ICP yok
- **Commit dışı (henüz kaydedilmedi):** ZIP export'a `alignment.json` eklendi; planlama ve Drive upload hizayı paketliyor; lab `mode !== "scanner"` ise paket hizasını uyguluyor

### Diğer klinik işleri (önceki commit'te)

- Yerel kullanıcı / PIN kilidi, denetim günlüğü, DB yedekleme
- CasePackage manifest, gönderim geçmişi, akıllı hasta önerisi
- Planlama sayfası (FDI chart, annotation, VITA renk, cloud gönderim)

### Bilinen düzeltmeler

- Klinik ana sayfa kayboluyordu → `index.html`'de fazladan `</div>` kaldırıldı
- `.gitignore` → `**/src-tauri/target/` eklendi (lab build artefaktları commit'e girmesin)

---

## Bu oturumda commit dışı kalan dosyalar

```
src/alignment.js          — buildAlignmentPackage, resolveAlignmentFromSession
src/viewer.js             — applyAlignmentPackage, getAlignmentExport
src/planningPage.js       — alignment export + planlama yüklemede hiza
src/main.js               — planlamaya hiza aktarımı
src-tauri/src/lib.rs      — export_case_zip alignment parametresi
src-tauri/src/compression.rs
meshpack-lab/src/ui/app.js       — debug sadece DEV; hiza mode kontrolü
meshpack-lab/src/ui/meshPreview.js
todo.md
```

**Sonraki açılışta:** `git status` ile kontrol et; istersen ayrı commit: *"alignment.json export ve lab önizleme hizası"*.

---

## Nasıl çalıştırılır?

### Klinik (MeshPack)

```bash
cd meshpack
cp .env.example .env   # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run tauri dev
```

### Lab (MeshPack Lab)

```bash
cd meshpack-lab
cp .env.example .env   # aynı Supabase projesi
npm run tauri dev
```

### Supabase

- Migration'ları projeye uygula (`supabase db push` veya SQL Editor'de dosyalar)
- `supabase/README.md` adımlarını izle
- Storage bucket: `case-packages`

---

## Test vakası

- **MP-2026-0006** — önceki oturumlarda cloud + lab testi için kullanıldı
- Yeni hiza testi için: klinikten vakayı **yeniden MeshPack Lab'a gönder** (eski ZIP'te `alignment.json` olmayabilir)

---

## Yapmamız gerekenler (öncelik sırası)

### 🔴 Hemen (bir sonraki oturum)

1. **Commit** — commit dışı hizalama değişikliklerini kaydet
2. **Uçtan uca cloud testi**
   - Klinik: Cloud giriş → lab bağlı → vaka planla → **MeshPack Lab'a gönder**
   - Lab: kuyrukta görünsün → ZIP indir → önizleme hizalı mı?
   - Mesaj: klinik Mesajlar merkezinden yaz → lab'da anlık gelsin (ve tersi)
3. **Hizalama doğrulama**
   - Klinik planlama önizlemesi ile lab önizlemesi yan yana karşılaştır
   - ICP kullanıldıysa `alignment.json` içinde `mode: "icp"` olmalı
   - Hâlâ kayıksa: `meshpack-lab/src/ui/meshPreview.js` + `pickScanFilesFromZip` dosya eşleştirmesini kontrol et

### 🟡 Orta vadeli

| # | Konu | Not |
|---|------|-----|
| 4 | Desktop bildirimleri | Tauri notification plugin; şu an yalnızca in-app |
| 5 | Cloud E2E şifreleme | Token kasası var; vaka paketi E2E henüz yok |
| 6 | Durum senkronu polish | `received` → `in_production` → `shipped` akışı test |
| 7 | Offline gönderim kuyruğu | `todo.md` E5 |
| 8 | `origin/main` push | Son commit local'de; remote'a gönderilmedi |

### 🟢 İyileştirme / polish

- Planlama panelindeki küçük mesaj kutusu vs Mesajlar merkezi — ikisi de duruyor, UX birleştirme isteğe bağlı
- Lab `detail-preview-debug` — production'da gizli (sadece `import.meta.env.DEV`)
- `todo.md` Faz 3.2 MeshPack-Lab doğrudan gönderim → kısmen tamam, test eksik

---

## Önemli dosyalar (hızlı referans)

| Konu | Dosya |
|------|--------|
| Klinik mesaj merkezi | `src/messagesHubUI.js` |
| Lab mesaj merkezi | `meshpack-lab/src/ui/messagesHubUI.js` |
| Konuşma listesi API | `src/cloud/messagingHub.js` |
| Mesaj CRUD | `src/cloud/messages.js` |
| Bildirimler | `src/cloud/notifications.js` |
| Lab ana UI | `meshpack-lab/src/ui/app.js` |
| Lab 3B önizleme | `meshpack-lab/src/ui/meshPreview.js` |
| Klinik planlama | `src/planningPage.js` |
| ZIP export (Rust) | `src-tauri/src/compression.rs` |
| Storage RLS fix | `supabase/migrations/20260707124500_fix_case_package_select_policy.sql` |
| CasePackage spec | `docs/CASE_PACKAGE.md` |
| Yol haritası | `todo.md` |

---

## Kararlar (hatırlatma)

- Mesajlar **ayrı bölüm** — klinikte header butonu, lab'da sekme; bildirimler dahil
- Varsayılan hizalama: **tarayıcı**; ICP ayrı ve dikkatli kullanım
- Commit/PR yalnızca kullanıcı isteyince
- Türkçe UI

---

## Açık sorunlar / riskler

1. **Hizalama** — `alignment.json` yeni eklendi; eski cloud vakalarında dosya yok → yeniden gönderim gerekir
2. **Ana ekran HTML** — düzeltildi; regression için `index.html` `#app` yapısına dikkat
3. **Lab import** — `meshpack-lab` bazen `../../../src/alignment.js` kullanıyor; lab'ın kendi `messagingHub.js` / `notifications.js` kopyaları var (farklı Supabase client instance'ı için)
4. **Realtime** — Supabase publication'da `case_messages` ve `notifications` tabloları ekli olmalı

---

## Önerilen ilk 3 adım (yarın)

```
1. git status → hizalama değişikliklerini commit et
2. MP-2026-0006 (veya yeni vaka) ile cloud gönder + lab önizleme + mesaj testi
3. Hiza sorunu devam ederse: klinik planlama viewer vs lab meshPreview karşılaştırması
```

---

*Bu dosya oturum kapanışı için oluşturuldu. Güncellemek için üzerine yaz veya `todo.md` ile senkron tut.*
