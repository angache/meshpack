# MeshPack UI v2 — Sadeleştirilmiş klinik arayüzü

> Branch: `feature/ui-simplify`  
> Hedef kullanıcı: bilgisayardan az anlayan asistan / hekim

## Prensipler

1. **Tek soru, tek ekran** — Ana ekranda aynı anda en fazla bir karar
2. **Katmanlı bilgi** — Sık kullanılan üstte; form, dosya listesi, silme işlemleri katlanır
3. **Sade dil** — «Lab'a gitti», «Plan bekliyor» (teknik vaka/grup terimleri gizli)

## Layout

| Önce (3 sütun) | Sonra (2 sütun) |
|----------------|-----------------|
| Ölçü grupları + hastalar | **Sol:** Yeni ölçüler + hastalar |
| Hasta detayı | **Sağ:** Hasta özeti + 3B önizleme |
| Vaka önizlemesi | |

## Sol panel — Gelen kutusu

- İlk bekleyen ölçü **büyük kart** (hero): hasta önerisi + «Bu hasta» / «Yeni hasta»
- Diğerleri «Diğer bekleyenler» altında
- Üst barda `N yeni` rozeti

## Sağ panel — Hasta

- İsim + durum cümlesi + **tek büyük CTA** (Planlamaya git)
- Geçmiş / hasta bilgileri / gelişmiş → `<details>` ile katlanır
- «Bu işi sil» yalnızca Gelişmiş altında

## Gizlenen (uzman katmanı)

- Vaka dosya listesi ve kaldır butonları (önizleme panelinde)
- Cloud / tarayıcı durumu (sorun yoksa üst bardan)
- Footer «Planla sayfasına geçin» metni
- Hasta tablosu VAKA sütunu

## Dosyalar

- `index.html` — layout, `ui-v2` body class
- `src/ui-v2.css` — v2 stilleri
- `src/fileBrowser.js` — inbox hero, hasta kartları, sade detay
- `src/cases.js` — kullanıcı dostu durum etiketleri

## Sonraki adımlar (U4–U6)

- [ ] Planlama sayfası üst şeridi sadeleştir
- [ ] İlk açılış «yapılacaklar» özeti
- [ ] Asistan modu: sadece gelen kutusu + büyük butonlar (ayar)
