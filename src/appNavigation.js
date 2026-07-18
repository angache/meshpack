import { closeScansInbox, isScansInboxOpen, openScansInbox } from "./scansInboxUI.js";
import { closeMessagesHub, isMessagesHubOpen, openMessagesHub } from "./messagesHubUI.js";
import { mountHubBackIcons, syncHeaderNavButtons } from "./navChrome.js";

const $ = (id) => document.getElementById(id);

const OVERLAY_IDS = [
  "settings-modal",
  "scan-import-wizard",
  "app-tips-modal",
  "patient-edit-modal",
  "app-lock-screen",
  "preview-overlay",
  "link-scan-confirm-modal",
  "same-day-case-modal",
  "reassign-scan-modal",
];

function isBlockingOverlayOpen() {
  return OVERLAY_IDS.some((id) => {
    const el = $(id);
    return el && !el.classList.contains("hidden");
  });
}

export function goToMainScreen() {
  closeScansInbox();
  closeMessagesHub();
  syncHeaderNavButtons();
}

export function toggleScansInbox() {
  if (isScansInboxOpen()) closeScansInbox();
  else openScansInbox();
  syncHeaderNavButtons();
}

export function toggleMessagesHub() {
  if (isMessagesHubOpen()) closeMessagesHub();
  else openMessagesHub();
  syncHeaderNavButtons();
}

function onGlobalEscape(e) {
  if (e.key !== "Escape" || isBlockingOverlayOpen()) return;
  if (isScansInboxOpen()) {
    e.preventDefault();
    closeScansInbox();
    syncHeaderNavButtons();
    return;
  }
  if (isMessagesHubOpen()) {
    e.preventDefault();
    closeMessagesHub();
    syncHeaderNavButtons();
  }
}

export function initAppNavigation() {
  mountHubBackIcons();
  $("btn-go-main")?.addEventListener("click", goToMainScreen);
  $("btn-header-scans")?.addEventListener("click", toggleScansInbox);
  $("btn-header-messages")?.addEventListener("click", toggleMessagesHub);
  document.addEventListener("keydown", onGlobalEscape);
  syncHeaderNavButtons();
}
