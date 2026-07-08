import { getActiveOrganization } from "./cloud/auth.js";
import { listCaseMessages, sendCaseMessage, subscribeCaseMessages } from "./cloud/messages.js";
import { markNotificationsReadForCase } from "./cloud/notifications.js";
import { isCloudConfigured } from "./cloud/supabaseClient.js";
import { openMessagesHub, refreshMessagesHubChrome } from "./messagesHubUI.js";

const $ = (id) => document.getElementById(id);

let activeCaseId = null;
let activeOrgId = null;
let unsubscribe = null;
let bound = false;

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
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setPanelVisible(visible) {
  $("planning-lab-chat")?.classList.toggle("hidden", !visible);
}

function setHint(text) {
  const el = $("planning-lab-chat-hint");
  if (!el) return;
  if (!text) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
}

function scrollMessagesToEnd() {
  const list = $("planning-lab-messages-list");
  if (list) list.scrollTop = list.scrollHeight;
}

function appendMessageBubble(msg) {
  const list = $("planning-lab-messages-list");
  if (!list || !msg?.id) return;
  if (list.querySelector(`[data-message-id="${msg.id}"]`)) return;

  const mine = msg.author_org_id === activeOrgId;
  const div = document.createElement("div");
  div.className = `planning-message-bubble ${mine ? "mine" : "theirs"}`;
  div.dataset.messageId = msg.id;
  div.innerHTML = `
    <div class="planning-message-label">${mine ? "Siz" : "Laboratuvar"}</div>
    <div>${escapeHtml(msg.body)}</div>
    <div class="planning-message-time">${formatMessageTime(msg.created_at)}</div>
  `;
  list.appendChild(div);
}

async function loadMessages(caseId) {
  const list = $("planning-lab-messages-list");
  if (!list) return;

  list.innerHTML = `<p class="text-[10px] mp-text-faint px-1">Mesajlar yükleniyor…</p>`;

  try {
    const { messages } = await listCaseMessages(caseId);
    list.innerHTML = "";
    if (!messages.length) {
      list.innerHTML = `<p class="text-[10px] mp-text-faint px-1">Henüz mesaj yok. Laboratuvara ilk mesajı yazın.</p>`;
      return;
    }
    for (const m of messages) appendMessageBubble(m);
    scrollMessagesToEnd();
  } catch (err) {
    list.innerHTML = `<p class="text-[10px] text-red-400 px-1">Mesajlar yüklenemedi: ${escapeHtml(err.message)}</p>`;
  }
}

function teardownRealtime() {
  unsubscribe?.();
  unsubscribe = null;
}

async function sendPlanningMessage() {
  const input = $("planning-lab-message-input");
  const btn = $("btn-planning-lab-send-message");
  const text = input?.value?.trim();
  if (!text || !activeCaseId) return;

  if (btn) btn.disabled = true;
  try {
    const msg = await sendCaseMessage(activeCaseId, text);
    if (input) input.value = "";
    appendMessageBubble(msg);
    scrollMessagesToEnd();
  } catch (err) {
    alert(`Mesaj gönderilemedi: ${err.message}`);
  } finally {
    if (btn) btn.disabled = false;
    input?.focus();
  }
}

export function bindPlanningCaseMessages() {
  if (bound) return;
  bound = true;

  $("btn-planning-open-messages-hub")?.addEventListener("click", () => {
    if (activeCaseId) openMessagesHub(activeCaseId);
    else openMessagesHub();
  });

  $("btn-planning-lab-send-message")?.addEventListener("click", () => sendPlanningMessage());
  $("planning-lab-message-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPlanningMessage();
    }
  });
}

export async function openPlanningCaseMessages(caseRow) {
  teardownRealtime();
  activeCaseId = null;
  activeOrgId = null;

  if (!caseRow || caseRow.status !== "sent") {
    setPanelVisible(false);
    return;
  }

  if (!isCloudConfigured()) {
    setPanelVisible(true);
    setHint("MeshPack Cloud yapılandırılmamış — Ayarlar → MeshPack Cloud.");
    $("planning-lab-messages-list").innerHTML =
      `<p class="text-[10px] mp-text-faint px-1">Bulut bağlantısı olmadan mesajlaşma kullanılamaz.</p>`;
    $("planning-lab-message-input")?.setAttribute("disabled", "true");
    $("btn-planning-lab-send-message")?.setAttribute("disabled", "true");
    return;
  }

  const org = await getActiveOrganization();
  if (!org) {
    setPanelVisible(true);
    setHint("Mesajlaşmak için MeshPack Cloud oturumu açın.");
    return;
  }

  activeCaseId = caseRow.id;
  activeOrgId = org.id;
  setPanelVisible(true);
  setHint("Bu vaka MeshPack Lab ile paylaşıldıysa laboratuvar anlık yanıt verebilir.");
  $("planning-lab-message-input")?.removeAttribute("disabled");
  $("btn-planning-lab-send-message")?.removeAttribute("disabled");

  await loadMessages(caseRow.id);
  await markNotificationsReadForCase(caseRow.id);
  await refreshMessagesHubChrome();

  unsubscribe = subscribeCaseMessages(caseRow.id, (msg) => {
    appendMessageBubble(msg);
    scrollMessagesToEnd();
    const mine = msg.author_org_id === activeOrgId;
    if (!mine) {
      markNotificationsReadForCase(caseRow.id)
        .then(() => refreshMessagesHubChrome())
        .catch(() => {});
    }
  });
}

export function closePlanningCaseMessages() {
  teardownRealtime();
  activeCaseId = null;
  activeOrgId = null;
  setPanelVisible(false);
  setHint("");
}
