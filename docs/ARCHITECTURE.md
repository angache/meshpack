# MeshPack — Sistem Mimarisi

> **Son güncelleme:** 2026-07-20  
> **Durum:** Aktif — pilot MinIO + agent çalışıyor; klinik S3 entegrasyonu planlı  
> **İlgili dokümanlar:** [BACKEND.md](./BACKEND.md) · [CASE_PACKAGE.md](./CASE_PACKAGE.md) · [SCAN_ADAPTERS.md](./SCAN_ADAPTERS.md) · [LAB_MOBILE.md](./LAB_MOBILE.md)

---

## Ürün özü

MeshPack’in farkı: **doktor hangi işletim sistemindeyse orada çalışan masaüstü klinik uygulaması** + tarayıcıdan düşen ölçülerin güvenli bulut senkronu.

| Kavram | Anlam |
|--------|--------|
| **Ölçü** | Intraoral tarama mesh dosyası (`.ply`, `.stl`, `.obj`) |
| **Ölçü seti** | Aynı vakaya ait üst + alt + kapanış dosyaları |
| **Yerel-first** | Hasta/vaka verisi önce cihazda; bulut isteğe bağlı kanal |

---

## Bileşenler ve roller

İki farklı kullanıcı, iki farklı program — karıştırılmamalı.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         DOKTOR / KLİNİK                                   │
│  macOS · Windows · Linux                                                  │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  meshpack (Tauri) — ANA ÜRÜN                                         │ │
│  │  Giriş · import · 3D viewer · planlama · vaka · gönderim           │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│         │ manuel dosya seç          │ buluttan çek (planlı)              │
│         ▼                           ▼                                     │
│  ┌──────────────┐           ┌──────────────┐                           │
│  │ Yerel SQLite │           │ S3 / MinIO   │◄────┐                       │
│  │ + viewer     │           │ (scan store) │     │                       │
│  └──────────────┘           └──────┬───────┘     │                       │
└────────────────────────────────────┼─────────────┼───────────────────────┘
                                     │             │
┌────────────────────────────────────┼─────────────┼───────────────────────┐
│              TARAYICI PC (genelde Windows)       │                       │
│                                                  │                       │
│  ┌───────────────────────────────────────────────┴───────────────────┐ │
│  │  meshpack-agent (Tauri) — ARKA PLAN SERVİSİ                        │ │
│  │  Export klasörünü izle → stabilize → S3'e yükle → tray             │ │
│  │  Doktor bu uygulamayı görmez; kurulum/destek ekibi yönetir           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  TAMAMLAYICI İSTEMCİLER (aynı bulut verisine bağlanır)                    │
│                                                                           │
│  meshpack-lab (web/Tauri) ──► Supabase CasePackage ZIP (lab kuyruğu)     │
│  Flutter mobil (planlı)     ──► ölçü görüntüleme, bildirim, onay          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Repo / proje haritası (monorepo)

| Proje | Konum | Rol |
|-------|-------|-----|
| **meshpack** (klinik) | Repo kökü (`src/`, `src-tauri/`) | Klinik masaüstü (Mac/Win/Linux) — ana ürün |
| **meshpack-lab** | `meshpack-lab/` | Lab masaüstü + web panel |
| **meshpack-mobile** | `apps/mobile/` | Flutter E2EE vaka transferi |
| **@meshpack/crypto** | `packages/crypto/` | Paylaşılan TS kripto (E2EE v1) |
| **meshpack-agent** | Kardeş repo | Tarayıcı PC upload agent |

Detay: [MONOREPO.md](./MONOREPO.md) · E2EE: [E2EE_PROTOCOL.md](./E2EE_PROTOCOL.md)

**Neden ayrı agent?** Dropbox/OneDrive modeli: ince arka plan servisi + zengin masaüstü uygulama. Agent ROI düşük olurdu Flutter/Tauri klinik uygulamasının içine gömülse.

---

## Platform matrisi

| Platform | Uygulama | Öncelik | Not |
|----------|----------|---------|-----|
| **macOS** | meshpack (Tauri) | Yüksek | Doktor Mac senaryosu — fark burada |
| **Windows** | meshpack (Tauri) | Yüksek | Klinik + tarayıcı PC |
| **Linux** | meshpack (Tauri) | Orta | Tauri ile aynı kod tabanı |
| **Windows** | meshpack-agent | Yüksek | Scanner export izleme |
| **macOS** | meshpack-agent | Düşük | Dev/test; üretimde nadiren |
| **iOS / Android** | Flutter | Orta | Görüntüleme, bildirim — [LAB_MOBILE.md](./LAB_MOBILE.md) |
| **Web** | Flutter web / lab | Düşük | Panel, kuyruk; ağır 3D değil |

**Karar:** Masaüstü farkı **meshpack (Tauri)** ile verilir. Flutter masaüstüne tüm viewer taşınmaz (6–12 ay maliyet, gecikme).

---

## Veri kanalları (iki pipeline)

MeshPack'te iki bağımsız bulut kanalı vardır; amaçları farklıdır.

### 1. Scan sync (ham ölçü) — S3 API / MinIO

Tarayıcı export → agent → object storage.

```
export klasörü/
  upper.ply
  lower.stl
        │
        ▼  meshpack-agent (watch + dedupe SHA-256)
        │
        ▼  PutObject (ham dosya, sıkıştırma yok)
        │
  s3://meshpack-scans/{clinic}/{agent}/{yyyy}/{mm}/{uuid}.ext
```

| Özellik | Değer |
|---------|-------|
| Object key | `{clinic_id}/{agent_id}/{yyyy}/{mm}/{uuid}.ext` |
| Metadata | `sha256`, `original-name`, `clinic-id`, `agent-id` |
| İzinli uzantılar | `.ply`, `.stl`, `.obj` (texture/mtl yok) |
| Dedupe | Agent yerel `uploaded.json` (SHA-256) |
| Pilot endpoint | Hetzner MinIO (`S3 uyumlu API`) |

**İndirme:** `meshpack-agent/cli` → `npm run list` / `npm run pull` (debug). Hedef: **meshpack klinik uygulamasına** taşınacak.

### 2. CasePackage (vaka paketi) — Supabase Storage

Planlı vaka → ZIP → lab kuyruğu. Detay: [BACKEND.md](./BACKEND.md), [CASE_PACKAGE.md](./CASE_PACKAGE.md).

```
meshpack → exportCasePackageZip() → Supabase case-packages/
meshpack-lab → downloadCasePackage() → JSZip → önizleme
```

Bu kanal **manifest + dental plan + hizalı mesh seti** içerir; ham scan sync'ten ayrıdır.

---

## Doktor Mac senaryosu (hedef akış)

```
1. MeshPack'i aç (macOS .app)
2. Giriş yap (yerel veya bulut hesap — faz 2)
3. Ölçüyü getir:
   (a) Export klasöründen import sihirbazı ile seç
   (b) Buluttan / S3'ten çek (agent başka PC'den yüklemişse)
4. 3D önizle → hastaya / vakaya bağla
5. Gönder:
   - MeshPack Lab → CasePackage + Supabase
   - veya ZIP / e-posta / Drive (yerel-first)
```

Mac'te tarayıcı yoksa bile doktor **buluttaki ölçüleri görüp yönetebilir** — çapraz platform farkının özü.

---

## Sıkıştırma politikası

| Kanal | Sıkıştırma | Gerekçe |
|-------|------------|---------|
| Agent → S3 (ham mesh) | **Hayır** | Binary PLY/STL zaten yoğun; gzip ~%10–20, CPU maliyeti |
| CasePackage ZIP | **Evet** (Deflate 6) | Çoklu dosya + manifest; `compression.rs` |
| İleride (opsiyonel) | `.ply.gz` veya `Content-Encoding` | Bant genişliği sorunu çıkarsa |

---

## Dosya formatları

| Format | Upload (agent) | Import (meshpack) | Viewer |
|--------|----------------|-------------------|--------|
| PLY | ✓ | ✓ | ✓ (tercih) |
| STL | ✓ | ✓ | ✓ |
| OBJ | ✓ | ✓ | Kısıtlı |
| DCM | — | Adapter | — |

Format önceliği (meshpack): `ply > stl > obj` — bkz. `src/scanAdapters/types.js`

---

## Güvenlik ve KVKK

| Konu | Uygulama |
|------|----------|
| Object key'de hasta adı | **Yok** — UUID + clinic/agent path |
| Metadata | Minimum: hash, orijinal dosya adı, clinic/agent id |
| TR veri yerleşimi | Pilot: Hetzner FI; üretim: TR/EU S3 + DPA |
| Agent gelişmiş ayarlar | Parola kilitli UI; yalnızca destek erişir |
| Supabase | EU region, RLS — [BACKEND.md](./BACKEND.md) |

---

## meshpack-agent özeti

Kullanıcı arayüzü sade: **Aç / Kapat**, **klasör değiştir**, **son işlemler** logu.

| Katman | Teknoloji |
|--------|-----------|
| UI | Tauri 2 + Vite |
| Upload / watch | Rust (`notify`, `aws-sdk-s3`) |
| Yedek CLI | `meshpack-agent/cli` (Node) |

Komutlar (CLI):

```bash
npm run watch          # klasör izle, yükle
npm run list           # S3'teki ölçüleri listele
npm run pull           # S3'ten indir
```

---

## Yol haritası

### Faz 1 — Pilot (şimdi) ✓ kısmen

- [x] Agent: watch + MinIO upload + tray + basit UI
- [x] CLI: list / pull
- [x] Flutter: PLY/STL render POC (iOS + macOS)
- [ ] meshpack: S3'ten ölçü listele + indir + viewer'da aç

### Faz 2 — Doktor masaüstü bütünleşme

- [ ] meshpack Mac/Win release build
- [ ] Bulut ölçüler ekranı (S3)
- [ ] Ölçü seti gruplama (upper/lower/bite)
- [ ] Auth + clinic/agent yapılandırması (gelişmiş ayarlar dışı)

### Faz 3 — Mobil tamamlayıcı

- [ ] Flutter: S3 pull + viewer (meshpack_flutter_ply_test → ürün)
- [ ] Push bildirim (yeni ölçü / vaka)

### Faz 4 — Üretim altyapısı

- [ ] TR/EU S3 (portable S3 API — MinIO'dan taşınabilir)
- [ ] HTTPS, erişim politikaları
- [ ] Windows agent servis kurulumu

---

## Bilinçli olarak yapılmayanlar

| Yapılmaz | Neden |
|----------|-------|
| Tüm kod tek Flutter codebase | Viewer + adapter maliyeti; masaüstü farkı gecikir |
| Web'de export klasörü izleme | Tarayıcı FS kısıtı; agent gerekir |
| Agent'ta texture/mtl upload | Kapsam dışı; mesh yeterli |
| Ham mesh gzip (şimdilik) | Düşük kazanç, karmaşıklık |

---

## Monorepo hedefi (organizasyon)

Uzun vadede dağınık repolar tek marka altında toplanabilir:

```
meshpack/
  apps/
    clinic-desktop/     # meshpack (Tauri) — bu repo
    agent/              # meshpack-agent
    mobile/             # Flutter
    lab/                # meshpack-lab
  docs/
    ARCHITECTURE.md     # bu dosya
```

API sözleşmesi: **S3 object layout** + **CasePackage manifest** + **Supabase şeması** — diller arası ortak dil.

---

## Özet cümle

> **meshpack** = doktorun her platformdaki masaüstü uygulaması.  
> **meshpack-agent** = tarayıcı PC'deki görünmez upload servisi.  
> **Flutter** = mobil (ve hafif web) tamamlayıcı.  
> **İki bulut kanalı:** ham scan (S3) + vaka paketi (Supabase).
