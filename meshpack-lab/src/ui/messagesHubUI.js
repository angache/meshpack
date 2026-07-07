import { getActiveOrganization, getSession } from "../cloud/auth.js";
import { listCaseMessages, sendCaseMessage, subscribeCaseMessages } from "../cloud/messages.js";
import {
  countUnreadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationsReadForCase,
  subscribeNotifications,
} from "../cloud/notifications.js";
import { CLOUD_CASE_STATUS_LABELS, listMessageThreads } from "../cloud/messagingHub.js";
import { isCloudConfigured } from "../cloud/supabaseClient.js";

const $ = (id) => document.getElementById(id);

let hubVisible = false;
let activeOrgId = null;
let activeThreadId = null;
let threads = [];
let threadFilter = "";
let unsubscribeMessages = null;
let unsubscribeNotifications = null;
let onOpenCaseCallback = null;

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
  if (!badge) return;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count === 0);
}

function scrollChatToEnd() {
  const list = $("hub-messages-list");
  if (list) list.scrollTop = list.scrollHeight;
}

function appendChatBubble(msg) {
  const list = $("hub-messages-list");
  if (!list || !msg?.id) return;
  if (list.querySelector(`[data-message-id="${msg.id}"]`)) return;

  const mine = msg.author_org_id === activeOrgId;
  const div = document.createElement("div");
  div.className = `message-bubble ${mine ? "mine" : "theirs"}`;
  div.dataset.messageId = msg.id;
  div.innerHTML = `
    <div class="text-[9px] uppercase tracking-wide text-lab-muted mb-0.5">${mine ? "Siz" : "Klinik"}</div>
    <div>${escapeHtml(msg.body)}</div>
    <div class="text-[9px] text-lab-muted mt-1">${formatMessageTime(msg.created_at)}</div>
  `;
  list.appendChild(div);
}

function renderThreadList() {
  const list = $("hub-thread-list");
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
    list.innerHTML = `<p class="hub-empty">Henüz konuşma yok.</p>`;
    return;
  }

  list.innerHTML = filtered
    .map((t) => {
      const active = t.caseId === activeThreadId;
      const preview = t.lastMessage?.body
        ? escapeHtml(t.lastMessage.body).slice(0, 80)
        : '<span class="text-lab-muted">Henüz mesaj yok</span>';
      const status = CLOUD_CASE_STATUS_LABELS[t.status] || t.status || "";
      return `
        <button type="button" class="hub-thread ${active ? "is-active" : ""}" data-thread-id="${t.caseId}">
          <div class="hub-thread-top">
            <span class="hub-thread-title">${escapeHtml(t.caseNumber || "Vaka")}</span>
            <span class="hub-thread-time">${formatRelativeTime(t.updatedAt)}</span>
          </div>
          <div class="hub-thread-patient">${escapeHtml(t.patientName || "Hasta")}</div>
          <div class="hub-thread-preview">${preview}</div>
          <div class="hub-thread-meta">
            <span class="hub-thread-status">${escapeHtml(status)}</span>
            ${t.unreadCount ? `<span class="hub-thread-unread">${t.unreadCount}</span>` : ""}
          </div>
        </button>
      `;
    })
    .join("");
}

async function renderNotifications() {
  const list = $("hub-notifications-list");
  const countEl = $("hub-notifications-count");
  if (!list) return;

  try {
    const items = await listNotifications({ limit: 40 });
    const unread = items.filter((n) => !n.read_at).length;
    if (countEl) {
      countEl.textContent = String(unread);
      countEl.classList.toggle("hidden", unread === 0);
    }

    if (!items.length) {
      list.innerHTML = `<p class="hub-empty">Bildirim yok</p>`;
      return;
    }

    list.innerHTML = items
      .map((n) => {
        const unreadCls = n.read_at ? "" : "is-unread";
        return `
          <button type="button" class="hub-notification ${unreadCls}" data-notification-id="${n.id}" data-case-id="${n.case_id || ""}">
            <div class="hub-notification-title">${escapeHtml(n.title || "Bildirim")}</div>
            <div class="hub-notification-body">${escapeHtml(n.body || "")}</div>
            <div class="hub-notification-time">${formatRelativeTime(n.created_at)}</div>
          </button>
        `;
      })
      .join("");
  } catch (err) {
    list.innerHTML = `<p class="hub-empty">Bildirimler yüklenemedi</p>`;
    console.warn("[lab messagesHub]", err);
  }
}

async function loadThreads(selectCaseId = null) {
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

  const notifUnread = await countUnreadNotifications();
  setHeaderBadge(notifUnread);

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
  const activeThread = threads.find((t) => t.caseId === caseId) || null;
  renderThreadList();

  $("hub-chat-empty")?.classList.add("hidden");
  $("hub-chat-active")?.classList.remove("hidden");

  $("hub-chat-title").textContent = activeThread?.caseNumber || "Vaka";
  $("hub-chat-subtitle").textContent = [
    activeThread?.patientName,
    CLOUD_CASE_STATUS_LABELS[activeThread?.status] || activeThread?.status,
  ]
    .filter(Boolean)
    .join(" · ");

  const list = $("hub-messages-list");
  if (list) list.innerHTML = `<p class="hub-empty">Mesajlar yükleniyor…</p>`;

  teardownMessageRealtime();

  try {
    const messages = await listCaseMessages(caseId);
    if (list) {
      list.innerHTML = "";
      if (!messages.length) {
        list.innerHTML = `<p class="hub-empty">Henüz mesaj yok. Kliniğe ilk mesajı yazın.</p>`;
      } else {
        for (const m of messages) appendChatBubble(m);
      }
    }
    scrollChatToEnd();

    await markNotificationsReadForCase(caseId);
    const t = threads.find((x) => x.caseId === caseId);
    if (t) t.unreadCount = 0;
    if (!skipReloadThreads) await loadThreads(caseId);

    unsubscribeMessages = subscribeCaseMessages(caseId, (msg) => {
      appendChatBubble(msg);
      scrollChatToEnd();
      const thread = threads.find((x) => x.caseId === caseId);
      if (thread) {
        thread.lastMessage = msg;
        thread.updatedAt = msg.created_at;
        renderThreadList();
      }
    });
  } catch (err) {
    if (list) list.innerHTML = `<p class="hub-empty text-red-400">Mesajlar yüklenemedi</p>`;
  }

  $("hub-message-input")?.focus();
}

async function sendHubMessage() {
  const input = $("hub-message-input");
  const btn = $("btn-hub-send-message");
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

export function showMessagesTab(visible) {
  hubVisible = visible;
  $("queue-screen")?.classList.toggle("hidden", visible);
  $("messages-screen")?.classList.toggle("hidden", !visible);
  document.querySelectorAll("[data-main-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.mainTab === (visible ? "messages" : "queue"));
  });

  if (visible) {
    loadThreads().catch((err) => console.warn(err));
    renderNotifications().catch(() => {});
  } else {
    teardownMessageRealtime();
    activeThreadId = null;
  }
}

export async function refreshMessagesHubChrome() {
  if (!isCloudConfigured()) return;

  try {
    const count = await countUnreadNotifications();
    setHeaderBadge(count);
    if (hubVisible) {
      await loadThreads(activeThreadId);
      await renderNotifications();
    }
  } catch (err) {
    console.warn("[lab messagesHub] refresh:", err);
  }
}

export function initMessagesHub({ onOpenCase } = {}) {
  onOpenCaseCallback = onOpenCase;

  document.querySelectorAll("[data-main-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showMessagesTab(btn.dataset.mainTab === "messages");
    });
  });

  $("btn-hub-send-message")?.addEventListener("click", () => sendHubMessage());
  $("btn-hub-open-case")?.addEventListener("click", () => {
    if (activeThreadId && onOpenCaseCallback) {
      onOpenCaseCallback(activeThreadId);
    }
  });
  $("btn-hub-mark-all-read")?.addEventListener("click", async () => {
    try {
      await markAllNotificationsRead();
      await refreshMessagesHubChrome();
    } catch (err) {
      alert(`İşlem başarısız: ${err.message}`);
    }
  });

  $("hub-message-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendHubMessage();
    }
  });

  $("hub-thread-search")?.addEventListener("input", (e) => {
    threadFilter = e.target.value || "";
    renderThreadList();
  });

  $("hub-thread-list")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-thread-id]");
    if (!btn) return;
    selectThread(btn.dataset.threadId).catch((err) => console.warn(err));
  });

  $("hub-notifications-list")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-notification-id]");
    if (!btn) return;
    try {
      await markNotificationRead(btn.dataset.notificationId);
      if (btn.dataset.caseId) await selectThread(btn.dataset.caseId);
      await renderNotifications();
      await refreshMessagesHubChrome();
    } catch (err) {
      console.warn(err);
    }
  });

  unsubscribeNotifications?.();
  unsubscribeNotifications = subscribeNotifications(() => {
    refreshMessagesHubChrome().catch(() => {});
    if (hubVisible) renderNotifications().catch(() => {});
  });
}

export function disposeMessagesHub() {
  teardownMessageRealtime();
  unsubscribeNotifications?.();
  unsubscribeNotifications = null;
}
