import {
  listAvailableTips,
  setShowStartupTipsPreference,
  shouldShowStartupTips,
} from "./appTips.js";
import { closeSettingsModal } from "./settingsUI.js";

const $ = (id) => document.getElementById(id);

let context = {};
let tips = [];
let currentIndex = 0;
let startupShown = false;

function isOpen() {
  return !$("app-tips-modal")?.classList.contains("hidden");
}

function hideModal() {
  $("app-tips-modal")?.classList.add("hidden");
  const checkbox = $("app-tips-dont-show");
  if (checkbox) checkbox.checked = false;
}

function closeModal() {
  if ($("app-tips-dont-show")?.checked) {
    setShowStartupTipsPreference(false);
  }
  hideModal();
}

function renderProgress() {
  const fill = $("app-tips-progress-fill");
  const counter = $("app-tips-counter");
  const total = tips.length;
  const step = currentIndex + 1;
  const pct = total > 0 ? (step / total) * 100 : 0;

  if (fill) fill.style.width = `${pct}%`;
  if (counter) counter.textContent = total > 1 ? `${step} / ${total}` : "";
}

function renderTip() {
  const body = $("app-tips-body");
  const titleEl = $("app-tips-step-title");
  const prevBtn = $("btn-app-tips-prev");
  const nextBtn = $("btn-app-tips-next");
  const tip = tips[currentIndex];
  if (!body || !tip) return;

  if (titleEl) titleEl.textContent = tip.title || "";
  body.innerHTML = tip.html;
  renderProgress();

  prevBtn?.toggleAttribute("disabled", currentIndex <= 0);
  if (nextBtn) {
    const isLast = currentIndex >= tips.length - 1;
    nextBtn.textContent = isLast ? "Başla" : "Sonraki →";
  }
}

export function setAppTipsContext(partial) {
  context = { ...context, ...partial };
}

export function openAppTipsModal({ startIndex = 0 } = {}) {
  tips = listAvailableTips(context);
  if (!tips.length) return;

  currentIndex = Math.min(Math.max(0, startIndex), tips.length - 1);
  renderTip();
  $("app-tips-modal")?.classList.remove("hidden");
  $("btn-app-tips-next")?.focus();
}

export function maybeShowStartupTipsModal() {
  if (startupShown || !shouldShowStartupTips()) return;
  tips = listAvailableTips(context);
  if (!tips.length) return;
  startupShown = true;
  // Kısa gecikme: ana arayüz yüklendikten sonra göster (ani popup hissi azalır)
  window.setTimeout(() => openAppTipsModal({ startIndex: 0 }), 450);
}

export function initAppTipsUI() {
  $("btn-app-tips-prev")?.addEventListener("click", () => {
    if (currentIndex > 0) {
      currentIndex -= 1;
      renderTip();
    }
  });

  $("btn-app-tips-next")?.addEventListener("click", () => {
    if (currentIndex < tips.length - 1) {
      currentIndex += 1;
      renderTip();
      return;
    }
    closeModal();
  });

  $("btn-app-tips-close")?.addEventListener("click", closeModal);

  $("app-tips-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "app-tips-modal") closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isOpen()) return;
    e.preventDefault();
    closeModal();
  });

  $("btn-settings-show-tips")?.addEventListener("click", () => {
    closeSettingsModal();
    startupShown = true;
    openAppTipsModal({ startIndex: 0 });
  });
}
