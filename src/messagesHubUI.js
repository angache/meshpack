import { getActiveOrganization, getSession, onAuthStateChange } from "./cloud/auth.js";
import { listCaseMessages, sendCaseMessage, subscribeCaseMessages } from "./cloud/messages.js";
import {
  countUnreadNotifications,
  markAllNotificationsRead,
  markNotificationsReadForCase,
  subscribeNotifications,
} from "./cloud/notifications.js";
import { CLOUD_CASE_STATUS_LABELS, listMessageThreads, THREAD_PAGE_SIZE } from "./cloud/messagingHub.js";
import { isCloudConfigured } from "./cloud/supabaseClient.js";
import { getCase } from "./cases.js";

import { mountHubBackIcons, syncHeaderNavButtons } from "./navChrome.js";

const $ = (id) => document.getElementById(id);

let hubOpen = false;
let activeOrgId = null;
let activeThreadId = null;
let activeThread = null;
let threads = [];
let threadsHasMore = false;
let loadingMoreThreads = false;
let threadFilter = "";
let unreadTotal = 0;
let chatHasMore = false;
let oldestLoadedAt = null;
let loadingOlderMessages = false;
let realtimeRefreshTimer = null;
let unsubscribeMessages = null;
let unsubscribeNotifications = null;
let onOpenCaseCallback = null;
let getFileBrowser = null;
let openPlanningCallback = null;

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMessageTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelativeTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Az önce";
  if (mins < 60) return `${mins} dk`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} gün`;
  return formatMessageTime(iso);
}

function setHeaderBadge(count) {
  const badge = $("header-messages-badge");
  const btn = $("btn-header-messages");
  if (!badge || !btn) return;
  if (!isCloudConfigured()) {
    btn.classList.add("hidden");
    return;
  }
  btn.classList.remove("hidden");
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count === 0);
}

function applyUnreadTotal(count) {
  unreadTotal = Math.max(0, Number(count) || 0);
  setHeaderBadge(unreadTotal);
  const hubUnread = $("messages-hub-unread-total");
  if (hubUnread) {
    hubUnread.textContent = String(unreadTotal);
    hubUnread.classList.toggle("hidden", unreadTotal === 0);
  }
}

function adjustUnreadLocal(delta) {
  applyUnreadTotal(unreadTotal + delta);
}

function scheduleRealtimeRefresh() {
  if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = setTimeout(() => {
    realtimeRefreshTimer = null;
    refreshMessagesHubChrome().catch(() => {});
  }, 700);
}

function applyNotificationRealtime(payload, eventType) {
  const caseId = payload?.case_id;
  if (!caseId) return;

  const thread = threads.find((t) => t.caseId === caseId);
  if (!thread) {
    scheduleRealtimeRefresh();
    return;
  }

  if (eventType === "insert") {
    if (caseId === activeThreadId) {
      scheduleRealtimeRefresh();
      return;
    }
    thread.unreadCount = (thread.unreadCount || 0) + 1;
    adjustUnreadLocal(1);
    if (hubOpen) renderThreadList();
    scheduleRealtimeRefresh();
    return;
  }

  if (eventType === "update" && payload?.read_at) {
    if ((thread.unreadCount || 0) > 0) {
      thread.unreadCount -= 1;
      adjustUnreadLocal(-1);
      if (hubOpen) renderThreadList();
    }
    scheduleRealtimeRefresh();
  }
}

async function syncUnreadChrome() {
  try {
    const count = await countUnreadNotifications();
    applyUnreadTotal(count);
    if (hubOpen) {
      renderThreadList();
    }
  } catch (err) {
    console.warn("[messagesHub] syncUnread:", err);
  }
}

function afterCaseNotificationsRead(caseId) {
  const thread = threads.find((t) => t.caseId === caseId);
  if (thread && thread.unreadCount) {
    const prev = thread.unreadCount;
    thread.unreadCount = 0;
    adjustUnreadLocal(-prev);
  }
  renderThreadList();
}

function setHubVisible(visible) {
  hubOpen = visible;
  $("messages-hub-view")?.classList.toggle("hidden", !visible);
  if (visible) {
    const planning = $("planning-view");
    if (planning && !planning.classList.contains("hidden")) {
      planning.dataset.wasOpen = "1";
    }
    $("scans-inbox-view")?.classList.add("hidden");
    $("main-layout")?.classList.add("hidden");
    $("planning-view")?.classList.add("hidden");
    return;
  }

  const planning = $("planning-view");
  const wasPlanningOpen = planning?.dataset?.wasOpen === "1";
  if (wasPlanningOpen) {
    planning.classList.remove("hidden");
    $("main-layout")?.classList.add("hidden");
    delete planning.dataset.wasOpen;
  } else {
    $("main-layout")?.classList.remove("hidden");
  }
  syncHeaderNavButtons();
}

function scrollChatToEnd() {
  const list = $("messages-hub-list");
  if (list) list.scrollTop = list.scrollHeight;
}

function appendChatBubble(msg) {
  const list = $("messages-hub-list");
  if (!list || !msg?.id) return;
  if (list.querySelector(`[data-message-id="${msg.id}"]`)) return;

  const mine = msg.author_org_id === activeOrgId;
  const div = document.createElement("div");
  div.className = `messages-hub-bubble ${mine ? "mine" : "theirs"}`;
  div.dataset.messageId = msg.id;
  div.innerHTML = `
    <div class="messages-hub-bubble-label">${mine ? "Siz" : "Laboratuvar"}</div>
    <div>${escapeHtml(msg.body)}</div>
    <div class="messages-hub-bubble-time">${formatMessageTime(msg.created_at)}</div>
  `;
  list.appendChild(div);
}

function buildChatBubble(msg) {
  const mine = msg.author_org_id === activeOrgId;
  const div = document.createElement("div");
  div.className = `messages-hub-bubble ${mine ? "mine" : "theirs"}`;
  div.dataset.messageId = msg.id;
  div.innerHTML = `
    <div class="messages-hub-bubble-label">${mine ? "Siz" : "Laboratuvar"}</div>
    <div>${escapeHtml(msg.body)}</div>
    <div class="messages-hub-bubble-time">${formatMessageTime(msg.created_at)}</div>
  `;
  return div;
}

function renderLoadOlderButton() {
  const list = $("messages-hub-list");
  if (!list) return;
  let btn = list.querySelector("[data-load-older]");
  if (!chatHasMore) {
    btn?.remove();
    return;
  }
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "messages-hub-load-older";
    btn.dataset.loadOlder = "1";
    list.prepend(btn);
  }
  btn.textContent = loadingOlderMessages ? "Yükleniyor…" : "Daha eski mesajlar";
  btn.disabled = loadingOlderMessages;
}

async function loadOlderMessages() {
  if (!chatHasMore || loadingOlderMessages || !activeThreadId || !oldestLoadedAt) return;
  const list = $("messages-hub-list");
  if (!list) return;

  loadingOlderMessages = true;
  renderLoadOlderButton();
  const prevHeight = list.scrollHeight;
  const prevTop = list.scrollTop;

  try {
    const { messages, hasMore } = await listCaseMessages(activeThreadId, { before: oldestLoadedAt });
    chatHasMore = hasMore;
    if (messages.length) {
      oldestLoadedAt = messages[0].created_at;
      const anchor = list.querySelector("[data-load-older]");
      const frag = document.createDocumentFragment();
      for (const m of messages) {
        if (list.querySelector(`[data-message-id="${m.id}"]`)) continue;
        frag.appendChild(buildChatBubble(m));
      }
      if (anchor) anchor.after(frag);
      else list.prepend(frag);
      // Kaydırma konumunu koru (yeni içerik yukarı eklendi)
      list.scrollTop = prevTop + (list.scrollHeight - prevHeight);
    }
  } catch (err) {
    console.warn("[messagesHub] loadOlder:", err);
  } finally {
    loadingOlderMessages = false;
    renderLoadOlderButton();
  }
}

function renderThreadList() {
  const list = $("messages-thread-list");
  if (!list) return;

  const q = threadFilter.trim().toLowerCase();
  const filtered = threads.filter((t) => {
    if (!q) return true;
    return (
      String(t.caseNumber || "").toLowerCase().includes(q) ||
      String(t.patientName || "").toLowerCase().includes(q) ||
      String(t.lastMessage?.body || "").toLowerCase().includes(q)
    );
  });

  if (!filtered.length) {
    list.innerHTML = `<p class="messages-hub-empty">Henüz konuşma yok. Vakayı laba gönderdikten sonra burada görünür.</p>`;
    return;
  }

  const rows = filtered
    .map((t) => {
      const active = t.caseId === activeThreadId;
      const preview = t.lastMessage?.body
        ? escapeHtml(t.lastMessage.body).slice(0, 80)
        : '<span class="mp-text-faint">Henüz mesaj yok</span>';
      const status = CLOUD_CASE_STATUS_LABELS[t.status] || t.status || "";
      return `
        <button type="button" class="messages-hub-thread ${active ? "is-active" : ""}" data-thread-id="${t.caseId}">
          <div class="messages-hub-thread-top">
            <span class="messages-hub-thread-title">${escapeHtml(t.caseNumber || "Vaka")}</span>
            <span class="messages-hub-thread-time">${formatRelativeTime(t.updatedAt)}</span>
          </div>
          <div class="messages-hub-thread-patient">${escapeHtml(t.patientName || "Hasta")}</div>
          <div class="messages-hub-thread-preview">${preview}</div>
          <div class="messages-hub-thread-meta">
            <span class="messages-hub-thread-status">${escapeHtml(status)}</span>
            ${t.unreadCount ? `<span class="messages-hub-thread-unread">${t.unreadCount}</span>` : ""}
          </div>
        </button>
      `;
    })
    .join("");

  const moreBtn =
    threadsHasMore && !q
      ? `<button type="button" class="messages-hub-load-more" data-load-more-threads>${
          loadingMoreThreads ? "Yükleniyor…" : "Daha fazla konuşma"
        }</button>`
      : "";

  list.innerHTML = rows + moreBtn;
}

async function loadMoreThreads() {
  if (!threadsHasMore || loadingMoreThreads) return;
  loadingMoreThreads = true;
  renderThreadList();
  try {
    const result = await listMessageThreads({ limit: THREAD_PAGE_SIZE, offset: threads.length });
    const seen = new Set(threads.map((t) => t.caseId));
    for (const t of result.threads || []) {
      if (!seen.has(t.caseId)) threads.push(t);
    }
    threadsHasMore = result.hasMore;
  } catch (err) {
    console.warn("[messagesHub] loadMore:", err);
  } finally {
    loadingMoreThreads = false;
    renderThreadList();
  }
}

async function loadThreads(selectCaseId = null) {
  if (!isCloudConfigured()) return;

  const session = await getSession();
  const org = await getActiveOrganization();
  if (!session || !org) {
    threads = [];
    renderThreadList();
    return;
  }

  activeOrgId = org.id;
  const [result, unread] = await Promise.all([
    listMessageThreads({ limit: THREAD_PAGE_SIZE, offset: 0 }),
    countUnreadNotifications().catch(() => 0),
  ]);
  threads = result.threads || [];
  threadsHasMore = result.hasMore;

  applyUnreadTotal(unread);
  renderThreadList();

  const pickId =
    selectCaseId ||
    activeThreadId ||
    threads.find((t) => t.unreadCount > 0)?.caseId ||
    threads[0]?.caseId;

  if (pickId && pickId !== activeThreadId) {
    await selectThread(pickId, { skipMarkRead: false });
  } else if (pickId && activeThreadId === pickId) {
    renderThreadList();
  }
}

function teardownMessageRealtime() {
  unsubscribeMessages?.();
  unsubscribeMessages = null;
}

async function selectThread(caseId, { skipMarkRead = false } = {}) {
  if (!caseId) return;

  activeThreadId = caseId;
  activeThread = threads.find((t) => t.caseId === caseId) || null;
  renderThreadList();

  const empty = $("messages-chat-empty");
  const active = $("messages-chat-active");
  empty?.classList.add("hidden");
  active?.classList.remove("hidden");

  $("messages-chat-title").textContent = activeThread?.caseNumber || "Vaka";
  $("messages-chat-subtitle").textContent = [
    activeThread?.patientName,
    CLOUD_CASE_STATUS_LABELS[activeThread?.status] || activeThread?.status,
  ]
    .filter(Boolean)
    .join(" · ");

  const list = $("messages-hub-list");
  if (list) list.innerHTML = `<p class="messages-hub-empty">Mesajlar yükleniyor…</p>`;

  chatHasMore = false;
  oldestLoadedAt = null;
  teardownMessageRealtime();

  try {
    const { messages, hasMore } = await listCaseMessages(caseId);
    chatHasMore = hasMore;
    oldestLoadedAt = messages[0]?.created_at || null;
    if (list) {
      list.innerHTML = "";
      if (!messages.length) {
        list.innerHTML = `<p class="messages-hub-empty">Henüz mesaj yok. Laboratuvara ilk mesajı yazın.</p>`;
      } else {
        renderLoadOlderButton();
        for (const m of messages) appendChatBubble(m);
      }
    }
    scrollChatToEnd();

    if (!skipMarkRead) {
      await markNotificationsReadForCase(caseId);
      afterCaseNotificationsRead(caseId);
    }

    unsubscribeMessages = subscribeCaseMessages(caseId, (msg) => {
      appendChatBubble(msg);
      scrollChatToEnd();
      const t = threads.find((x) => x.caseId === caseId);
      if (t) {
        t.lastMessage = msg;
        t.updatedAt = msg.created_at;
        renderThreadList();
      }
      const mine = msg.author_org_id === activeOrgId;
      if (!mine && caseId === activeThreadId) {
        markNotificationsReadForCase(caseId)
          .then(() => {
            afterCaseNotificationsRead(caseId);
          })
          .catch(() => {});
      }
    });
  } catch (err) {
    if (list) list.innerHTML = `<p class="messages-hub-empty text-red-400">Mesajlar yüklenemedi: ${escapeHtml(err.message)}</p>`;
  }

  $("messages-hub-input")?.focus();
}

async function sendHubMessage() {
  const input = $("messages-hub-input");
  const btn = $("btn-messages-hub-send");
  const text = input?.value?.trim();
  if (!text || !activeThreadId) return;

  if (btn) btn.disabled = true;
  try {
    const msg = await sendCaseMessage(activeThreadId, text);
    if (input) input.value = "";
    appendChatBubble(msg);
    scrollChatToEnd();
    const t = threads.find((x) => x.caseId === activeThreadId);
    if (t) {
      t.lastMessage = msg;
      t.updatedAt = msg.created_at;
      renderThreadList();
    }
  } catch (err) {
    alert(`Mesaj gönderilemedi: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
    input?.focus();
  }
}

async function openCaseFromHub() {
  if (!activeThreadId || !onOpenCaseCallback) return;
  await onOpenCaseCallback(activeThreadId);
}

async function findAndOpenPlanning(caseId) {
  const fb = getFileBrowser?.();
  if (!fb) {
    alert("Vaka listesi henüz hazır değil.");
    return;
  }

  await fb.refresh?.();
  let match = null;
  for (const [patientId, sessions] of fb.sessionsByPatient || []) {
    const session = sessions.find((s) => s.caseId === caseId);
    if (session) {
      const patient = fb.patients.find((p) => p.id === patientId);
      if (patient) {
        match = { patient, session };
        break;
      }
    }
  }

  if (!match) {
    const localCase = await getCase(caseId).catch(() => null);
    if (localCase) {
      const patient = fb.patients.find((p) => p.id === localCase.patient_id);
      if (patient) {
        fb.openPatient(patient, caseId);
        const session = fb.getActiveScanSession();
        if (session?.caseId === caseId) match = { patient, session };
      }
    }
  }

  if (!match) {
    alert("Bu vaka yerel listede bulunamadı. Hasta panelinden vakayı açın.");
    return;
  }

  closeMessagesHub();
  fb.openPatient(match.patient, match.session.id);
  openPlanningCallback?.(match.patient, match.session);
}

export function openMessagesHub(caseId = null) {
  if (!isCloudConfigured()) {
    alert("Mesajlaşma için MeshPack Cloud yapılandırın (Ayarlar → MeshPack Cloud).");
    return;
  }

  const planning = $("planning-view");
  if (planning && !planning.classList.contains("hidden")) {
    planning.dataset.wasOpen = "1";
  }

  setHubVisible(true);
  mountHubBackIcons();
  // Önceki açılıştan kalan liste varsa anında göster, arkada tazele
  if (threads.length) renderThreadList();
  loadThreads(caseId).catch((err) => console.warn("[messagesHub] load:", err));
}

export function closeMessagesHub() {
  teardownMessageRealtime();
  activeThreadId = null;
  activeThread = null;
  setHubVisible(false);
}

export function isMessagesHubOpen() {
  return hubOpen;
}

export async function refreshMessagesHubChrome() {
  if (!isCloudConfigured()) {
    $("btn-header-messages")?.classList.add("hidden");
    return;
  }

  const session = await getSession();
  const org = await getActiveOrganization();
  $("btn-header-messages")?.classList.toggle("hidden", !(session && org));

  try {
    if (hubOpen) {
      const keep = Math.max(threads.length, THREAD_PAGE_SIZE);
      const [result, unread] = await Promise.all([
        listMessageThreads({ limit: keep, offset: 0 }),
        countUnreadNotifications().catch(() => 0),
      ]);
      threads = result.threads || [];
      threadsHasMore = result.hasMore;
      applyUnreadTotal(unread);
      renderThreadList();
    } else {
      await syncUnreadChrome();
    }
  } catch (err) {
    console.warn("[messagesHub] refresh:", err);
  }
}

export function initMessagesHub({ getFileBrowser: getFb, openPlanning } = {}) {
  getFileBrowser = getFb;
  openPlanningCallback = openPlanning;
  onOpenCaseCallback = findAndOpenPlanning;

  $("btn-messages-hub-back")?.addEventListener("click", () => closeMessagesHub());
  $("btn-messages-hub-send")?.addEventListener("click", () => sendHubMessage());
  $("btn-messages-open-case")?.addEventListener("click", () => openCaseFromHub());
  $("btn-messages-mark-all-read")?.addEventListener("click", async () => {
    try {
      await markAllNotificationsRead();
      for (const t of threads) t.unreadCount = 0;
      applyUnreadTotal(0);
      renderThreadList();
    } catch (err) {
      alert(`İşlem başarısız: ${err.message}`);
    }
  });

  $("messages-hub-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendHubMessage();
    }
  });

  $("messages-thread-search")?.addEventListener("input", (e) => {
    threadFilter = e.target.value || "";
    renderThreadList();
  });

  $("messages-thread-list")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-load-more-threads]")) {
      loadMoreThreads().catch((err) => console.warn(err));
      return;
    }
    const btn = e.target.closest("[data-thread-id]");
    if (!btn) return;
    selectThread(btn.dataset.threadId).catch((err) => console.warn(err));
  });

  $("messages-hub-list")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-load-older]")) {
      loadOlderMessages().catch((err) => console.warn(err));
    }
  });

  unsubscribeNotifications?.();
  unsubscribeNotifications = subscribeNotifications((payload, eventType) => {
    applyNotificationRealtime(payload, eventType);
  });

  onAuthStateChange(() => {
    refreshMessagesHubChrome().catch(() => {});
  });

  refreshMessagesHubChrome().catch(() => {});
}

export function disposeMessagesHub() {
  teardownMessageRealtime();
  unsubscribeNotifications?.();
  unsubscribeNotifications = null;
  if (realtimeRefreshTimer) {
    clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = null;
  }
}
