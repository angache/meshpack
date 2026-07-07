import { invoke } from "@tauri-apps/api/core";
import { createLocalUser, getCurrentUser } from "./appLock.js";
import { canManageLocalUsers, localUserRoleLabel } from "./localUserRoles.js";

function setStatus(message, isErr = false) {
  const el = document.getElementById("local-users-status");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("hidden", !message);
  el.classList.toggle("text-red-400", isErr);
}

async function renderUsersList() {
  const listEl = document.getElementById("local-users-list");
  if (!listEl) return;

  try {
    const users = await invoke("list_local_users");
    if (!users.length) {
      listEl.innerHTML = `<li class="mp-text-muted">Henüz kullanıcı yok</li>`;
      return;
    }
    listEl.innerHTML = users
      .map(
        (u) =>
          `<li class="flex justify-between gap-2"><span>${u.display_name}</span><span class="mp-text-faint">${localUserRoleLabel(u.role)}</span></li>`
      )
      .join("");
  } catch (err) {
    listEl.innerHTML = `<li class="text-red-400">${err}</li>`;
  }
}

function updateAdminPanelVisibility() {
  const panel = document.getElementById("local-users-admin-panel");
  const user = getCurrentUser();
  panel?.classList.toggle("hidden", !canManageLocalUsers(user?.role));
}

export async function refreshLocalUsersAdminUI() {
  updateAdminPanelVisibility();
  if (canManageLocalUsers(getCurrentUser()?.role)) {
    await renderUsersList();
  }
}

export function initLocalUsersUI() {
  document.getElementById("btn-create-local-user")?.addEventListener("click", async () => {
    const name = document.getElementById("new-local-user-name")?.value?.trim();
    const pin = document.getElementById("new-local-user-pin")?.value ?? "";
    const role = document.getElementById("new-local-user-role")?.value ?? "assistant";

    if (!name || !pin) {
      setStatus("Ad ve PIN girin", true);
      return;
    }

    try {
      await createLocalUser(name, pin, role);
      document.getElementById("new-local-user-name").value = "";
      document.getElementById("new-local-user-pin").value = "";
      setStatus(`${name} eklendi`);
      await renderUsersList();
    } catch (err) {
      setStatus(String(err), true);
    }
  });
}
