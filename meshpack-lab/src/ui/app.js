import { invoke, isTauri as checkTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  ensureOrganizationFromMetadata,
  getActiveOrganization,
  getSession,
  onAuthStateChange,
  registerOrganization,
  signIn,
  signOut,
  signUpWithOrganization,
} from "../cloud/auth.js";
import {
  downloadCasePackage,
  getClinicName,
  getLabCase,
  listLabCases,
  subscribeLabQueue,
  updateCaseStatus,
} from "../cloud/cases.js";
import { listCaseMessages, sendCaseMessage, subscribeCaseMessages } from "../cloud/messages.js";
import { markNotificationsReadForCase } from "../cloud/notifications.js";
import { isCloudConfigured } from "../cloud/supabaseClient.js";
import { MeshPreview } from "./meshPreview.js";
import { initMessagesHub, refreshMessagesHubChrome, showMessagesTab } from "./messagesHubUI.js";
import { parseAnnotations } from "../lib/annotations.js";
import { scanTypeLabel } from "./previewAnnotations.js";
import JSZip from "jszip";
import {
  STATUS_ORDER,
  formatBytes,
  formatDate,
  statusBadgeClass,
  statusLabel,
  summarizeDentalPlan,
} from "../statusLabels.js";

import { initLinksUI, refreshLinksUI } from "./linksUI.js";
import { clearNotice, formatAuthError, showNotice } from "./notify.js";
import { classifyScanType } from "../../../src/utils.js";

const $ = (id) => document.getElementById(id);

let state = {
  org: null,
  cases: [],
  selectedId: null,
  selectedCase: null,
  clinicNames: {},
  unsubscribeQueue: null,
  unsubscribeMessages: null,
  linksPollTimer: null,
  unreadCaseIds: new Set(),
  unreadMessagesByCase: new Map(),
  realtimeBannerTimer: null,
  previewViewer: null,
  previewUrls: [],
  previewKey: null,
  previewReqId: 0,
  previewLoadingKey: null,
  previewLoadedForCaseId: null,
  queueRefreshTimer: null,
  queueRefreshInFlight: false,
};

function isTauri() {
  return checkTauri();
}

function showScreen(name) {
  $("auth-screen")?.classList.toggle("hidden", name !== "auth");
  $("main-screen")?.classList.toggle("hidden", name !== "main");
}

function initPreviewViewer() {
  if (state.previewViewer) return;
  const canvas = $("detail-preview-canvas");
  if (!canvas) return;
  state.previewViewer = new MeshPreview(canvas);
  state.previewViewer.annotations.onMarkerFocus = (marker) => {
    if (marker?.id) highlightAnnotationRow(marker.id);
  };

  $("detail-preview-toggles")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preview-toggle]");
    if (!btn || !state.previewViewer) return;
    const type = btn.dataset.previewToggle;
    if (!type) return;
    const next = !state.previewViewer.visibility[type];
    state.previewViewer.setVisible(type, next);
    updatePreviewToggles();
  });

  $("detail-annotations")?.addEventListener("click", (e) => {
    const row = e.target.closest("[data-marker-id]");
    if (!row || !state.previewViewer?.annotations) return;
    state.previewViewer.annotations.focusMarker(row.dataset.markerId);
    highlightAnnotationRow(row.dataset.markerId);
  });
}

function resolveCaseAnnotations(row) {
  const direct = row?.annotations;
  if (direct) {
    if (typeof direct === "string") return parseAnnotations(direct);
    if (Array.isArray(direct.markers) || direct.markers) return parseAnnotations(direct);
  }
  const fromManifest = row?.manifest?.case?.annotations;
  if (fromManifest) return parseAnnotations(fromManifest);
  return parseAnnotations("{}");
}

function highlightAnnotationRow(markerId) {
  $("detail-annotations")?.querySelectorAll("[data-marker-id]").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.markerId === markerId);
  });
}

function updatePreviewToggles() {
  const host = $("detail-preview-toggles");
  const viewer = state.previewViewer;
  if (!host) return;
  const hasAny = viewer && ["upper", "lower", "bite"].some((t) => viewer.meshes[t]);
  host.classList.toggle("hidden", !hasAny);
  for (const type of ["upper", "lower", "bite"]) {
    const btn = host.querySelector(`[data-preview-toggle="${type}"]`);
    if (!btn) continue;
    const has = !!viewer?.meshes[type];
    const on = viewer?.visibility[type] !== false;
    btn.disabled = !has;
    btn.classList.toggle("is-on", has && on);
    btn.classList.toggle("is-off", has && !on);
  }
}

async function parseAlignmentFromZip(zip) {
  const entry = zip.files["alignment.json"];
  if (!entry) return null;
  try {
    const raw = await entry.async("string");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function revokePreviewUrls() {
  for (const url of state.previewUrls) URL.revokeObjectURL(url);
  state.previewUrls = [];
}

function pickScanFilesFromZip(zip, manifestScans = []) {
  const picks = { upper: null, lower: null, bite: null };

  for (const scan of manifestScans) {
    const path = scan?.zipEntry || scan?.filename;
    if (!path || !scan?.type || !zip.files[path]) continue;
    picks[scan.type] = path;
  }

  for (const key of Object.keys(zip.files)) {
    if (!/\.(stl|ply)$/i.test(key) || zip.files[key].dir) continue;
    const filename = key.split("/").pop() || key;
    const type = classifyScanType(filename);
    if (type === "unknown" || picks[type]) continue;
    picks[type] = key;
  }

  return picks;
}

function buildPreviewPathFallbacks(row) {
  const out = [];
  const push = (p) => {
    if (!p) return;
    let normalized = String(p).trim();
    if (/^https?:\/\//i.test(normalized)) {
      try {
        normalized = new URL(normalized).pathname || normalized;
      } catch {
        /* ignore */
      }
    }
    normalized = normalized
      .replace(/^\/+/, "")
      .replace(/^storage\/v1\/object\/(?:(?:public|sign|authenticated)\/)?[^/]+\//, "");
    normalized = normalized.replace(/^case-packages\//, "");
    if (!normalized) return;
    if (!out.includes(normalized)) out.push(normalized);
  };

  const raw = String(row?.package_storage_path || "").trim();
  const hasFolder = raw.includes("/");
  const fileName = raw.split("/").pop();

  // Storage path zaten tam ise önce onu dene.
  if (hasFolder) push(raw);

  // Klinik upload standardı: <clinic_org_id>/<case_id>/<safe_case_number>.zip
  if (row?.clinic_org_id && row?.id && row?.case_number) {
    const safe = String(row.case_number).replace(/[^a-zA-Z0-9_-]/g, "_");
    push(`${row.clinic_org_id}/${row.id}/${safe}.zip`);
  }

  // Eğer DB'de sadece dosya adı kaldıysa olası prefix varyantlarını dene.
  if (!hasFolder && fileName && row?.clinic_org_id && row?.id) {
    push(`${row.clinic_org_id}/${row.id}/${fileName}`);
  }

  return out;
}

function showRealtimeBanner(message) {
  const el = $("realtime-banner");
  if (!el) return;
  if (state.realtimeBannerTimer) clearTimeout(state.realtimeBannerTimer);
  el.textContent = message;
  el.classList.remove("hidden");
  state.realtimeBannerTimer = setTimeout(() => {
    el.classList.add("hidden");
  }, 4500);
}

function updateUnreadBadges() {
  const queueUnread = state.unreadCaseIds.size;
  const queueBadge = $("queue-unread-badge");
  if (queueBadge) {
    queueBadge.textContent = `${queueUnread} yeni`;
    queueBadge.classList.toggle("hidden", queueUnread === 0);
  }

  const selectedUnread = state.selectedId ? Number(state.unreadMessagesByCase.get(state.selectedId) || 0) : 0;
  const msgBadge = $("messages-unread-badge");
  if (msgBadge) {
    msgBadge.textContent = `${selectedUnread} okunmadı`;
    msgBadge.classList.toggle("hidden", selectedUnread === 0);
  }
}

function clearCaseUnread(caseId) {
  if (!caseId) return;
  state.unreadCaseIds.delete(caseId);
  state.unreadMessagesByCase.delete(caseId);
  updateUnreadBadges();
}

async function markCaseNotificationsRead(caseId) {
  if (!caseId) return;
  try {
    await markNotificationsReadForCase(caseId);
    await refreshMessagesHubChrome();
  } catch (err) {
    console.warn("[lab] notifications read:", err);
  }
}

function showAuthTab(tab) {
  $("auth-login")?.classList.toggle("hidden", tab !== "login");
  $("auth-signup")?.classList.toggle("hidden", tab !== "signup");
  document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.authTab === tab);
  });
}

async function refreshAuthUI() {
  if (!isCloudConfigured()) {
    showScreen("auth");
    $("auth-not-configured")?.classList.remove("hidden");
    return;
  }
  $("auth-not-configured")?.classList.add("hidden");

  const session = await getSession();
  if (!session) {
    showScreen("auth");
    return;
  }

  await ensureOrganizationFromMetadata();
  const org = await getActiveOrganization();

  if (!org) {
    showScreen("auth");
    $("auth-org-setup")?.classList.remove("hidden");
    return;
  }

  if (org.org_type !== "lab") {
    showNotice("Bu uygulama yalnızca laboratuvar hesapları içindir. Klinik için MeshPack kullanın.");
    await signOut();
    showScreen("auth");
    return;
  }

  $("auth-org-setup")?.classList.add("hidden");
  state.org = org;
  showScreen("main");

  $("header-org").textContent = org.name;
  $("header-email").textContent = session.user.email;

  const codeBox = $("pairing-code-box");
  if (org.pairing_code) {
    codeBox?.classList.remove("hidden");
    codeBox?.classList.add("flex");
    $("pairing-code").textContent = org.pairing_code;
  }

  await loadQueue();
  setupRealtime(org.id);
  refreshLinksUI();
  await refreshMessagesHubChrome();
  if (!state.linksPollTimer) {
    state.linksPollTimer = setInterval(() => refreshLinksUI(), 20000);
  }
}

async function loadQueue() {
  if (state.queueRefreshInFlight) return;
  state.queueRefreshInFlight = true;
  const filter = $("status-filter")?.value || "all";
  const sortBy = $("queue-sort")?.value || "sent_desc";
  try {
    const rows = await listLabCases({ statusFilter: filter });
    state.cases = sortQueueRows(rows, sortBy);
    renderQueue();

    if (state.selectedId) {
      const still = state.cases.find((c) => c.id === state.selectedId);
      if (still) {
        if (state.selectedCase?.id === still.id) {
          state.selectedCase = { ...state.selectedCase, ...still };
          renderDetailStatus(state.selectedCase);
        } else {
          await selectCase(state.selectedId, false);
        }
      } else {
        state.selectedId = null;
        showDetailEmpty();
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    state.queueRefreshInFlight = false;
  }
}

function scheduleQueueRefresh(delay = 120) {
  if (state.queueRefreshTimer) clearTimeout(state.queueRefreshTimer);
  state.queueRefreshTimer = setTimeout(() => {
    state.queueRefreshTimer = null;
    loadQueue();
  }, delay);
}

function sortQueueRows(rows, sortBy) {
  const items = [...(rows || [])];
  if (sortBy === "sent_asc") {
    return items.sort((a, b) => new Date(a.sent_at || 0).getTime() - new Date(b.sent_at || 0).getTime());
  }
  if (sortBy === "status") {
    const idx = (s) => Math.max(0, STATUS_ORDER.indexOf(s));
    return items.sort((a, b) => {
      const d = idx(a.status) - idx(b.status);
      if (d !== 0) return d;
      return new Date(b.sent_at || 0).getTime() - new Date(a.sent_at || 0).getTime();
    });
  }
  return items.sort((a, b) => new Date(b.sent_at || 0).getTime() - new Date(a.sent_at || 0).getTime());
}

async function setCaseStatusQuick(status, fallbackEl = null) {
  if (!state.selectedId) return;
  try {
    await updateCaseStatus(state.selectedId, status);
    if (state.selectedCase) {
      state.selectedCase.status = status;
      state.selectedCase.updated_at = new Date().toISOString();
    }
    const idx = state.cases.findIndex((c) => c.id === state.selectedId);
    if (idx >= 0) {
      state.cases[idx].status = status;
      state.cases[idx].updated_at = state.selectedCase?.updated_at;
    }
    renderQueue();
    renderDetailStatus(state.selectedCase);
    renderTimeline(state.selectedCase);
  } catch (err) {
    alert(`Durum güncellenemedi: ${err.message}`);
    if (fallbackEl) fallbackEl.value = state.selectedCase?.status || "sent";
  }
}

function renderQueue() {
  const list = $("queue-list");
  const empty = $("queue-empty");
  if (!list) return;

  list.innerHTML = "";

  if (!state.cases.length) {
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");

  for (const c of state.cases) {
    const btn = document.createElement("button");
    const hasUnread = state.unreadCaseIds.has(c.id);
    btn.type = "button";
    btn.className = `queue-item${c.id === state.selectedId ? " is-selected" : ""}${hasUnread ? " has-unread" : ""}`;
    btn.dataset.caseId = c.id;

    const clinicName = state.clinicNames[c.clinic_org_id] || "";
    btn.innerHTML = `
      <div class="flex items-center justify-between gap-2 mb-1">
        <span class="text-xs font-medium text-lab-text truncate">${escapeHtml(c.case_number)}</span>
        <div class="shrink-0 flex items-center gap-1.5">
          ${hasUnread ? `<span class="queue-unread-dot" title="Okunmadı"></span>` : ""}
          <span class="status-badge ${statusBadgeClass(c.status)}">${statusLabel(c.status)}</span>
        </div>
      </div>
      <div class="text-[11px] text-lab-text truncate">${escapeHtml(c.patient_display_name || "—")}</div>
      <div class="text-[10px] text-lab-muted mt-0.5">${escapeHtml(clinicName)} · ${formatDate(c.sent_at)}</div>
    `;
    btn.addEventListener("click", () => selectCase(c.id));
    list.appendChild(btn);
  }

  updateUnreadBadges();
}

function showDetailEmpty() {
  $("detail-empty")?.classList.remove("hidden");
  $("detail-content")?.classList.add("hidden");
  $("detail-summary").textContent = "—";
  $("detail-annotations").innerHTML = "";
  $("detail-preview-empty").textContent = "Vaka seçildiğinde önizleme gösterilir.";
  $("detail-preview-debug")?.classList.add("hidden");
  if ($("detail-preview-debug")) $("detail-preview-debug").textContent = "";
  state.previewLoadedForCaseId = null;
  state.previewKey = null;
  state.previewLoadingKey = null;
  state.previewViewer?.clear();
  revokePreviewUrls();
  updatePreviewToggles();
}

async function selectCase(caseId, markReceived = true) {
  if (state.selectedId !== caseId) {
    state.previewLoadedForCaseId = null;
    state.previewKey = null;
    state.previewLoadingKey = null;
  }
  state.selectedId = caseId;
  clearCaseUnread(caseId);
  renderQueue();

  try {
    const row = await getLabCase(caseId);
    if (!row) {
      showDetailEmpty();
      return;
    }

    state.selectedCase = row;

    if (!state.clinicNames[row.clinic_org_id]) {
      state.clinicNames[row.clinic_org_id] = (await getClinicName(row.clinic_org_id)) || "Klinik";
    }

    if (markReceived && row.status === "sent") {
      await updateCaseStatus(caseId, "received");
      row.status = "received";
      row.received_at = new Date().toISOString();
      const idx = state.cases.findIndex((c) => c.id === caseId);
      if (idx >= 0) state.cases[idx] = { ...state.cases[idx], ...row };
      renderQueue();
    }

    renderDetail(row);
    if (state.previewLoadedForCaseId !== row.id) {
      renderPackagePreview(row).catch((err) => {
        $("detail-preview-empty").textContent = `Önizleme yüklenemedi: ${err.message}`;
      });
    }
    await loadMessages(caseId);
    await markCaseNotificationsRead(caseId);
    setupMessageRealtime(caseId);
  } catch (err) {
    alert(`Vaka yüklenemedi: ${err.message}`);
  }
}

function ensureStatusSelectOptions() {
  const select = $("detail-status-select");
  if (!select || select.options.length) return;
  select.innerHTML = STATUS_ORDER.map(
    (s) => `<option value="${s}">${statusLabel(s)}</option>`
  ).join("");
}

function renderDetailStatus(row) {
  if (!row) return;
  const badge = $("detail-status-badge");
  badge.textContent = statusLabel(row.status);
  badge.className = `status-badge ${statusBadgeClass(row.status)}`;

  const select = $("detail-status-select");
  if (select && select.value !== row.status) {
    select.value = row.status;
  }
}

function renderDetail(row) {
  ensureStatusSelectOptions();
  $("detail-empty")?.classList.add("hidden");
  $("detail-content")?.classList.remove("hidden");

  $("detail-case-number").textContent = row.case_number;
  $("detail-patient").textContent = row.patient_display_name || `${row.patient_surname}, ${row.patient_first_name}`;

  const clinicName = state.clinicNames[row.clinic_org_id] || "";
  $("detail-meta").textContent = `${clinicName} · Oturum: ${row.session_day || "—"} · Gönderim: ${formatDate(row.sent_at)}`;

  renderDetailStatus(row);

  $("detail-lab-notes").textContent = row.lab_notes?.trim() || "—";
  $("detail-shade").textContent = row.tooth_shade?.trim() || "—";
  $("detail-package").textContent = row.package_storage_path
    ? `${formatBytes(row.package_size_bytes)} · CasePackage`
    : "Paket yok";
  $("detail-plan").textContent = summarizeDentalPlan(row.dental_plan);
  $("detail-summary").textContent = row.manifest?.summaryText || "Özet bulunamadı";
  renderAnnotations(row);
  renderTimeline(row);
}

function renderAnnotations(row) {
  const host = $("detail-annotations");
  if (!host) return;
  const { markers } = resolveCaseAnnotations(row);
  if (!markers.length) {
    host.innerHTML = `<p class="text-xs text-lab-muted">Bu vakada ölçü notu yok.</p>`;
    return;
  }
  host.innerHTML = markers
    .map((m, i) => {
      const scan = scanTypeLabel(m.scanType);
      return `<button type="button" class="annotation-row annotation-row-btn w-full text-left" data-marker-id="${escapeHtml(m.id)}">
        <div class="t">#${i + 1} · ${escapeHtml(scan)}</div>
        <div class="b">${escapeHtml(m.text || "—")}</div>
      </button>`;
    })
    .join("");
}

async function renderPackagePreview(row) {
  const previewKey = `${row?.id || ""}:${row?.package_storage_path || ""}`;
  if (state.previewKey === previewKey && state.previewLoadedForCaseId === row?.id) return;
  if (state.previewLoadingKey === previewKey) return;
  state.previewLoadingKey = previewKey;
  const reqId = ++state.previewReqId;

  initPreviewViewer();
  const viewer = state.previewViewer;
  const infoEl = $("detail-preview-empty");
  const debugEl = $("detail-preview-debug");
  if (!viewer || !infoEl) return;

  viewer.clear();
  revokePreviewUrls();

  if (!row?.package_storage_path) {
    infoEl.textContent = "Paket bulunamadı.";
    debugEl?.classList.add("hidden");
    state.previewLoadingKey = null;
    return;
  }

  infoEl.textContent = "ZIP indiriliyor…";
  if (debugEl) {
    debugEl.classList.add("hidden");
    debugEl.textContent = "";
  }
  const candidates = buildPreviewPathFallbacks(row);
  let blob;
  try {
    blob = await downloadCasePackage(candidates[0], candidates.slice(1));
  } catch (err) {
    state.previewLoadingKey = null;
    if (debugEl && import.meta.env.DEV) {
      debugEl.textContent = `storage_path: ${row.package_storage_path || "—"}\ncandidates:\n- ${candidates.join("\n- ")}\n\n${err.message || err}`;
      debugEl.classList.remove("hidden");
    }
    throw err;
  }
  if (reqId !== state.previewReqId) return;
  const zip = await JSZip.loadAsync(blob);
  const picks = pickScanFilesFromZip(zip, row?.manifest?.scans || []);

  const scanEntries = [];
  for (const type of ["upper", "lower", "bite"]) {
    const key = picks[type];
    if (!key || !zip.files[key]) continue;
    const entryBlob = await zip.files[key].async("blob");
    if (reqId !== state.previewReqId) return;
    const ext = key.toLowerCase().endsWith(".ply") ? "ply" : "stl";
    scanEntries.push({ type, blob: entryBlob, ext });
  }

  const loaded = await viewer.loadScans(scanEntries);
  if (reqId !== state.previewReqId) return;

  if (!loaded) {
    infoEl.textContent = "Önizleme için STL/PLY dosyası bulunamadı.";
    state.previewLoadingKey = null;
    updatePreviewToggles();
    return;
  }

  const alignment = await parseAlignmentFromZip(zip);
  if (alignment && alignment.mode !== "scanner") {
    viewer.applyAlignmentFromPackage(alignment);
  } else {
    viewer.acceptScannerAlignment();
  }

  viewer.setAnnotations(resolveCaseAnnotations(row));
  viewer.fitCamera();
  updatePreviewToggles();

  const markerCount = resolveCaseAnnotations(row).markers.length;
  const alignNote = viewer.alignmentMode === "package" ? "paket hizası" : "tarayıcı hizası";
  const markerNote = markerCount ? ` · ${markerCount} not` : "";
  infoEl.textContent = `${loaded} ölçü önizleniyor (${alignNote}${markerNote}).`;
  state.previewKey = previewKey;
  state.previewLoadedForCaseId = row.id;
  state.previewLoadingKey = null;
  debugEl?.classList.add("hidden");
}

function renderTimeline(row) {
  const el = $("detail-timeline");
  if (!el) return;
  const items = [
    ["Gönderildi", row.sent_at],
    ["Alındı", row.received_at],
    ["Tamamlandı", row.completed_at],
    ["Son güncelleme", row.updated_at],
  ];

  const lines = items.map(([label, value]) => {
    const v = value ? formatDate(value) : "—";
    return `<div class="timeline-row"><div class="k">${label}</div><div class="v">${v}</div></div>`;
  });

  const markerCount = resolveCaseAnnotations(row).markers.length;
  if (markerCount) {
    lines.push(
      `<div class="timeline-row"><div class="k">İşaret / Not</div><div class="v">${markerCount} adet not</div></div>`
    );
  }

  el.innerHTML = lines.join("");
}

async function loadMessages(caseId) {
  const list = $("messages-list");
  if (!list) return;
  list.innerHTML = `<p class="text-xs text-lab-muted">Mesajlar yükleniyor…</p>`;

  try {
    const { messages } = await listCaseMessages(caseId);
    list.innerHTML = "";
    if (!messages.length) {
      list.innerHTML = `<p class="text-xs text-lab-muted">Henüz mesaj yok. Kliniğe ilk mesajı yazın.</p>`;
      return;
    }
    for (const m of messages) {
      appendMessageBubble(m);
    }
    list.scrollTop = list.scrollHeight;
  } catch (err) {
    list.innerHTML = `<p class="text-xs text-lab-muted">Mesajlar yüklenemedi</p>`;
  }
}

function appendMessageBubble(msg) {
  const list = $("messages-list");
  if (!list || !msg?.id) return;
  if (list.querySelector(`[data-message-id="${msg.id}"]`)) return;

  const mine = msg.author_org_id === state.org?.id;
  const div = document.createElement("div");
  div.className = `message-bubble ${mine ? "mine" : "theirs"}`;
  div.dataset.messageId = msg.id;
  div.innerHTML = `
    <div class="text-[9px] uppercase tracking-wide text-lab-muted mb-0.5">${mine ? "Siz" : "Klinik"}</div>
    <div>${escapeHtml(msg.body)}</div>
    <div class="text-[9px] text-lab-muted mt-1">${formatDate(msg.created_at)}</div>
  `;
  list.appendChild(div);
}

function setupRealtime(labOrgId) {
  state.unsubscribeQueue?.();
  state.unsubscribeQueue = subscribeLabQueue(labOrgId, async (payload) => {
    const changed = payload?.new || payload?.old;
    const changedCaseId = changed?.id;
    const isSelected = changedCaseId && changedCaseId === state.selectedId;
    const isNewCase = payload?.eventType === "INSERT";
    if (changedCaseId && !isSelected && isNewCase) {
      state.unreadCaseIds.add(changedCaseId);
      showRealtimeBanner(`Yeni vaka geldi: ${changed.case_number || "Vaka"}`);
    } else if (changedCaseId && !isSelected && payload?.eventType === "UPDATE" && changed?.status !== payload?.old?.status) {
      state.unreadCaseIds.add(changedCaseId);
      showRealtimeBanner(`${changed.case_number || "Vaka"} durumu güncellendi: ${statusLabel(changed.status)}`);
    }
    scheduleQueueRefresh(100);
    updateUnreadBadges();
  });
}

function setupMessageRealtime(caseId) {
  state.unsubscribeMessages?.();
  state.unsubscribeMessages = subscribeCaseMessages(caseId, (msg) => {
    appendMessageBubble(msg);
    $("messages-list").scrollTop = $("messages-list")?.scrollHeight || 0;
    const mine = msg.author_org_id === state.org?.id;
    const viewingThisCase = caseId === state.selectedId;
    if (!mine && viewingThisCase) {
      markCaseNotificationsRead(caseId);
    } else if (!mine) {
      const current = Number(state.unreadMessagesByCase.get(caseId) || 0);
      state.unreadMessagesByCase.set(caseId, current + 1);
      state.unreadCaseIds.add(caseId);
      updateUnreadBadges();
      refreshMessagesHubChrome().catch(() => {});
      showRealtimeBanner(`Yeni mesaj: ${state.selectedCase?.case_number || "vaka"}`);
    }
  });
}

async function downloadZip() {
  const row = state.selectedCase;
  if (!row?.package_storage_path) {
    alert("İndirilecek paket yok");
    return;
  }

  const btn = $("btn-download");
  btn.disabled = true;
  btn.textContent = "İndiriliyor…";

  try {
    const candidates = buildPreviewPathFallbacks(row);
    if (!candidates.length) {
      throw new Error("Paket yolu çözülemedi");
    }
    const blob = await downloadCasePackage(candidates[0], candidates.slice(1));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const defaultName = `${row.case_number.replace(/[^a-zA-Z0-9_-]/g, "_")}.zip`;

    if (isTauri()) {
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });
      if (!path) return;
      await invoke("write_file_bytes", { path, bytes: Array.from(bytes) });
      alert(`Kaydedildi: ${path}`);
    } else {
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    alert(`İndirme başarısız: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = "ZIP indir";
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bindEvents() {
  document.querySelectorAll("[data-auth-tab]").forEach((btn) => {
    btn.addEventListener("click", () => showAuthTab(btn.dataset.authTab));
  });

  $("btn-login")?.addEventListener("click", async () => {
    clearNotice();
    const email = $("login-email")?.value?.trim();
    const password = $("login-password")?.value;
    if (!email || !password) return showNotice("E-posta ve şifre girin");
    try {
      await signIn(email, password);
      clearNotice();
      await refreshAuthUI();
    } catch (err) {
      showNotice(`Giriş başarısız: ${formatAuthError(err)}`);
    }
  });

  $("btn-signup")?.addEventListener("click", async () => {
    clearNotice();
    const orgName = $("signup-org-name")?.value?.trim();
    const email = $("signup-email")?.value?.trim();
    const password = $("signup-password")?.value;
    if (!orgName || !email || !password) return showNotice("Tüm alanları doldurun");
    if (password.length < 6) return showNotice("Şifre en az 6 karakter olmalı");
    try {
      const { needsEmailConfirm } = await signUpWithOrganization({
        email,
        password,
        orgName,
        orgType: "lab",
      });
      if (needsEmailConfirm) {
        showNotice(
          "Kayıt oluşturuldu. E-posta onayından sonra giriş yapın. (Geliştirmede: Supabase → Auth → Confirm email kapalı olabilir)",
          "info"
        );
        showAuthTab("login");
      } else {
        clearNotice();
        await refreshAuthUI();
      }
    } catch (err) {
      showNotice(`Kayıt başarısız: ${formatAuthError(err)}`);
    }
  });

  $("btn-setup-org")?.addEventListener("click", async () => {
    clearNotice();
    const orgName = $("setup-org-name")?.value?.trim();
    if (!orgName) return showNotice("Laboratuvar adı girin");
    try {
      await registerOrganization(orgName, "lab");
      clearNotice();
      await refreshAuthUI();
    } catch (err) {
      showNotice(`Organizasyon oluşturulamadı: ${formatAuthError(err)}`);
    }
  });

  $("btn-sign-out")?.addEventListener("click", async () => {
    state.unsubscribeQueue?.();
    state.unsubscribeMessages?.();
    if (state.linksPollTimer) clearInterval(state.linksPollTimer);
    if (state.realtimeBannerTimer) clearTimeout(state.realtimeBannerTimer);
    if (state.queueRefreshTimer) clearTimeout(state.queueRefreshTimer);
    state.previewViewer?.dispose?.();
    revokePreviewUrls();
    await signOut();
    state = {
      org: null,
      cases: [],
      selectedId: null,
      selectedCase: null,
      clinicNames: {},
      unsubscribeQueue: null,
      unsubscribeMessages: null,
      linksPollTimer: null,
      unreadCaseIds: new Set(),
      unreadMessagesByCase: new Map(),
      realtimeBannerTimer: null,
      previewViewer: null,
      previewUrls: [],
      previewKey: null,
      previewReqId: 0,
      previewLoadingKey: null,
      previewLoadedForCaseId: null,
      queueRefreshTimer: null,
      queueRefreshInFlight: false,
    };
    showScreen("auth");
  });

  $("btn-copy-code")?.addEventListener("click", async () => {
    const code = $("pairing-code")?.textContent;
    if (code) {
      await navigator.clipboard.writeText(code);
      alert("Eşleştirme kodu kopyalandı — kliniğe gönderin.");
    }
  });

  $("status-filter")?.addEventListener("change", () => loadQueue());
  $("queue-sort")?.addEventListener("change", () => loadQueue());

  $("detail-status-select")?.addEventListener("change", async (e) => {
    const status = e.target.value;
    await setCaseStatusQuick(status, e.target);
  });

  $("detail-quick-status")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-quick-status]");
    if (!btn) return;
    const next = btn.dataset.quickStatus;
    if (!next || !state.selectedId) return;
    await setCaseStatusQuick(next);
  });

  $("btn-download")?.addEventListener("click", downloadZip);

  $("btn-send-message")?.addEventListener("click", sendMessage);
  $("message-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
}

async function sendMessage() {
  const input = $("message-input");
  const btn = $("btn-send-message");
  const text = input?.value?.trim();
  if (!text || !state.selectedId) return;

  if (btn) btn.disabled = true;
  try {
    const msg = await sendCaseMessage(state.selectedId, text);
    input.value = "";
    appendMessageBubble(msg);
    $("messages-list").scrollTop = $("messages-list")?.scrollHeight || 0;
  } catch (err) {
    alert(`Mesaj gönderilemedi: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
    input?.focus();
  }
}

window.addEventListener("beforeunload", () => {
  state.previewViewer?.dispose?.();
  revokePreviewUrls();
});

export async function initApp() {
  bindEvents();
  initLinksUI();
  initMessagesHub({
    onOpenCase: async (caseId) => {
      showMessagesTab(false);
      await selectCase(caseId, false);
    },
  });
  if (isCloudConfigured()) {
    onAuthStateChange(() => refreshAuthUI());
  }
  await refreshAuthUI();
}
