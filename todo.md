# MeshPack — Ürün yol haritası

> Klinik ↔ laboratuvar dijital iş akışı. Son güncelleme: 2026-07-07.

---

## Vizyon (tek cümle)

Tarayıcıdan düşen ölçü → hastaya bağlanır → planlanır → güvenli şekilde lab’a gider → klinik–lab WhatsApp’sız iletişir.

---

## Faz 1 — Ölçü alımı ve hasta eşleştirme `BÜYÜK ÖLÇÜDE BİTTİ`

**Hedef:** Ölçü klasöre düşer, gruplanır, hastaya bağlanır; bağlandıktan sonra başka hastaya geçemez.

| # | Özellik | Durum | Not |
|---|---------|-------|-----|
| 1.1 | Klasör izleme (watch) | ✅ | |
| 1.2 | Dosya adından otomatik grup (üst/alt/kapanış seti) | ✅ | İsim öneki + gün |
| 1.3 | Hasta veritabanı (SQLite) | ✅ | Klinik hasta kaydı |
| 1.4 | Grup olarak hastaya bağlama | ✅ | Tek tık / yeni hasta |
| 1.5 | **Ölçü kilidi** — bağlı ölçü normalde taşınamaz | ✅ | Varsayılan: kilitli; casual unlink yok |
| 1.5a | **Yanlış eşleştirme: yeniden atama** | ✅ | “Düzelt” + gerekçe + audit log |
| 1.6 | Yeni ölçü bildirimi + gruba git | ✅ | Banner + gruba kaydır; iyileştirilebilir |
| 1.7 | Mevcut hastaya otomatik öneri | ✅ MVP | Kural + Jaro-Winkler + alias; **“Bu değil”** reddi |
| 1.8 | Ölçü / vaka durumu akışı | ✅ Kısmen | Şerit + planlama açılışında `linked`→`planning` |
| 1.9 | **Aynı gün ikinci ölçü** — hekime sor | ✅ | Modal: mevcut vaka / yeni vaka |

---

## Faz 2 — Planlama sayfası ve gönderim hazırlığı `BÜYÜK ÖLÇÜDE BİTTİ`

**Hedef:** Lab’a gitmeden önce iş emri netleşir. Planlama **ayrı bir sayfa**dır; lab notu, dental chart ve diğer plan alanları **vaka bazlı** (`cases` kaydı) tutulur.

### Sayfa ayrımı (onaylandı)

| Sayfa | Amaç | Odak |
|-------|------|------|
| **Ölçü / Inbox** (mevcut ana ekran) | Klasörden düşen ölçüleri grupla, hastaya bağla, önizle | Hızlı eşleştirme |
| **Planlama** (tam ekran sayfa) | Seçili vaka için iş emrini hazırla | Lab notu, FDI chart, annotation, gönderim özeti |

Ana ekrandaki footer sadeleştirildi — iş emri ve gönderim yalnızca **Planla** sayfasında.

### Planlama sayfası — vaka bağlamı

Her planlama oturumu tek bir vakaya kilitli:

- `MP-2026-0042` · hasta adı · ölçü tarihi
- Durum: `Bağlandı` → `Planlanıyor` → `Gönderime hazır` → `Gönderildi`
- Bu vakaya bağlı ölçü seti (üst / alt / kapanış) + 3B önizleme
- `cases.lab_notes`, `dental_plan`, `annotations`, `tooth_shade`

Giriş yolları:

1. Hasta detayında geçmiş vakadan **Planla** veya vakaya tıkla — ✅
2. Yeni bağlanan set sonrası **“Planlamaya geç”** banner — ✅

| # | Özellik | Durum | Not |
|---|---------|-------|-----|
| 2.0 | **Planlama sayfası** (ayrı tam ekran view) | ✅ MVP | Lab notu, FDI, 3B, VITA renk, gönderim özeti |
| 2.1 | Vaka / iş emri kavramı | ✅ | `cases` + `MP-YYYY-NNNN` |
| 2.2 | Serbest metin not (lab notu) | ✅ | `cases.lab_notes` planlama sayfasında |
| 2.3 | Şablon notlar (Zirkonyum, vb.) | ✅ MVP | Planlama sayfası; `labNoteTemplates.js` |
| 2.4 | **Dental chart (FDI 11–48)** | ✅ MVP | `dentalTreatments.js` |
| 2.4a | Protez kataloğu (config) | ✅ | Ayarlar → Planlama sekmesi |
| 2.4b | Diş rengi (VITA Classical / 3D-Master) | ✅ MVP | `cases.tooth_shade`; planlama sekmeleri |
| 2.5 | Ölçü görseli üzerine işaretleme / not | ✅ MVP | `annotations` JSON + 3B viewer |
| 2.6 | “Gönderime hazır” işaretle | ✅ MVP | Kontrol listesi + otomatik geçiş (e-posta/Drive) |
| 2.7 | Gönderim önizleme özeti | ✅ MVP | Kopyala / mailto / Drive; vaka bazlı |
| 2.8 | Eski ölçüler için vaka backfill | ✅ | `case_id` boş kayıtlar + stem alias backfill |

---

## Faz 3 — Laboratuvara gönderim `KISMEN`

**Hedef:** Varsayılan yerel kanallar (ZIP, Drive, e-posta). Bulut yalnızca MeshPack Lab ortağı varsa.

| # | Özellik | Durum | Not |
|---|---------|-------|-----|
| 3.0 | **MeshPack Lab (bulut)** | ✅ İskelet | Lab eşleşince görünür; şifreleme sıradaki |
| 3.1 | Google Drive ZIP yükleme | ✅ | Genel lab kanalı |
| 3.2 | **MeshPack-Lab** doğrudan gönderim | 🔲 Devam | Cloud kuyruğu + lab uygulaması MVP başladı |
| 3.3 | E-posta ile gönderim | ✅ Kısmen | ZIP + mailto; gönderildi onayı |
| 3.4 | CasePackage ZIP kaydet | ✅ | Dropbox / manuel paylaşım |
| 3.5 | Gönderim geçmişi ve durum | ✅ MVP | Ayarlar → Gönderim |
| 3.6 | Gönderim sonrası arşiv / sil / taşı | ✅ Kısmen | Ayarlarda `after_upload` |

---

## Faz 4 — MeshPack-Lab ve güvenli iş akışı `BAŞLADI`

**Hedef:** Supabase üzerinden klinik–lab: vaka, mesaj, bildirim.

| # | Özellik | Durum | Not |
|---|---------|-------|-----|
| 4.0 | Supabase şema + RLS | ✅ | `supabase/migrations/` |
| 4.1 | Ortak vaka ID (klinik + lab aynı kaydı görür) | ✅ Kısmen | `cloud_cases.id` = klinik `cases.id` |
| 4.2 | Uçtan uca şifreleme / KVKK uyumu | 🔲 Kısmen | Bulut token şifreli kasa ✅; vaka E2E sıradaki |
| 4.3 | Lab tarafında vaka kuyruğu | ✅ MVP | `meshpack-lab/` — kuyruk, ZIP, mesaj, durum |
| 4.4 | Durum senkronu (alındı, üretimde, kargoda, tamam) | 🔲 Kısmen | `cloud_case_status` enum hazır |
| 4.5 | **Anlık mesajlaşma** (vaka bazlı chat) | ✅ Kısmen | Mesajlar merkezi + planlama paneli + lab sekmesi |
| 4.6 | Dosya + mesaj + plan tek vakada | ✅ Kısmen | Cloud upload + manifest |
| 4.7 | Bildirimler (yeni mesaj, yeni vaka) | ✅ Kısmen | Bildirim paneli + header rozeti + Realtime |

---

## Faz 6 — MeshPack Lab Mobile (kısıtlı companion) `PLANLANDI`

**Hedef:** Lab personeli yolda/telefondan mesajlara cevap verir; dosya ve 3D işleri desktop’ta kalır.

> Detaylı mimari: [`docs/LAB_MOBILE.md`](docs/LAB_MOBILE.md)

| # | Özellik | Durum | Not |
|---|---------|-------|-----|
| 6.0 | Mimari + karar dokümanı | ✅ | `docs/LAB_MOBILE.md` |
| 6.1 | Expo projesi (`meshpack-lab-mobile/`) | 🔲 | RN + Expo Router |
| 6.2 | Cloud modül taşıma | 🔲 | `auth`, `messages`, `notifications`, `messagingHub` |
| 6.3 | Giriş + lab org kontrolü | 🔲 | `org_type === 'lab'` |
| 6.4 | Konuşma listesi + sohbet | 🔲 | RPC + sayfalama + realtime |
| 6.5 | Local-first unread (hub pattern) | 🔲 | `messagesHubUI.js` mantığı |
| 6.6 | `device_tokens` + push migration | 🔲 | FCM/APNs |
| 6.7 | Edge Function push delivery | 🔲 | `notifications` INSERT webhook |
| 6.8 | Deep link (bildirim → sohbet) | 🔲 | Expo Notifications |
| 6.9 | Vaka özeti kartı (metadata) | 🔲 | manifest + dental_plan özet |
| 6.10 | Thumbnail önizleme | 🔲 v2 | Sunucu PNG; tam 3D yok |
| 6.11 | Storage erişimi mobilde kapalı | 🔲 | RLS / policy bilinçli red |

**Bilinçli kapsam dışı:** ZIP indirme, 3D viewer, durum güncelleme (v1), klinik bağlantı yönetimi.

---

## Faz 5 — İyileştirmeler ve polish `SONRA`

| # | Özellik | Durum | Not |
|---|---------|-------|-----|
| 5.1 | Sidexis benzeri hasta listesi / detay UX | ✅ Kısmen | Durum + vaka sütunu, sıralama, özet şerit |
| 5.2 | Açık/koyu tema, okunabilirlik | ✅ Kısmen | Tema + density ayarlarda; sürekli iyileştirme |
| 5.3 | Çoklu klinik / çoklu kullanıcı | ✅ Kısmen | Yerel kullanıcı + denetimde `user_name` |
| 5.4 | Yedekleme ve hasta DB export | ✅ MVP | Ayarlar → Genel; İndirilenler/MeshPack/backups |

---

## Önerilen ekler — durum

| # | Özellik | Durum |
|---|---------|-------|
| E1 | Vaka numarası (`MP-2026-0042`) | ✅ |
| E2 | Ölçü kilidi + denetim kaydı (`audit_log`) | ✅ | Ayarlar → Günlük (birleşik `activity_log`) |
| E3 | Durum şeridi (Bağlandı → … → Gönderildi) | ✅ Kısmen — vaka önizleme + planlama toolbar |
| E4 | Akıllı hasta önerisi + öğrenen önek | ✅ MVP |
| E5 | Offline gönderim kuyruğu | 🔲 |
| E6 | Annotation formatı (JSON, lab viewer uyumu) | ✅ MVP (lab viewer yok) |
| E7 | Dental chart veri modeli (genişletme) | 🔲 Kısmen — FDI + protez tipi; materyal/implant sonra |
| E8 | MeshPack-Lab / `CasePackage` protokolü | ✅ Spec v1 — `docs/CASE_PACKAGE.md` + `manifest.json` |

---

## Kararlar (onaylandı)

| Konu | Karar |
|------|--------|
| Dental chart | **FDI (11–48)** |
| MeshPack-Lab | Şu an **sadece vizyon** — önce klinik tarafı + `CasePackage` spec |
| Ölçü taşıma | **Varsayılan kilitli.** Sadece **yanlış eşleştirme** için reassign + audit |
| Aynı gün ikinci ölçü | **Hekime sor** |
| Gönderim (lab yokken) | **ZIP / Drive / e-posta** — bulut gerekmez |
| Gönderim (MeshPack Lab) | **Bulut** — eşleştirme + şifreli iletişim (hedef) |
| Bulut zorunluluğu | **Hayır** — yalnızca MeshPack Lab ortağı |
| Yerel uygulama kilidi | **Doktor / Asistan + PIN** — denetimde kim yaptı kayıtlı |
| Planlama UI | **Ayrı tam ekran sayfa** — inbox sadece eşleştirme + önizleme |

---

## Önerilen sıra (güncel)

```
1. Vaka modeli + durum pill ✅
2. Ölçü kilidi + reassign + aynı gün sorusu ✅
3. Eski ölçü backfill ✅
4. Planlama sayfası kabuğu ✅
5. Dental chart MVP ✅
6. 3B annotation ✅
7. Gönderim özeti + Drive/mailto ✅
8. Akıllı hasta önerisi + alias tablosu ✅
9. Inbox footer + planlama şablonları + planlamaya geç banner ✅
─── sıradaki ───
10. Durum state machine polish (otomatik geçişler) ✅ kısmen
11. E-posta ZIP + gönderim geçmişi UI ✅ kısmen
─── sıradaki ───
12. CasePackage spec + manifest export ✅
─── sıradaki ───
13. MeshPack Cloud (Supabase) iskelet ✅
14. meshpack-lab uygulaması (cloud kuyruğu + mesaj) ✅ MVP
15. Uçtan uca cloud test + klinik mesaj UI ✅ kısmen
16. alignment.json export + lab önizleme hizası ✅ kısmen
```

---

## Açık borçlar (özet)

| Öncelik | Madde | Açıklama |
|---------|-------|----------|
| **Şimdi** | Supabase projesi + migration | `.env` + seed org + giriş testi |
| **Şimdi** | meshpack-lab MVP | ✅ Başladı — `meshpack-lab/` kuyruk + ZIP + mesaj |
| **Şimdi** | Uçtan uca cloud testi | Klinik gönder → lab al |
| Orta | Desktop bildirimleri | Tauri notification plugin |
| Orta | Klinik–lab pairing UI | ✅ | Lab listesi + istek/onay + kod |

---

## Açık sorular

- [x] Dental chart: FDI (11–48)
- [x] MeshPack-Lab durumu — spec önce
- [x] Gönderimde birincil kanal — Drive + e-posta özeti
- [x] Ölçü unlink — sadece yanlış eşleştirme
- [x] Aynı gün ikinci ölçü — hekime sor
