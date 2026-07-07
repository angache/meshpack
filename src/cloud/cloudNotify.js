/** Supabase / RPC hatalarını okunabilir metne çevirir */
export function formatAuthError(err) {
  console.error("[MeshPack Cloud auth]", err);
  if (!err) return "Bilinmeyen hata";

  const parts = [];

  if (typeof err.msg === "string" && err.msg.trim()) parts.push(err.msg.trim());
  if (typeof err.message === "string" && err.message.trim() && err.message !== "{}") {
    parts.push(err.message.trim());
  }
  if (err.code && !parts.some((p) => p.includes(String(err.code)))) {
    parts.push(`kod: ${err.code}`);
  }
  if (err.status) parts.push(`HTTP ${err.status}`);
  if (typeof err.details === "string" && err.details) parts.push(err.details);
  if (typeof err.hint === "string" && err.hint) parts.push(err.hint);

  let msg = parts.join(" — ");
  if (!msg) {
    try {
      const s = JSON.stringify(err, Object.getOwnPropertyNames(err));
      if (s && s !== "{}") msg = s;
    } catch {
      /* ignore */
    }
  }
  if (!msg || msg === "{}") msg = err.name || "Sunucu hatası";

  const lower = msg.toLowerCase();

  if (err.step === "register_org") {
    if (lower.includes("oturum gerekli")) {
      return "Hesap oluştu. Giriş sekmesinden e-posta ve şifrenizle giriş yapın — organizasyon otomatik kurulur.";
    }
    return `Hesap oluştu ama organizasyon kurulamadı: ${msg}`;
  }
  if (lower.includes("kasa çözülemedi")) {
    return `${msg} — Uygulamayı yeniden başlatın. Sorun sürerse ~/Library/Application Support/meshpack/secure/ klasörünü silin.`;
  }
  if (err.step === "auth_signup" && lower.includes("database error")) {
    return `${msg} — fix_handle_new_user.sql çalıştırıldı mı?`;
  }
  if (lower.includes("already registered") || lower.includes("user already")) {
    return "Bu e-posta zaten kayıtlı. Giriş sekmesini deneyin.";
  }
  return msg;
}

export function showCloudNotice(message, type = "error") {
  const el = document.getElementById("cloud-auth-error");
  if (el) {
    el.textContent = message;
    el.classList.remove("hidden");
    el.classList.toggle("cloud-notice-info", type === "info");
    el.classList.toggle("cloud-notice-error", type !== "info");
    return;
  }
  console.error(message);
}

export function clearCloudNotice() {
  const el = document.getElementById("cloud-auth-error");
  if (el) {
    el.textContent = "";
    el.classList.add("hidden");
  }
}
