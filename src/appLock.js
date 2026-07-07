import { invoke } from "@tauri-apps/api/core";
import { getSessionTimeoutMs } from "./settings.js";
import { closeSettingsModal } from "./settingsUI.js";
import { localUserRoleLabel } from "./localUserRoles.js";

/** @type {"setup" | "login" | "change" | null} */
let mode = null;
let unlockResolver = null;
let idleTimer = null;
let loggedIn = false;
/** @type {{ user_id: string, display_name: string, role: string } | null} */
let currentUser = null;
/** @type {{ id: string, display_name: string, role: string }[]} */
let userList = [];

function $(id) {
  return document.getElementById(id);
}

export function getCurrentUser() {
  return currentUser;
}

function showError(message) {
  const el = $("app-lock-error");
  if (!el) return;
  if (!message) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.textContent = message;
  el.classList.remove("hidden");
}

function renderUserSelect() {
  const select = $("app-lock-user");
  if (!select) return;
  select.innerHTML = userList
    .map(
      (u) =>
        `<option value="${u.id}">${u.display_name} (${localUserRoleLabel(u.role)})</option>`
    )
    .join("");
  if (userList.length === 1) {
    select.value = userList[0].id;
  }
}

async function loadUserList() {
  try {
    userList = await invoke("list_local_users");
    renderUserSelect();
  } catch {
    userList = [];
  }
}

function updateHeaderUser() {
  const el = $("header-user-label");
  if (!el) return;
  if (currentUser) {
    el.textContent = `${currentUser.display_name} · ${localUserRoleLabel(currentUser.role)}`;
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

async function setMode(nextMode) {
  mode = nextMode;
  const screen = $("app-lock-screen");
  const nameField = $("app-lock-name-wrap");
  const userField = $("app-lock-user-wrap");
  const pin = $("app-lock-pin");
  const pinNew = $("app-lock-pin-new");
  const confirm = $("app-lock-pin-confirm");
  const submit = $("app-lock-submit");
  const subtitle = $("app-lock-subtitle");
  const title = $("app-lock-title");

  screen?.classList.remove("hidden");
  showError("");

  if (nextMode === "login" || nextMode === "change") {
    await loadUserList();
  }

  nameField?.classList.toggle("hidden", nextMode !== "setup");
  userField?.classList.toggle("hidden", nextMode === "setup");

  if (pin) {
    pin.value = "";
    pin.placeholder =
      nextMode === "change" ? "Mevcut PIN" : nextMode === "setup" ? "PIN belirleyin" : "PIN";
  }
  if (pinNew) {
    pinNew.value = "";
    pinNew.classList.toggle("hidden", nextMode !== "change");
  }
  if (confirm) {
    confirm.value = "";
    confirm.classList.toggle("hidden", nextMode === "login");
    confirm.placeholder = nextMode === "change" ? "Yeni PIN (tekrar)" : "PIN (tekrar)";
  }

  if (title) {
    title.textContent =
      nextMode === "setup"
        ? "İlk doktor hesabını oluşturun"
        : nextMode === "change"
          ? "PIN değiştir"
          : "MeshPack";
  }

  if (subtitle) {
    subtitle.textContent =
      nextMode === "setup"
        ? "İlk doktor hesabınızı oluşturun. Asistanları sonra Ayarlar → Genel'den ekleyebilirsiniz."
        : nextMode === "change"
          ? "Kullanıcı seçin ve PIN'inizi güncelleyin."
          : "Kimlik seçin ve PIN ile giriş yapın.";
  }

  if (submit) {
    submit.textContent =
      nextMode === "setup"
        ? "Hesabı oluştur"
        : nextMode === "change"
          ? "PIN'i güncelle"
          : "Giriş yap";
  }

  if (nextMode === "setup") {
    $("app-lock-name")?.focus();
  } else {
    pin?.focus();
  }
}

function hideLockScreen() {
  $("app-lock-screen")?.classList.add("hidden");
  showError("");
}

function stopIdleWatcher() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleLock() {
  stopIdleWatcher();
  if (!loggedIn || mode) return;
  idleTimer = setTimeout(() => {
    lockApp();
  }, getSessionTimeoutMs());
}

function bindIdleWatcher() {
  const events = ["mousedown", "mousemove", "keydown", "touchstart", "scroll", "wheel"];
  const reset = () => {
    if (loggedIn && !mode) scheduleIdleLock();
  };
  events.forEach((ev) => document.addEventListener(ev, reset, { passive: true }));
}

function onLoginSuccess(user) {
  currentUser = user;
  loggedIn = true;
  hideLockScreen();
  mode = null;
  updateHeaderUser();
  scheduleIdleLock();
  import("./localUsersUI.js")
    .then((m) => m.refreshLocalUsersAdminUI())
    .catch(() => {});
  unlockResolver?.();
  unlockResolver = null;
}

async function handleSubmit() {
  const displayName = $("app-lock-name")?.value?.trim() ?? "";
  const userId = $("app-lock-user")?.value ?? "";
  const pin = $("app-lock-pin")?.value ?? "";
  const pinNew = $("app-lock-pin-new")?.value ?? "";
  const confirm = $("app-lock-pin-confirm")?.value ?? "";
  const submit = $("app-lock-submit");

  if (submit) submit.disabled = true;

  try {
    if (mode === "setup") {
      if (!displayName) {
        showError("Ad soyad girin");
        return;
      }
      if (!pin || pin !== confirm) {
        showError(!pin ? "PIN girin" : "PIN'ler eşleşmiyor");
        return;
      }
      const user = await invoke("local_auth_setup_first_user", {
        displayName,
        pin,
      });
      onLoginSuccess(user);
      return;
    }

    if (mode === "change") {
      if (!userId || !pinNew || !confirm) {
        showError("Tüm alanları doldurun");
        return;
      }
      if (pinNew !== confirm) {
        showError("Yeni PIN'ler eşleşmiyor");
        return;
      }
      await invoke("local_auth_change_pin", {
        userId,
        currentPin: pin,
        newPin: pinNew,
      });
      if (currentUser?.user_id === userId) {
        onLoginSuccess({ ...currentUser });
      } else {
        hideLockScreen();
        mode = null;
        unlockResolver?.();
        unlockResolver = null;
        scheduleIdleLock();
      }
      return;
    }

    if (!userId) {
      showError("Kullanıcı seçin");
      return;
    }
    if (!pin) {
      showError("PIN girin");
      return;
    }

    const ok = await invoke("local_auth_login", { userId, pin });
    if (!ok) {
      showError("Hatalı PIN");
      $("app-lock-pin").value = "";
      $("app-lock-pin")?.focus();
      return;
    }

    const status = await invoke("local_auth_status");
    if (status.user) {
      onLoginSuccess(status.user);
    }
  } catch (err) {
    showError(String(err));
  } finally {
    if (submit) submit.disabled = false;
  }
}

export function isAppUnlocked() {
  return loggedIn;
}

export async function lockApp() {
  if (!loggedIn) return;
  await invoke("local_auth_lock");
  loggedIn = false;
  currentUser = null;
  updateHeaderUser();
  stopIdleWatcher();
  await setMode("login");
  return new Promise((resolve) => {
    unlockResolver = resolve;
  });
}

export async function openChangePinDialog() {
  stopIdleWatcher();
  await setMode("change");
  return new Promise((resolve) => {
    unlockResolver = resolve;
  });
}

export function refreshIdleTimeout() {
  if (loggedIn && !mode) scheduleIdleLock();
}

export async function initAppLock() {
  bindIdleWatcher();

  const status = await invoke("local_auth_status");
  if (!status.configured) {
    await setMode("setup");
  } else if (!status.logged_in) {
    await setMode("login");
  } else {
    loggedIn = true;
    currentUser = status.user;
    updateHeaderUser();
    scheduleIdleLock();
    return;
  }

  return new Promise((resolve) => {
    unlockResolver = resolve;
  });
}

export function initAppLockUI() {
  $("app-lock-submit")?.addEventListener("click", () => handleSubmit());
  $("app-lock-name")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });
  $("app-lock-pin")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });
  $("app-lock-pin-new")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });
  $("app-lock-pin-confirm")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSubmit();
  });
  $("btn-app-lock-now")?.addEventListener("click", async () => {
    closeSettingsModal();
    await lockApp();
  });
  $("btn-app-lock-change-pin")?.addEventListener("click", async () => {
    closeSettingsModal();
    await openChangePinDialog();
  });
}

export async function createLocalUser(displayName, pin, role = "assistant") {
  return invoke("create_local_user", { displayName, pin, role });
}

export async function refreshLocalUsersList() {
  return loadUserList();
}
