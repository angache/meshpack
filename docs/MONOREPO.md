# MeshPack Monorepo

> **Son güncelleme:** 2026-07-20

Tüm MeshPack istemcileri ve paylaşılan paketler tek repo altında.

## Dizin yapısı

```
meshpack/
├── src/                    Klinik UI (Vite)
├── src-tauri/              Klinik desktop (Tauri)
├── meshpack-lab/           Lab desktop + web panel (Vite + Tauri)
├── apps/
│   └── mobile/             Flutter E2EE mobil
├── packages/
│   └── crypto/             @meshpack/crypto (TS)
├── supabase/
│   └── migrations/         Cloud + E2EE SQL
└── docs/
```

## Uygulamalar

| Uygulama | Konum | Platform |
|----------|-------|----------|
| MeshPack Clinic | repo kökü | macOS, Windows, Linux |
| MeshPack Lab | `meshpack-lab/` | Desktop + web (`npm run dev`) |
| MeshPack Mobile | `apps/mobile/` | iOS, Android (Flutter) |

## Paylaşılan kod

| Paket | Konum | Tüketiciler |
|-------|-------|-------------|
| `@meshpack/crypto` | `packages/crypto/` | Klinik, lab (Tauri/TS) |
| E2EE protokol | `docs/E2EE_PROTOCOL.md` | Tüm istemciler |

## Supabase migration'ları

| Dosya | İçerik |
|-------|--------|
| `20260706100000_meshpack_cloud.sql` | Cloud vaka, mesaj, bildirim |
| `20260720100000_e2ee_schema.sql` | E2EE `user_keys`, `cases`, `encrypted-cases` bucket |

Sırayla SQL Editor'de veya Supabase CLI ile uygulayın.

## Kardeş repo

| Repo | Neden ayrı |
|------|------------|
| `meshpack-agent` | Tarayıcı PC servisi — farklı deploy hedefi |

## Ortam değişkenleri

| Uygulama | Dosya |
|----------|-------|
| Klinik / Lab | `.env` (kök veya `meshpack-lab/.env`) |
| Mobile | `apps/mobile/.env` |

`.env` dosyaları commit edilmez. Örnek: `apps/mobile/.env.example`
