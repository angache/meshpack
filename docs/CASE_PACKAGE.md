# CasePackage — MeshPack vaka paketi formatı (v1)

Klinikten laboratuvara giden tek ZIP paketi. MeshPack-Lab ve üçüncü taraf lab yazılımları bu formatı okuyabilir.

## Sürüm

| Alan | Değer |
|------|--------|
| `casePackageVersion` | `1` |
| Üreten uygulama | `meshpack-clinic` |
| Dosya uzantısı | `.zip` |

## ZIP içeriği (v1)

```
{vaka_no}_{hasta}.zip
├── manifest.json      # Yapılandırılmış vaka verisi (zorunlu)
├── is_emri.txt        # İnsan okunur özet (opsiyonel, önerilir)
├── alignment.json     # Çene hizası matrisleri (opsiyonel)
├── HastaUpperJawScan.ply
├── HastaLowerJawScan.ply
└── HastaBiteScan.ply
```

Tarama dosyaları ZIP kökünde; `manifest.scans[].zipEntry` dosya adıyla eşleşir.

## manifest.json

```json
{
  "casePackageVersion": 1,
  "meshpackVersion": "0.1.0",
  "exportedAt": "2026-07-05T19:30:00.000Z",
  "source": "meshpack-clinic",
  "case": {
    "id": "uuid",
    "caseNumber": "MP-2026-0042",
    "status": "ready_to_send",
    "sessionDay": "2026-07-05",
    "sentAt": null,
    "labNotes": "Zirkonyum kron 11-21",
    "toothShade": "A2",
    "dentalPlan": { "teeth": { "11": { "treatment": "crown" } } },
    "annotations": { "version": 1, "markers": [] }
  },
  "patient": {
    "id": "uuid",
    "surname": "Tiniç",
    "firstName": "Serdal",
    "displayName": "Tiniç, Serdal"
  },
  "scans": [
    {
      "type": "upper",
      "filename": "Serdal-TinicUpperJawScan.ply",
      "zipEntry": "Serdal-TinicUpperJawScan.ply",
      "sizeBytes": 1234567,
      "fileStem": "Serdal-Tinic"
    }
  ],
  "treatments": [
    { "id": "crown", "label": "Kron", "abbr": "K", "color": "blue" }
  ],
  "summaryText": "MeshPack — İş Emri Özeti\n..."
}
```

### Alan notları

- **case.dentalPlan** — FDI diş no → `{ treatment: string }` (`dentalChart.js` ile aynı)
- **case.annotations** — `annotations.js` v1; konumlar mesh yerel koordinatında
- **case.toothShade** — VITA kodu (Classical veya 3D-Master)
- **treatments** — Export anındaki protez kataloğu snapshot'ı (lab tarafı etiket çözümü için)
- **summaryText** — `is_emri.txt` ile aynı içerik (makine + insan okuma)
- Yerel dosya yolu (`file_path`) manifest'e **yazılmaz** (KVKK / gizlilik)

## Durum değerleri (`case.status`)

| Değer | Anlam |
|-------|--------|
| `linked` | Ölçü bağlandı |
| `planning` | Planlama yapılıyor |
| `ready_to_send` | Gönderime hazır |
| `sent` | Klinik gönderdi |

## MeshPack-Lab (gelecek)

1. Lab uygulaması ZIP alır → `manifest.json` doğrular
2. `caseNumber` ile vaka kuyruğuna ekler
3. Taramaları 3B viewer'da açar; `annotations` pinlerini gösterir
4. Durum güncellemeleri (`received`, `in_production`, `shipped`) API ile senkron

## Uyumluluk

- v1 paketleri geriye dönük korunur; yeni alanlar eklenebilir, mevcut alanlar silinmez
- `casePackageVersion` artışında lab tarafı migration uygular
