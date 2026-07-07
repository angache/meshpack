import { getActiveOrganization, getSession, onAuthStateChange } from "./cloud/auth.js";
import { listCaseMessages, sendCaseMessage, subscribeCaseMessages } from "./cloud/messages.js";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationsReadForCase,
  subscribeNotifications,
} from "./cloud/notifications.js";
import { CLOUD_CASE_STATUS_LABELS, listMessageThreads } from "./cloud/messagingHub.js";
import { isCloudConfigured } from "./cloud/supabaseClient.js";
import { getCase } from "./cases.js";

const $ = (id) => document.getElementById(id);

let hubOpen = false;
let activeOrgId = null;
let activeThreadId = null;
let activeThread = null;
let threads = [];
let threadFilter = "";
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

function setHubVisible(visible) {
  hubOpen = visible;
  $("messages-hub-view")?.classList.toggle("hidden", !visible);
  if (visible) {
    const planning = $("planning-view");
    if (planning && !planning.classList.contains("hidden")) {
      planning.dataset.wasOpen = "1";
    }
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

  list.innerHTML = filtered
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
}

async function renderNotifications() {
  const list = $("messages-notifications-list");
  const countEl = $("messages-notifications-count");
  if (!list) return;

  try {
    const items = await listNotifications({ limit: 40 });
    const unread = items.filter((n) => !n.read_at).length;
    if (countEl) {
      countEl.textContent = String(unread);
      countEl.classList.toggle("hidden", unread === 0);
    }

    if (!items.length) {
      list.innerHTML = `<p class="messages-hub-empty">Bildirim yok</p>`;
      return;
    }

    list.innerHTML = items
      .map((n) => {
        const unreadCls = n.read_at ? "" : "is-unread";
        return `
          <button type="button" class="messages-hub-notification ${unreadCls}" data-notification-id="${n.id}" data-case-id="${n.case_id || ""}">
            <div class="messages-hub-notification-title">${escapeHtml(n.title || "Bildirim")}</div>
            <div class="messages-hub-notification-body">${escapeHtml(n.body || "")}</div>
            <div class="messages-hub-notification-time">${formatRelativeTime(n.created_at)}</div>
          </button>
        `;
      })
      .join("");
  } catch (err) {
    list.innerHTML = `<p class="messages-hub-empty text-red-400">Bildirimler yüklenemedi</p>`;
    console.warn("[messagesHub] notifications:", err);
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
  const result = await listMessageThreads();
  threads = result.threads || [];

  const totalUnread = threads.reduce((sum, t) => sum + (t.unreadCount || 0), 0);
  const notifUnread = await countUnreadNotifications();
  setHeaderBadge(Math.max(totalUnread, notifUnread));

  const hubUnread = $("messages-hub-unread-total");
  if (hubUnread) {
    hubUnread.textContent = String(notifUnread);
    hubUnread.classList.toggle("hidden", notifUnread === 0);
  }

  renderThreadList();

  const pickId =
    selectCaseId ||
    activeThreadId ||
    threads.find((t) => t.unreadCount > 0)?.caseId ||
    threads[0]?.caseId;

  if (pickId) await selectThread(pickId, { skipReloadThreads: true });
}

function teardownMessageRealtime() {
  unsubscribeMessages?.();
  unsubscribeMessages = null;
}

async function selectThread(caseId, { skipReloadThreads = false } = {}) {
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

  teardownMessageRealtime();

  try {
    const messages = await listCaseMessages(caseId);
    if (list) {
      list.innerHTML = "";
      if (!messages.length) {
        list.innerHTML = `<p class="messages-hub-empty">Henüz mesaj yok. Laboratuvara ilk mesajı yazın.</p>`;
      } else {
        for (const m of messages) appendChatBubble(m);
      }
    }
    scrollChatToEnd();

    await markNotificationsReadForCase(caseId);
    if (activeThread) activeThread.unreadCount = 0;
    if (!skipReloadThreads) await loadThreads(caseId);

    unsubscribeMessages = subscribeCaseMessages(caseId, (msg) => {
      appendChatBubble(msg);
      scrollChatToEnd();
      const t = threads.find((x) => x.caseId === caseId);
      if (t) {
        t.lastMessage = msg;
        t.updatedAt = msg.created_at;
        renderThreadList();
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
  loadThreads(caseId).catch((err) => console.warn("[messagesHub] load:", err));
  renderNotifications().catch(() => {});
}

export function closeMessagesHub() {
  teardownMessageRealtime();
  activeThreadId = null;
  activeThread = null;
  setHubVisible(false);
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
    const count = await countUnreadNotifications();
    setHeaderBadge(count);
    if (hubOpen) {
      await loadThreads(activeThreadId);
      await renderNotifications();
    }
  } catch (err) {
    console.warn("[messagesHub] refresh:", err);
  }
}

export function initMessagesHub({ getFileBrowser: getFb, openPlanning } = {}) {
  getFileBrowser = getFb;
  openPlanningCallback = openPlanning;
  onOpenCaseCallback = findAndOpenPlanning;

  $("btn-header-messages")?.addEventListener("click", () => openMessagesHub());
  $("btn-messages-hub-back")?.addEventListener("click", () => closeMessagesHub());
  $("btn-messages-hub-send")?.addEventListener("click", () => sendHubMessage());
  $("btn-messages-open-case")?.addEventListener("click", () => openCaseFromHub());
  $("btn-messages-mark-all-read")?.addEventListener("click", async () => {
    try {
      await markAllNotificationsRead();
      await refreshMessagesHubChrome();
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
    const btn = e.target.closest("[data-thread-id]");
    if (!btn) return;
    selectThread(btn.dataset.threadId).catch((err) => console.warn(err));
  });

  $("messages-notifications-list")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-notification-id]");
    if (!btn) return;
    const id = btn.dataset.notificationId;
    const caseId = btn.dataset.caseId;
    try {
      await markNotificationRead(id);
      if (caseId) await selectThread(caseId);
      await renderNotifications();
      await refreshMessagesHubChrome();
    } catch (err) {
      console.warn("[messagesHub] notification click:", err);
    }
  });

  unsubscribeNotifications?.();
  unsubscribeNotifications = subscribeNotifications(() => {
    refreshMessagesHubChrome().catch(() => {});
    if (hubOpen) renderNotifications().catch(() => {});
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
}
