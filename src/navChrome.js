import { iconHtml } from "./icons.js";

const $ = (id) => document.getElementById(id);

const HUB_BACK_BUTTON_IDS = ["btn-scans-inbox-back", "btn-messages-hub-back"];

/** Lucide createIcons gizli hub'da güvenilir değil — SVG'yi doğrudan yerleştir */
export function mountHubBackIcons() {
  const markup = iconHtml("chevron-left", {
    size: 14,
    className: "mp-icon mp-icon-sm mp-hub-back-icon",
    strokeWidth: 2.25,
  });
  if (!markup) return;

  for (const id of HUB_BACK_BUTTON_IDS) {
    const btn = $(id);
    const slot = btn?.querySelector(".mp-hub-back-icon-slot");
    if (slot) slot.innerHTML = markup;
  }
}

export function syncHeaderNavButtons() {
  const scansOpen = !$("scans-inbox-view")?.classList.contains("hidden");
  const messagesOpen = !$("messages-hub-view")?.classList.contains("hidden");
  $("btn-header-scans")?.classList.toggle("mp-header-nav-active", scansOpen);
  $("btn-header-messages")?.classList.toggle("mp-header-nav-active", messagesOpen);
}
