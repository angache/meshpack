import { migrateLegacyCloudSessions } from "./secureStorage.js";
import { isCloudConfigured } from "./supabaseClient.js";
import {
  canSendViaMeshPackLab,
  ensureOrganizationFromMetadata,
  getActiveOrganization,
  getLinkedLabOrgId,
  getProfile,
  getSession,
  linkClinicToLab,
  onAuthStateChange,
  registerOrganization,
  signIn,
  signOut,
  signUpWithOrganization,
} from "./auth.js";
import {
  LINK_STATUS_LABELS,
  linkPartnerName,
  listMyLabLinks,
  requestLabLink,
  requestClinicLink,
  requestClinicLinkById,
  respondLabLink,
  revokeLabLink,
  searchClinics,
  searchLabs,
} from "./labLinks.js";
import { clearCloudNotice, formatAuthError, showCloudNotice } from "./cloudNotify.js";

function $(id) {
  return document.getElementById(id);
}

function setMainCloudBadge(mode, text) {
  const badgeEl = $("main-cloud-badge");
  const textEl = $("main-cloud-text");
  if (!badgeEl || !textEl) return;

  badgeEl.classList.remove("is-online", "is-warning", "is-offline");
  badgeEl.classList.add(mode || "is-offline");
  textEl.textContent = text || "Cloud bağlı değil";
}

function showAuthMode(mode) {
  $("cloud-auth-login")?.classList.toggle("hidden", mode !== "login");
  $("cloud-auth-signup")?.classList.toggle("hidden", mode !== "signup");
  $("cloud-auth-tabs")?.querySelectorAll("[data-cloud-auth-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.cloudAuthTab === mode);
  });
}

let linkStatusPollTimer = null;

function scheduleLinkStatusPoll(org) {
  if (linkStatusPollTimer) {
    clearInterval(linkStatusPollTimer);
    linkStatusPollTimer = null;
  }
  if (!org) return;

  linkStatusPollTimer = setInterval(async () => {
    try {
      if (org.org_type === "clinic") {
        await refreshClinicLabsUI(org);
        const q = $("cloud-lab-search")?.value?.trim();
        if (q) await renderLabSearchResults(q);
      } else {
        await refreshLabClinicsUI(org);
        const q = $("cloud-clinic-search")?.value?.trim();
        if (q) await renderClinicSearchResults(q);
      }
    } catch (err) {
      console.warn("[cloud] link poll failed:", err);
    }
  }, 20000);
}

function stopLinkStatusPoll() {
  if (linkStatusPollTimer) {
    clearInterval(linkStatusPollTimer);
    linkStatusPollTimer = null;
  }
}

function showLabLinkTab(tab) {
  document.querySelectorAll("[data-lab-link-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.labLinkTab === tab);
  });
  $("lab-link-tab-mine")?.classList.toggle("hidden", tab !== "mine");
  $("lab-link-tab-search")?.classList.toggle("hidden", tab !== "search");
  $("lab-link-tab-code")?.classList.toggle("hidden", tab !== "code");
}

function showClinicLinkTab(tab) {
  document.querySelectorAll("[data-clinic-link-tab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.clinicLinkTab === tab);
  });
  $("clinic-link-tab-mine")?.classList.toggle("hidden", tab !== "mine");
  $("clinic-link-tab-search")?.classList.toggle("hidden", tab !== "search");
  $("clinic-link-tab-code")?.classList.toggle("hidden", tab !== "code");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLinkRow(link, org, { onAccept, onReject, onRevoke } = {}) {
  const partner = linkPartnerName(link, org.org_type);
  const isIncoming = link.status === "pending" && link.requested_by_org_id !== org.id;
  const isOutgoing = link.status === "pending" && link.requested_by_org_id === org.id;
  const statusClass =
    link.status === "active" ? "text-medical-green" : link.status === "pending" ? "text-orange-400" : "mp-text-muted";

  let actions = "";
  if (isIncoming) {
    actions = `
      <div class="flex gap-1.5 mt-1.5">
        <button type="button" class="mp-btn-primary text-[10px] px-2 py-0.5 rounded" data-link-accept="${link.link_id}">Kabul</button>
        <button type="button" class="mp-btn-secondary text-[10px] px-2 py-0.5 rounded" data-link-reject="${link.link_id}">Reddet</button>
      </div>`;
  } else if (link.status === "active") {
    actions = `
      <button type="button" class="mp-btn-ghost text-[10px] px-2 py-0.5 rounded mt-1 text-red-400" data-link-revoke="${link.link_id}">Bağlantıyı kes</button>`;
  } else if (isOutgoing) {
    actions = `<p class="text-[10px] mp-text-muted mt-1">Yanıt bekleniyor…</p>`;
  }

  const note = link.request_note?.trim()
    ? `<p class="text-[10px] mp-text-faint mt-0.5 italic">"${escapeHtml(link.request_note)}"</p>`
    : "";

  return `
    <div class="cloud-lab-link-row p-2.5 rounded-lg border mp-border">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-medium mp-text-title truncate">${escapeHtml(partner)}</span>
        <span class="text-[10px] shrink-0 ${statusClass}">${LINK_STATUS_LABELS[link.status] || link.status}</span>
      </div>
      ${note}
      ${actions}
    </div>`;
}

async function refreshClinicLabsUI(org) {
  $("cloud-clinic-labs-panel")?.classList.remove("hidden");
  $("cloud-lab-clinics-panel")?.classList.add("hidden");

  const codeEl = $("cloud-clinic-pairing-code");
  if (codeEl) codeEl.textContent = org.pairing_code || "—";

  try {
    const links = await listMyLabLinks();
    const incoming = links.filter((l) => l.status === "pending" && l.requested_by_org_id !== org.id);
    const active = links.filter((l) => l.status === "active");
    const outgoing = links.filter((l) => l.status === "pending" && l.requested_by_org_id === org.id);
    const other = links.filter((l) => l.status === "revoked");

    const incomingEl = $("cloud-incoming-requests");
    if (incomingEl) {
      if (incoming.length) {
        incomingEl.classList.remove("hidden");
        incomingEl.innerHTML = `
          <p class="text-[10px] text-orange-400 font-medium mb-1">Gelen istekler (${incoming.length})</p>
          ${incoming.map((l) => renderLinkRow(l, org)).join("")}
        `;
      } else {
        incomingEl.classList.add("hidden");
        incomingEl.innerHTML = "";
      }
    }

    const listEl = $("cloud-lab-links-list");
    const emptyEl = $("cloud-lab-links-empty");
    const displayLinks = [...active, ...outgoing, ...other];

    if (listEl) {
      listEl.innerHTML = displayLinks.map((l) => renderLinkRow(l, org)).join("");
    }
    emptyEl?.classList.toggle("hidden", displayLinks.length > 0 || incoming.length > 0);

    const activeCount = active.length;
    const statusEl = $("cloud-status");
    if (statusEl && activeCount > 0) {
      statusEl.textContent = `${activeCount} laboratuvar bağlı — MeshPack Lab ile gönderim aktif`;
    }
  } catch (err) {
    console.error(err);
  }
}

async function refreshLabClinicsUI(org) {
  $("cloud-clinic-labs-panel")?.classList.add("hidden");
  $("cloud-lab-clinics-panel")?.classList.remove("hidden");

  const codeEl = $("cloud-lab-pairing-code");
  if (codeEl) codeEl.textContent = org.pairing_code || "—";

  try {
    const links = await listMyLabLinks();
    const incoming = links.filter((l) => l.status === "pending" && l.requested_by_org_id !== org.id);
    const displayLinks = links.filter((l) => l.status !== "pending" || l.requested_by_org_id === org.id);

    const incomingEl = $("cloud-incoming-clinic-requests");
    if (incomingEl) {
      if (incoming.length) {
        incomingEl.classList.remove("hidden");
        incomingEl.innerHTML = `
          <p class="text-[10px] text-orange-400 font-medium mb-1">Gelen istekler (${incoming.length})</p>
          ${incoming.map((l) => renderLinkRow(l, org)).join("")}
        `;
      } else {
        incomingEl.classList.add("hidden");
        incomingEl.innerHTML = "";
      }
    }

    const listEl = $("cloud-clinic-links-list");
    if (listEl) {
      listEl.innerHTML = displayLinks.map((l) => renderLinkRow(l, org)).join("");
    }
  } catch (err) {
    console.error(err);
  }
}

async function renderLabSearchResults(query) {
  const container = $("cloud-lab-search-results");
  if (!container) return;

  try {
    const results = await searchLabs(query);
    if (!results.length) {
      container.innerHTML = `<p class="text-[10px] mp-text-muted text-center py-2">Sonuç bulunamadı</p>`;
      return;
    }

    container.innerHTML = results
      .map((lab) => {
        let action = "";
        if (lab.link_status === "active") {
          action = `<span class="text-[10px] text-medical-green">Bağlı</span>`;
        } else if (lab.link_status === "pending") {
          action = `<span class="text-[10px] text-orange-400" title="Lab onayı bekleniyor">Lab onayı bekleniyor</span>`;
        } else {
          action = `<button type="button" class="mp-btn-primary text-[10px] px-2 py-0.5 rounded" data-request-lab="${lab.id}">İstek gönder</button>`;
        }
        return `
          <div class="cloud-lab-link-row p-2 rounded-lg border mp-border flex items-center justify-between gap-2">
            <span class="text-xs mp-text-title truncate">${escapeHtml(lab.name)}</span>
            ${action}
          </div>`;
      })
      .join("");
  } catch (err) {
    container.innerHTML = `<p class="text-[10px] text-red-400">${escapeHtml(err.message)}</p>`;
  }
}

async function renderClinicSearchResults(query) {
  const container = $("cloud-clinic-search-results");
  if (!container) return;

  try {
    const results = await searchClinics(query);
    if (!results.length) {
      container.innerHTML = `<p class="text-[10px] mp-text-muted text-center py-2">Sonuç bulunamadı</p>`;
      return;
    }

    container.innerHTML = results
      .map((clinic) => {
        let action = "";
        if (clinic.link_status === "active") {
          action = `<span class="text-[10px] text-medical-green">Bağlı</span>`;
        } else if (clinic.link_status === "pending") {
          action = `<span class="text-[10px] text-orange-400">Bekliyor</span>`;
        } else {
          action = `<button type="button" class="mp-btn-primary text-[10px] px-2 py-0.5 rounded" data-request-clinic-id="${clinic.id}">İstek gönder</button>`;
        }
        return `
          <div class="cloud-lab-link-row p-2 rounded-lg border mp-border flex items-center justify-between gap-2">
            <span class="text-xs mp-text-title truncate">${escapeHtml(clinic.name)}</span>
            ${action}
          </div>`;
      })
      .join("");
  } catch (err) {
    container.innerHTML = `<p class="text-[10px] text-red-400">${escapeHtml(err.message)}</p>`;
  }
}

async function handleLinkAction(e) {
  const org = await getActiveOrganization();
  if (!org) return;

  const acceptId = e.target.closest("[data-link-accept]")?.dataset.linkAccept;
  const rejectId = e.target.closest("[data-link-reject]")?.dataset.linkReject;
  const revokeId = e.target.closest("[data-link-revoke]")?.dataset.linkRevoke;
  const requestLabId = e.target.closest("[data-request-lab]")?.dataset.requestLab;
  const requestClinicId = e.target.closest("[data-request-clinic-id]")?.dataset.requestClinicId;

  try {
    if (acceptId) {
      await respondLabLink(acceptId, true);
      alert("Bağlantı kabul edildi.");
    } else if (rejectId) {
      await respondLabLink(rejectId, false);
      alert("İstek reddedildi.");
    } else if (revokeId) {
      if (!confirm("Bu bağlantıyı kesmek istediğinize emin misiniz?")) return;
      await revokeLabLink(revokeId);
      alert("Bağlantı kesildi.");
    } else if (requestLabId) {
      await requestLabLink(requestLabId);
      showLabLinkTab("mine");
      await refreshClinicLabsUI(org);
      await renderLabSearchResults($("cloud-lab-search")?.value || "");
      showCloudNotice(
        "İstek gönderildi. Laboratuvarın MeshPack Lab uygulamasında «Klinikler» bölümünden onaylaması gerekiyor.",
        "info"
      );
    } else if (requestClinicId) {
      await requestClinicLinkById(requestClinicId);
      alert("Kliniğe bağlantı isteği gönderildi.");
      await renderClinicSearchResults($("cloud-clinic-search")?.value || "");
    }

    if (acceptId || rejectId || revokeId) {
      if (org.org_type === "clinic") await refreshClinicLabsUI(org);
      else await refreshLabClinicsUI(org);
    }
  } catch (err) {
    alert(err.message);
  }
}

export async function refreshCloudStatusUI(hintSession = null) {
  const statusEl = $("cloud-status");
  const orgEl = $("cloud-org-info");
  const authPanel = $("cloud-auth-panel");
  const sessionPanel = $("cloud-session-panel");
  const orgSetupPanel = $("cloud-org-setup-panel");

  if (!isCloudConfigured()) {
    setMainCloudBadge("is-warning", "Cloud yapılandırılmadı");
    if (statusEl) {
      statusEl.textContent =
        "İsteğe bağlı — yalnızca MeshPack Lab kullanan laboratuvarlarla çalışırken gerekir.";
    }
    authPanel?.classList.add("hidden");
    sessionPanel?.classList.add("hidden");
    orgSetupPanel?.classList.add("hidden");
    $("cloud-clinic-labs-panel")?.classList.add("hidden");
    $("cloud-lab-clinics-panel")?.classList.add("hidden");
    return;
  }

  const session = hintSession || (await getSession());
  if (!session) {
    stopLinkStatusPoll();
    setMainCloudBadge("is-offline", "Cloud bağlı değil");
    if (statusEl) statusEl.textContent = "Hesap oluşturun veya giriş yapın";
    authPanel?.classList.remove("hidden");
    sessionPanel?.classList.add("hidden");
    orgSetupPanel?.classList.add("hidden");
    showAuthMode("login");
    return;
  }

  authPanel?.classList.add("hidden");

  try {
    await ensureOrganizationFromMetadata(session);
    const profile = await getProfile();
    const org = await getActiveOrganization();

    if (!profile?.active_organization_id || !org) {
      setMainCloudBadge("is-warning", "Cloud kurulum bekliyor");
      if (statusEl) {
        statusEl.textContent = `Giriş: ${session.user.email} — organizasyon kurulumu gerekli`;
      }
      const setupName = $("cloud-setup-org-name");
      const setupType = $("cloud-setup-org-type");
      if (setupName && !setupName.value) {
        setupName.value = session.user.user_metadata?.org_name || "";
      }
      if (setupType && session.user.user_metadata?.org_type) {
        setupType.value = session.user.user_metadata.org_type;
      }
      sessionPanel?.classList.add("hidden");
      orgSetupPanel?.classList.remove("hidden");
      $("cloud-clinic-labs-panel")?.classList.add("hidden");
      $("cloud-lab-clinics-panel")?.classList.add("hidden");
      return;
    }

    orgSetupPanel?.classList.add("hidden");
    sessionPanel?.classList.remove("hidden");

    if (statusEl) statusEl.textContent = `Giriş: ${session.user.email}`;
    if (orgEl) {
      orgEl.textContent = `${org.name} (${org.org_type === "clinic" ? "Klinik" : "Lab"})`;
    }
    setMainCloudBadge("is-online", `Cloud bağlı · ${org.name}`);

    if (org.org_type === "clinic") {
      await refreshClinicLabsUI(org);
    } else {
      await refreshLabClinicsUI(org);
    }
    scheduleLinkStatusPoll(org);
  } catch (err) {
    console.error("[refreshCloudStatusUI]", err);
    setMainCloudBadge("is-warning", "Cloud hata");
    if (statusEl) statusEl.textContent = `Hata: ${formatAuthError(err)}`;
    showCloudNotice(formatAuthError(err));
  }
}

let cloudAuthBusy = false;

export function initCloudUI() {
  if (isCloudConfigured()) {
    migrateLegacyCloudSessions().catch(() => {});
  }

  $("cloud-auth-tabs")?.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-cloud-auth-tab]");
    if (tab) showAuthMode(tab.dataset.cloudAuthTab);
  });

  document.querySelectorAll("[data-lab-link-tab]").forEach((btn) => {
    btn.addEventListener("click", () => showLabLinkTab(btn.dataset.labLinkTab));
  });

  document.querySelectorAll("[data-clinic-link-tab]").forEach((btn) => {
    btn.addEventListener("click", () => showClinicLinkTab(btn.dataset.clinicLinkTab));
  });

  $("cloud-session-panel")?.addEventListener("click", handleLinkAction);
  $("cloud-lab-search-results")?.addEventListener("click", handleLinkAction);
  $("cloud-clinic-search-results")?.addEventListener("click", handleLinkAction);

  $("btn-cloud-sign-in")?.addEventListener("click", () => handleCloudSignIn());
  $("cloud-password")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleCloudSignIn();
  });

  $("btn-cloud-sign-up")?.addEventListener("click", async () => {
    clearCloudNotice();
    const email = $("cloud-signup-email")?.value?.trim();
    const password = $("cloud-signup-password")?.value;
    const orgName = $("cloud-signup-org-name")?.value?.trim();
    const orgType = $("cloud-signup-org-type")?.value;
    if (!email || !password || !orgName) {
      showCloudNotice("Tüm alanları doldurun");
      return;
    }
    if (password.length < 6) {
      showCloudNotice("Şifre en az 6 karakter olmalı");
      return;
    }
    try {
      const { needsEmailConfirm } = await signUpWithOrganization({
        email,
        password,
        orgName,
        orgType,
      });
      if (needsEmailConfirm) {
        showCloudNotice("Kayıt oluşturuldu. E-posta onayından sonra giriş yapın.", "info");
        showAuthMode("login");
      } else {
        clearCloudNotice();
        await refreshCloudStatusUI();
      }
    } catch (err) {
      showCloudNotice(`Kayıt başarısız: ${formatAuthError(err)}`);
    }
  });

  $("btn-cloud-create-org")?.addEventListener("click", async () => {
    clearCloudNotice();
    const orgName = $("cloud-setup-org-name")?.value?.trim();
    const orgType = $("cloud-setup-org-type")?.value;
    if (!orgName) {
      showCloudNotice("Organizasyon adı girin");
      return;
    }
    try {
      await registerOrganization(orgName, orgType);
      clearCloudNotice();
      await refreshCloudStatusUI();
    } catch (err) {
      showCloudNotice(`Organizasyon oluşturulamadı: ${formatAuthError(err)}`);
    }
  });

  $("btn-cloud-link-lab")?.addEventListener("click", async () => {
    const code = $("cloud-lab-link-code")?.value?.trim();
    if (!code) {
      showCloudNotice("Lab eşleştirme kodunu girin");
      return;
    }
    try {
      await linkClinicToLab(code);
      $("cloud-lab-link-code").value = "";
      await refreshCloudStatusUI();
      showCloudNotice("Laboratuvar anında bağlandı.", "info");
    } catch (err) {
      showCloudNotice(`Eşleştirme başarısız: ${formatAuthError(err)}`);
    }
  });

  $("btn-cloud-copy-lab-code")?.addEventListener("click", async () => {
    const code = $("cloud-lab-pairing-code")?.textContent;
    if (code && code !== "—") {
      await navigator.clipboard.writeText(code);
      showCloudNotice("Lab eşleştirme kodu kopyalandı.", "info");
    }
  });

  $("btn-cloud-copy-clinic-code")?.addEventListener("click", async () => {
    const code = $("cloud-clinic-pairing-code")?.textContent;
    if (code && code !== "—") {
      await navigator.clipboard.writeText(code);
      showCloudNotice("Klinik eşleştirme kodu kopyalandı.", "info");
    }
  });

  $("btn-cloud-lab-search")?.addEventListener("click", () => {
    renderLabSearchResults($("cloud-lab-search")?.value || "");
  });

  $("cloud-lab-search")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") renderLabSearchResults(e.target.value || "");
  });

  $("btn-cloud-clinic-search")?.addEventListener("click", () => {
    renderClinicSearchResults($("cloud-clinic-search")?.value || "");
  });

  $("cloud-clinic-search")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") renderClinicSearchResults(e.target.value || "");
  });

  $("btn-cloud-request-clinic")?.addEventListener("click", async () => {
    const code = $("cloud-clinic-link-code")?.value?.trim();
    const note = $("cloud-clinic-link-note")?.value?.trim() || "";
    if (!code) {
      showCloudNotice("Klinik eşleştirme kodunu girin");
      return;
    }
    try {
      await requestClinicLink(code, note);
      $("cloud-clinic-link-code").value = "";
      $("cloud-clinic-link-note").value = "";
      const org = await getActiveOrganization();
      if (org) await refreshLabClinicsUI(org);
      showCloudNotice("Kliniğe bağlantı isteği gönderildi.", "info");
    } catch (err) {
      showCloudNotice(`İstek gönderilemedi: ${formatAuthError(err)}`);
    }
  });

  $("btn-cloud-sign-out")?.addEventListener("click", async () => {
    stopLinkStatusPoll();
    await signOut();
    await refreshCloudStatusUI();
  });

  if (isCloudConfigured()) {
    onAuthStateChange(() => {
      if (!cloudAuthBusy) refreshCloudStatusUI();
    });
  }

  refreshCloudStatusUI().catch((err) => {
    console.warn("[cloud init]", err);
  });
}

async function handleCloudSignIn() {
  clearCloudNotice();
  const btn = $("btn-cloud-sign-in");
  const email = $("cloud-email")?.value?.trim();
  const password = $("cloud-password")?.value;
  if (!email || !password) {
    showCloudNotice("E-posta ve şifre girin");
    return;
  }
  const prevLabel = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Giriş yapılıyor…";
  }
  cloudAuthBusy = true;
  try {
    const data = await signIn(email, password);
    const session = data?.session;
    if (!session) {
      showCloudNotice("Giriş başarısız: oturum alınamadı");
      return;
    }
    await ensureOrganizationFromMetadata(session);
    clearCloudNotice();
    await refreshCloudStatusUI(session);
  } catch (err) {
    console.error("[cloud sign-in]", err);
    showCloudNotice(`Giriş başarısız: ${formatAuthError(err)}`);
  } finally {
    cloudAuthBusy = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevLabel || "Giriş yap";
    }
  }
}

export { isCloudConfigured, canSendViaMeshPackLab };
