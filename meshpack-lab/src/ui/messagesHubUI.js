import { getActiveOrganization, getSession } from "../cloud/auth.js";
import { listCaseMessages, sendCaseMessage, subscribeCaseMessages } from "../cloud/messages.js";
import {
  countUnreadNotifications,
  markAllNotificationsRead,
  markNotificationsReadForCase,
  subscribeNotifications,
} from "../cloud/notifications.js";
import { CLOUD_CASE_STATUS_LABELS, listMessageThreads, THREAD_PAGE_SIZE } from "../cloud/messagingHub.js";
import { isCloudConfigured } from "../cloud/supabaseClient.js";

const $ = (id) => document.getElementById(id);

let hubVisible = false;
let activeOrgId = null;
let activeThreadId = null;
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

function applyUnreadTotal(count) {
  unreadTotal = Math.max(0, Number(count) || 0);
  setHeaderBadge(unreadTotal);
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
    if (hubVisible) renderThreadList();
    scheduleRealtimeRefresh();
    return;
  }

  if (eventType === "update" && payload?.read_at) {
    if ((thread.unreadCount || 0) > 0) {
      thread.unreadCount -= 1;
      adjustUnreadLocal(-1);
      if (hubVisible) renderThreadList();
    }
    scheduleRealtimeRefresh();
  }
}

async function syncUnreadChrome() {
  try {
    const count = await countUnreadNotifications();
    applyUnreadTotal(count);
    if (hubVisible) {
      renderThreadList();
    }
  } catch (err) {
    console.warn("[lab messagesHub] syncUnread:", err);
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

function buildChatBubble(msg) {
  const mine = msg.author_org_id === activeOrgId;
  const div = document.createElement("div");
  div.className = `message-bubble ${mine ? "mine" : "theirs"}`;
  div.dataset.messageId = msg.id;
  div.innerHTML = `
    <div class="text-[9px] uppercase tracking-wide text-lab-muted mb-0.5">${mine ? "Siz" : "Klinik"}</div>
    <div>${escapeHtml(msg.body)}</div>
    <div class="text-[9px] text-lab-muted mt-1">${formatMessageTime(msg.created_at)}</div>
  `;
  return div;
}

function renderLoadOlderButton() {
  const list = $("hub-messages-list");
  if (!list) return;
  let btn = list.querySelector("[data-load-older]");
  if (!chatHasMore) {
    btn?.remove();
    return;
  }
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hub-load-older";
    btn.dataset.loadOlder = "1";
    list.prepend(btn);
  }
  btn.textContent = loadingOlderMessages ? "Yükleniyor…" : "Daha eski mesajlar";
  btn.disabled = loadingOlderMessages;
}

async function loadOlderMessages() {
  if (!chatHasMore || loadingOlderMessages || !activeThreadId || !oldestLoadedAt) return;
  const list = $("hub-messages-list");
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
      list.scrollTop = prevTop + (list.scrollHeight - prevHeight);
    }
  } catch (err) {
    console.warn("[lab messagesHub] loadOlder:", err);
  } finally {
    loadingOlderMessages = false;
    renderLoadOlderButton();
  }
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

  const rows = filtered
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

  const moreBtn =
    threadsHasMore && !q
      ? `<button type="button" class="hub-load-more" data-load-more-threads>${
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
    console.warn("[lab messagesHub] loadMore:", err);
  } finally {
    loadingMoreThreads = false;
    renderThreadList();
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
    await selectThread(pickId);
  } else if (pickId) {
    renderThreadList();
  }
}

function teardownMessageRealtime() {
  unsubscribeMessages?.();
  unsubscribeMessages = null;
}

async function selectThread(caseId) {
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
        list.innerHTML = `<p class="hub-empty">Henüz mesaj yok. Kliniğe ilk mesajı yazın.</p>`;
      } else {
        renderLoadOlderButton();
        for (const m of messages) appendChatBubble(m);
      }
    }
    scrollChatToEnd();

    await markNotificationsReadForCase(caseId);
    afterCaseNotificationsRead(caseId);

    unsubscribeMessages = subscribeCaseMessages(caseId, (msg) => {
      appendChatBubble(msg);
      scrollChatToEnd();
      const thread = threads.find((x) => x.caseId === caseId);
      if (thread) {
        thread.lastMessage = msg;
        thread.updatedAt = msg.created_at;
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
    if (threads.length) renderThreadList();
    loadThreads().catch((err) => console.warn(err));
  } else {
    teardownMessageRealtime();
    activeThreadId = null;
  }
}

export async function refreshMessagesHubChrome() {
  if (!isCloudConfigured()) return;

  try {
    if (hubVisible) {
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
      for (const t of threads) t.unreadCount = 0;
      applyUnreadTotal(0);
      renderThreadList();
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
    if (e.target.closest("[data-load-more-threads]")) {
      loadMoreThreads().catch((err) => console.warn(err));
      return;
    }
    const btn = e.target.closest("[data-thread-id]");
    if (!btn) return;
    selectThread(btn.dataset.threadId).catch((err) => console.warn(err));
  });

  $("hub-messages-list")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-load-older]")) {
      loadOlderMessages().catch((err) => console.warn(err));
    }
  });

  unsubscribeNotifications?.();
  unsubscribeNotifications = subscribeNotifications((payload, eventType) => {
    applyNotificationRealtime(payload, eventType);
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
