/** Supabase / RPC hatalarını okunabilir metne çevirir */
export function formatAuthError(err) {
  console.error("[MeshPack Lab auth]", err);
  if (!err) return "Bilinmeyen hata";

  const parts = [];

  if (typeof err.msg === "string" && err.msg.trim()) {
    parts.push(err.msg.trim());
  }
  if (typeof err.message === "string" && err.message.trim() && err.message !== "{}") {
    parts.push(err.message.trim());
  }
  if (typeof err.error_description === "string" && err.error_description.trim()) {
    parts.push(err.error_description.trim());
  }
  if (err.code && !parts.some((p) => p.includes(err.code))) {
    parts.push(`kod: ${err.code}`);
  }
  if (err.status) {
    parts.push(`HTTP ${err.status}`);
  }
  if (err.details && typeof err.details === "string") {
    parts.push(err.details);
  }
  if (err.hint && typeof err.hint === "string") {
    parts.push(err.hint);
  }

  let msg = parts.join(" — ");

  if (!msg) {
    try {
      const serialized = JSON.stringify(err, Object.getOwnPropertyNames(err));
      if (serialized && serialized !== "{}") msg = serialized;
    } catch {
      /* ignore */
    }
  }

  if (!msg || msg === "{}") {
    msg = err.name || "Sunucu hatası (ayrıntı yok)";
  }

  const lower = msg.toLowerCase();

  if (err.step === "register_org") {
    return `Hesap oluştu ama organizasyon kurulamadı: ${msg}. SQL migration'ları çalıştırıldı mı?`;
  }

  if (err.step === "auth_signup" && (lower.includes("database error") || err.status === 500)) {
    return `${msg} → SQL Editor'da şu dosyayı çalıştırın: migrations/20260706130000_fix_handle_new_user.sql`;
  }

  if (lower.includes("already registered") || lower.includes("user already")) {
    return "Bu e-posta zaten kayıtlı. Giriş sekmesini deneyin.";
  }

  if (lower.includes("invalid") && lower.includes("email")) {
    return "Geçersiz e-posta adresi.";
  }

  if (lower.includes("password") && lower.includes("weak")) {
    return "Şifre çok zayıf — en az 6 karakter kullanın.";
  }

  return msg;
}

/** Tauri'de alert() dialog izni gerektirir; yedek olarak satır içi hata gösterir. */
export function showNotice(message, type = "error") {
  const el = document.getElementById("auth-error");
  if (el) {
    el.textContent = message;
    el.classList.remove("hidden");
    el.classList.toggle("auth-error-info", type === "info");
    el.classList.toggle("auth-error-error", type !== "info");
    return;
  }
  try {
    window.alert(message);
  } catch {
    console.error(message);
  }
}

export function clearNotice() {
  const el = document.getElementById("auth-error");
  if (el) {
    el.textContent = "";
    el.classList.add("hidden");
  }
}
