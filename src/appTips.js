const PREF_KEY = "meshpack_show_startup_tips";
const STORAGE_KEY = "meshpack_dismissed_tips";

export function shouldShowStartupTips() {
  return localStorage.getItem(PREF_KEY) !== "false";
}

export function setShowStartupTipsPreference(show) {
  localStorage.setItem(PREF_KEY, show ? "true" : "false");
}

/** @typedef {{ id: string, title: string, html: string, when?: (ctx: { watchFolder?: string|null }) => boolean }} AppTip */

export function filenameNamingHintHtml() {
  return `Dosya adında <strong class="mp-text-secondary">soyad-ad arasına tire (-)</strong> koyarsanız öneri daha doğru olur. Örn: <code class="text-medical-accent">Yilmaz-Ahmet</code>UpperJawScan.ply`;
}

/** @type {AppTip[]} */
export const APP_TIPS = [
  {
    id: "file-naming",
    title: "Dosya adlandırma",
    html: filenameNamingHintHtml(),
  },
  {
    id: "scan-grouping",
    title: "Ölçü grupları",
    html: `<strong class="mp-text-secondary">Üst, alt ve kapanış</strong> dosyaları aynı isimle gelirse tek set olarak gruplanır. Üst bardaki <strong class="mp-text-secondary">Ölçüler</strong> butonundan bekleyen setleri görüp hastaya bağlayabilirsiniz.`,
  },
  {
    id: "watch-folder",
    title: "İzleme klasörü",
    when: (ctx) => !ctx.watchFolder,
    html: `Henüz izleme klasörü seçilmedi. <strong class="mp-text-secondary">Ayarlar → İzleme</strong> bölümünden tarayıcının ölçüleri kaydettiği klasörü seçin; yeni dosyalar otomatik algılanır.`,
  },
  {
    id: "planning-send",
    title: "Planlama ve gönderim",
    html: `İş emri, diş planı ve laboratuvara gönderim <strong class="mp-text-secondary">Planla</strong> sayfasındadır. Hasta detayındaki <strong class="mp-text-secondary">Planla →</strong> ile geçin.`,
  },
  {
    id: "scan-wizard",
    title: "Ölçü sihirbazı",
    html: `Üst bardaki <strong class="mp-text-secondary">+ Ölçü</strong> ile sihirbazı açabilir; dosyaları kontrol edip uyarıları görerek hastaya bağlayabilirsiniz.`,
  },
];

function readDismissed() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function listAvailableTips(ctx = {}) {
  const dismissed = new Set(readDismissed());
  return APP_TIPS.filter((tip) => !dismissed.has(tip.id) && (!tip.when || tip.when(ctx)));
}

export function resetDismissedTips() {
  localStorage.removeItem(STORAGE_KEY);
}
