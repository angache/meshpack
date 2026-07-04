# MeshPack — Ürün yol haritası

> Klinik ↔ laboratuvar dijital iş akışı. Son güncelleme: konuşma notlarından derlendi.

---

## Vizyon (tek cümle)

Tarayıcıdan düşen ölçü → hastaya bağlanır → planlanır → güvenli şekilde lab’a gider → klinik–lab WhatsApp’sız iletişir.

---

## Faz 1 — Ölçü alımı ve hasta eşleştirme `ŞİMDİ`

**Hedef:** Ölçü klasöre düşer, gruplanır, hastaya bağlanır; bağlandıktan sonra başka hastaya geçemez.

| # | Özellik | Durum | Not |
|---|---------|-------|-----|
| 1.1 | Klasör izleme (watch) | ✅ Var | |
| 1.2 | Dosya adından otomatik grup (üst/alt/kapanış seti) | ✅ Var | İsim öneki + gün |
| 1.3 | Hasta veritabanı (SQLite) | ✅ Var | Klinik hasta kaydı |
| 1.4 | Grup olarak hastaya bağlama | ✅ Var | Tek tık / yeni hasta |
| 1.5 | **Ölçü kilidi** — bağlı ölçü normalde taşınamaz | ✅ Var | Varsayılan: kilitli; casual unlink yok |
| 1.5a | **Yanlış eşleştirme: yeniden atama** | ✅ Var | “Düzelt” + gerekçe + audit log |
| 1.6 | Yeni ölçü bildirimi + gruba git | ✅ Var | İyileştirilebilir |
| 1.7 | Mevcut hastaya otomatik öneri (isim öneki eşleşmesi) | 🔲 Yapılacak | “Bu hasta olabilir mi?” |
| 1.8 | Ölçü durumu: `bekliyor` → `hastaya_bağlı` → `gönderime_hazır` | 🔲 Kısmen | `cases.status` + vaka şeridi; tam state machine sonra |
| 1.9 | **Aynı gün ikinci ölçü** — hekime sor | ✅ Var | Modal: mevcut vaka / yeni vaka |

---

## Faz 2 — Planlama sayfası ve gönderim hazırlığı `YAKINDA`

**Hedef:** Lab’a gitmeden önce iş emri netleşir. Planlama **ayrı bir sayfa**dır; lab notu, dental chart ve diğer plan alanları **vaka bazlı** (`cases` kaydı) tutulur.

### Sayfa ayrımı (onaylandı)

| Sayfa | Amaç | Odak |
|-------|------|------|
| **Ölçü / Inbox** (mevcut ana ekran) | Klasörden düşen ölçüleri grupla, hastaya bağla, önizle | Hızlı eşleştirme |
| **Planlama** (yeni tam ekran sayfa) | Seçili vaka için iş emrini hazırla | Lab notu, FDI chart, annotation, gönderim özeti |

Ana ekrandaki footer (lab notu, şablonlar, Drive yükle) **geçici**; planlama sayfası gelince vakaya taşınacak veya sadeleştirilecek.

### Planlama sayfası — vaka bağlamı

Her planlama oturumu tek bir vakaya kilitli:

- `MP-2026-0042` · hasta adı · ölçü tarihi
- Durum: `Bağlandı` → `Planlanıyor` → `Gönderime hazır` → `Gönderildi`
- Bu vakaya bağlı ölçü seti (üst / alt / kapanış) + 3B önizleme
- `cases.lab_notes` ve ileride diş planı / annotation JSON

Giriş yolları:
1. Hasta detayında geçmiş vakadan **Planla** veya vakaya tıkla
2. Yeni bağlanan set sonrası **“Planlamaya geç”** önerisi (opsiyonel banner)

| # | Özellik | Durum | Not |
|---|---------|-------|-----|
| 2.0 | **Planlama sayfası** (ayrı tam ekran route/view) | ✅ Kısmen | Lab notu + FDI chart + durum |
| 2.1 | Vaka / iş emri kavramı (ölçü seti + hasta + tarih) | ✅ Var | `cases` + `MP-YYYY-NNNN` |
| 2.2 | Serbest metin not (lab notu) | ✅ Var | `cases.lab_notes` planlama sayfasında |
| 2.3 | Şablon notlar (Zirkonyum, A1, vb.) | ✅ Var | Planlama sayfasında |
| 2.4 | **Dental chart (FDI 11–48)** | ✅ MVP | Katalog: `src/config/dentalTreatments.js` |
| 2.4a | Protez kataloğu (config) | ✅ | Ayarlar → Planlama sekmesi; `config.json`’da saklanır |
| 2.5 | Ölçü görseli üzerine işaretleme / not | ✅ MVP | Planlama 3B viewer; vakaya `annotations` JSON |
| 2.6 | Planlama tamamlanınca “Gönderime hazır” | ✅ Kısmen | Planlama sayfası butonu → `ready_to_send` |
| 2.7 | Gönderim önizleme özeti | ✅ MVP | Planlama alt bölüm; kopyala / e-posta / Drive |
| 2.8 | Eski ölçüler için vaka backfill | ✅ Var | Uygulama açılışında `case_id` boş kayıtlar |

---

## Faz 3 — Laboratuvara gönderim `YAKINDA`

**Hedef:** MeshPack-Lab varsa doğrudan; yoksa e-posta veya bulut.

| # | Özellik | Durum | Not |
|---|---------|-------|-----|
| 3.1 | Google Drive ZIP yükleme | ✅ Var | |
| 3.2 | **MeshPack-Lab** doğrudan gönderim | 🔲 `SONRA` | Henüz hayal aşaması — önce `CasePackage` formatı tasarlanacak |
| 3.3 | E-posta ile gönderim (ek + özet) | 🔲 | Lab’de MeshPack yoksa |
| 3.4 | Alternatif bulut (Dropbox, OneDrive, link kopyala) | 🔲 | |
| 3.5 | Gönderim geçmişi ve durum (gönderildi / lab aldı) | 🔲 | |
| 3.6 | Gönderim sonrası arşiv / sil / taşı | ✅ Kısmen | Ayarlarda var |

---

## Faz 4 — MeshPack-Lab ve güvenli iş akışı `SONRA`

**Hedef:** Klinik–lab arası WhatsApp yerine güvenli, izlenebilir kanal.

| # | Özellik | Not |
|---|---------|-----|
| 4.1 | Ortak vaka ID (klinik + lab aynı kaydı görür) | |
| 4.2 | Uçtan uca şifreleme / KVKK uyumu | Hasta verisi |
| 4.3 | Lab tarafında vaka kuyruğu | meshpack-lab |
| 4.4 | Durum senkronu (alındı, üretimde, kargoda, tamam) | |
| 4.5 | **Anlık mesajlaşma** (vaka bazlı chat) | WhatsApp yerine |
| 4.6 | Dosya + mesaj + plan tek vakada | |
| 4.7 | Bildirimler (yeni mesaj, yeni vaka) | |

---

## Faz 5 — İyileştirmeler ve polish `SONRA`

| # | Özellik |
|---|---------|
| 5.1 | Sidexis benzeri hasta listesi / detay UX iyileştirmeleri |
| 5.2 | Açık/koyu tema, okunabilirlik |
| 5.3 | Çoklu klinik / çoklu kullanıcı (ileride) |
| 5.4 | Yedekleme ve hasta DB export |

---

## Benim önerdiğim ekler

1. **Vaka numarası** — Her bağlanan ölçü setine okunabilir ID (`MP-2026-0042`). Lab ve chat bu ID üzerinden döner.
2. **Ölçü kilidi + denetim kaydı** — Kim, ne zaman, hangi hastaya bağladı; yeniden atama denemesi loglanır.
3. **Durum şeridi** — Her vakada görsel akış: `Bağlandı → Planlandı → Gönderildi → Lab’de`.
4. **Akıllı hasta önerisi** — Grup düşünce “%90 Ahmet Yılmaz” (dosya öneki + geçmiş bağlantılar).
5. **Offline kuyruk** — İnternet yokken gönderim sıraya alınır, gelince otomatik gider.
6. **Annotation formatı** — 3B üzerindeki işaretler JSON olarak vakaya kaydedilir; lab viewer’da aynı görünür.
7. **Dental chart veri modeli** — Önce basit (FDI diş no + işlem tipi); sonra materyal, renk, implant vb.
8. **MeshPack-Lab protokolü önce** — Chat ve gönderimden önce ortak `CasePackage` formatı (STL/PLY + plan JSON + notlar).

---

## Kararlar (onaylandı)

| Konu | Karar |
|------|--------|
| Dental chart | **FDI (11–48)** |
| MeshPack-Lab | Şu an **sadece vizyon** — önce klinik tarafı + `CasePackage` spec; lab uygulaması sonra |
| Ölçü taşıma | **Varsayılan kilitli.** Sadece **yanlış eşleştirme** için eski hastadan ayır → yeni hastaya taşı. Tehlikeli işlem → sıkı UX + audit log |
| Aynı gün ikinci ölçü | **Hekime sor:** “Mevcut vakaya ekle” mi, “Yeni vaka oluştur” mu? |
| Gönderim (lab yokken) | **Drive = dosya**, **E-posta = bildirim / iş emri özeti** (birlikte) |
| Planlama UI | **Ayrı tam ekran sayfa** — lab notu, chart, annotation **vaka bazlı**; inbox sadece eşleştirme + önizleme |

### Planlama sayfası akışı (taslak)

```
[Inbox] Hasta + vaka seçildi
        │
        ▼
[Planlama sayfası]  MP-2026-0042 · Yılmaz, Ahmet · 04.07.2026
        │
        ├─ Sol: vaka özeti + durum şeridi
        ├─ Orta: lab notu, şablonlar, FDI chart (ileride)
        ├─ Sağ: 3B önizleme + annotation (ileride)
        └─ Alt: [Gönderime hazır işaretle] → [Özet / Gönder]
```

### Yanlış eşleştirme akışı (taslak)

1. Kullanıcı “Eşleştirmeyi düzelt” der
2. Uyarı: *“Bu ölçü [Hasta A]’ya bağlı. Taşımak lab kaydını etkileyebilir.”*
3. Zorunlu **gerekçe** metni (ör. “Yanlış hasta seçildi”)
4. Hedef hasta seçimi
5. **Audit log:** kim, ne zaman, eski hasta → yeni hasta, gerekçe
6. Gönderilmiş / planlanmış vakada ekstra onay katmanı (ileride)

### Aynı gün ikinci ölçü akışı (taslak)

Hasta zaten açık vakası varken yeni grup düşerse:

```
┌─────────────────────────────────────────┐
│  Bu hasta için bugün zaten bir vaka var │
│  (MP-2026-0042 · 3/3 set)               │
│                                         │
│  [ Mevcut vakaya ekle ]  [ Yeni vaka ]  │
└─────────────────────────────────────────┘
```

---

## Önerilen sıra (güncel)

```
1. Vaka modeli + durum şeridi ✅
2. Ölçü kilidi + reassign + aynı gün sorusu ✅
3. Eski ölçü backfill (case_id boş kayıtlar) ✅
4. Planlama sayfası kabuğu (vaka bağlamı + lab notu → cases.lab_notes) ✅
5. Dental chart MVP (FDI) — planlama sayfasında ✅
6. 3B annotation ✅
7. Gönderim özeti + Drive/E-posta (vaka bazlı) ✅
8. CasePackage spec → MeshPack-Lab (vizyon)
```

---

## Açık sorular

- [x] Dental chart: FDI (11–48) — **evet**
- [x] MeshPack-Lab durumu — **henüz hayal; spec önce**
- [x] Gönderimde birincil kanal — **Lab yokken: Drive (dosya) + e-posta (özet/bildirim)**
- [x] Ölçü unlink — **sadece yanlış eşleştirme; sıkı yönetim**
- [x] Aynı gün ikinci ölçü — **hekime sor**
