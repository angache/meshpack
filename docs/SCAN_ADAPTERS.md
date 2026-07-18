# Ölçü tarayıcı adapter'ları

Platform-agnostik ölçü alımı için adapter katmanı. Her tarayıcı/export tipi
`ScanPackage` kanonik modeline dönüştürülür; UI ve vaka mantığı yalnızca bu
modeli kullanır.

## Kanonik model

```ts
ScanPackage {
  id: string
  source: { adapterId, vendor, confidence }
  patient: { displayName, stem, externalIds? }
  caseRef: string          // sipariş no veya gruplama anahtarı
  assets: [{
    path, filename,
    role: upper | lower | bite | bite2 | abutment | pretreatment | ...
    preferred: boolean
  }]
  warnings: string[]
}
```

## Adapter listesi (taslak)

| ID | Marka | Algılama imzası | Hasta kaynağı |
|----|--------|-----------------|---------------|
| `itero-export-xml` | iTero | `itero_export_#*.xml` | XML `<Patient>`, `<OrderID>` |
| `teeth-detail-json` | Lab CAD | `teeth_detail.json` | PDF ordersheet veya klasör adı |
| `3shape-trios` | 3Shape | `*JawScan*`, `BiteScan*` | Dosya adı stem |
| `medit-export` | Medit | `Maxilla_Base`, `Mandible_Base` | Klasör adı (geçici) |
| `benq-scanner` | Benq | `.hasscan`, `TotalJaw*`, `UpperJaw.*` | Tarihli uzun dosya adı |
| `generic-filename` | — | Fallback | `scanFilename.js` kuralları |

## Pipeline

```
list_folder_scans
    → ingestScanFiles (klasör kümeleri)
    → detectScanAdapter (imza skoru)
    → adapter.parse → ScanPackage[]
    → packagesToFileOverrides → fileBrowser alanları
```

## Dosya yapısı

```
src/scanAdapters/
  types.js           — kanonik tipler
  shared.js          — mesh filtre, XML yardımcıları
  registry.js        — adapter listesi + dedeksiyon
  ingest.js          — ana giriş noktası
  iteroXml.js
  shapeTrios.js
  medit.js
  benq.js
  teethDetailJson.js
  genericFilename.js
  index.js
```

## Örnek klasör testi

```bash
node scripts/test-scan-adapters.mjs
```

`farklı marka taramalar/` altındaki örnekler üzerinde adapter çıktısını yazdırır.

## Bilinen sınırlar (taslak)

- **iTero**: Kapanış mesh'i XML'de yok — yalnızca üst/alt `ExportedObjects`
- **Benq**: `TotalJaw0/1` → `bite` / `bite2` varsayımı; doğrulanmalı
- **3Shape**: `UpperAbutmentScan` → `abutment` (üst çene değil)
- **Medit**: Hasta adı dosyada yok; klinikten veya manifestten gelmeli
- **Lab CAD**: `teeth_detail.json` yazılımı kesinleştirilmeli

## Sonraki adımlar

1. `fileBrowser._loadFolderFiles` içinde `packagesToFileOverrides` entegrasyonu
2. Düşük confidence → ölçü sihirbazında adapter uyarısı
3. Yeni marka = yeni adapter dosyası + `SCAN_ADAPTERS` kaydı (ML gerekmez)
