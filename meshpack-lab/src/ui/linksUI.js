import { getActiveOrganization } from "../cloud/auth.js";
import {
  LINK_STATUS_LABELS,
  linkPartnerName,
  listMyLabLinks,
  requestClinicLink,
  requestClinicLinkById,
  respondLabLink,
  revokeLabLink,
  searchClinics,
} from "../cloud/labLinks.js";

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLinkRow(link, org) {
  const partner = linkPartnerName(link);
  const isIncoming = link.status === "pending" && link.requested_by_org_id !== org.id;
  const isOutgoing = link.status === "pending" && link.requested_by_org_id === org.id;
  const statusClass =
    link.status === "active" ? "text-lab-green" : link.status === "pending" ? "text-lab-orange" : "text-lab-muted";

  let actions = "";
  if (isIncoming) {
    actions = `
      <div class="flex gap-1.5 mt-1.5">
        <button type="button" class="btn-primary text-[10px] px-2 py-0.5" data-link-accept="${link.link_id}">Kabul</button>
        <button type="button" class="btn-ghost text-[10px] px-2 py-0.5" data-link-reject="${link.link_id}">Reddet</button>
      </div>`;
  } else if (link.status === "active") {
    actions = `<button type="button" class="btn-ghost text-[10px] text-red-400 mt-1" data-link-revoke="${link.link_id}">Kes</button>`;
  } else if (isOutgoing) {
    actions = `<p class="text-[10px] text-lab-muted mt-1">Yanıt bekleniyor…</p>`;
  }

  return `
    <div class="link-row p-2.5 rounded-lg border border-lab-border">
      <div class="flex justify-between gap-2">
        <span class="text-xs font-medium text-lab-text truncate">${escapeHtml(partner)}</span>
        <span class="text-[10px] shrink-0 ${statusClass}">${LINK_STATUS_LABELS[link.status] || link.status}</span>
      </div>
      ${actions}
    </div>`;
}

export async function refreshLinksUI() {
  const org = await getActiveOrganization();
  if (!org) return;

  try {
    const links = await listMyLabLinks();
    const incoming = links.filter((l) => l.status === "pending" && l.requested_by_org_id !== org.id);
    const display = links.filter((l) => l.status !== "pending" || l.requested_by_org_id === org.id);

    const incomingEl = $("links-incoming");
    if (incomingEl) {
      incomingEl.innerHTML = incoming.length
        ? `<p class="text-[10px] text-lab-orange font-medium mb-1">Gelen istekler (${incoming.length}) — onaylayın</p>${incoming.map((l) => renderLinkRow(l, org)).join("")}`
        : "";
    }

    const listEl = $("links-list");
    if (listEl) listEl.innerHTML = display.map((l) => renderLinkRow(l, org)).join("");

    const badge = $("links-badge");
    if (badge) badge.classList.toggle("hidden", incoming.length === 0);

    const banner = $("links-incoming-banner");
    if (banner) {
      if (incoming.length > 0) {
        banner.textContent = `${incoming.length} klinik bağlantı isteği bekliyor — «Klinikler» panelinden onaylayın.`;
        banner.classList.remove("hidden");
      } else {
        banner.classList.add("hidden");
      }
    }
  } catch (err) {
    console.error(err);
  }
}

async function renderClinicSearch(query) {
  const container = $("links-search-results");
  if (!container) return;
  try {
    const results = await searchClinics(query);
    container.innerHTML = results.length
      ? results
          .map((c) => {
            let action =
              c.link_status === "active"
                ? `<span class="text-[10px] text-lab-green">Bağlı</span>`
                : c.link_status === "pending"
                  ? `<span class="text-[10px] text-lab-orange">Bekliyor</span>`
                  : `<button type="button" class="btn-primary text-[10px] px-2 py-0.5" data-request-clinic="${c.id}">İstek</button>`;
            return `<div class="link-row p-2 rounded-lg border border-lab-border flex justify-between gap-2">
              <span class="text-xs text-lab-text truncate">${escapeHtml(c.name)}</span>${action}</div>`;
          })
          .join("")
      : `<p class="text-[10px] text-lab-muted text-center py-2">Sonuç yok</p>`;
  } catch (err) {
    container.innerHTML = `<p class="text-[10px] text-red-400">${escapeHtml(err.message)}</p>`;
  }
}

function showLinksTab(tab) {
  document.querySelectorAll("[data-links-tab]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.linksTab === tab);
  });
  $("links-tab-mine")?.classList.toggle("hidden", tab !== "mine");
  $("links-tab-search")?.classList.toggle("hidden", tab !== "search");
  $("links-tab-code")?.classList.toggle("hidden", tab !== "code");
}

async function handleLinksClick(e) {
  const org = await getActiveOrganization();
  if (!org) return;

  const accept = e.target.closest("[data-link-accept]")?.dataset.linkAccept;
  const reject = e.target.closest("[data-link-reject]")?.dataset.linkReject;
  const revoke = e.target.closest("[data-link-revoke]")?.dataset.linkRevoke;
  const requestId = e.target.closest("[data-request-clinic]")?.dataset.requestClinic;

  try {
    if (accept) {
      await respondLabLink(accept, true);
      alert("Bağlantı kabul edildi.");
    } else if (reject) {
      await respondLabLink(reject, false);
    } else if (revoke) {
      if (!confirm("Bağlantıyı kesmek istiyor musunuz?")) return;
      await revokeLabLink(revoke);
    } else if (requestId) {
      await requestClinicLinkById(requestId);
      alert("İstek gönderildi.");
      await renderClinicSearch($("links-clinic-search")?.value || "");
    }
    if (accept || reject || revoke) await refreshLinksUI();
  } catch (err) {
    alert(err.message);
  }
}

export function initLinksUI() {
  $("btn-open-links")?.addEventListener("click", () => {
    $("links-panel")?.classList.remove("hidden");
    refreshLinksUI();
  });
  $("btn-close-links")?.addEventListener("click", () => $("links-panel")?.classList.add("hidden"));

  document.querySelectorAll("[data-links-tab]").forEach((btn) => {
    btn.addEventListener("click", () => showLinksTab(btn.dataset.linksTab));
  });

  $("links-panel")?.addEventListener("click", handleLinksClick);
  $("links-search-results")?.addEventListener("click", handleLinksClick);

  $("btn-links-search")?.addEventListener("click", () => {
    renderClinicSearch($("links-clinic-search")?.value || "");
  });

  $("btn-links-request-code")?.addEventListener("click", async () => {
    const code = $("links-clinic-code")?.value?.trim();
    if (!code) return alert("Klinik kodu girin");
    try {
      await requestClinicLink(code, $("links-clinic-note")?.value?.trim() || "");
      $("links-clinic-code").value = "";
      $("links-clinic-note").value = "";
      await refreshLinksUI();
      alert("İstek gönderildi.");
    } catch (err) {
      alert(err.message);
    }
  });
}
