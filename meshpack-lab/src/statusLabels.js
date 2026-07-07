export const STATUS_LABELS = {
  sent: "Gönderildi",
  received: "Alındı",
  in_production: "Üretimde",
  quality_check: "Kalite kontrol",
  shipped: "Kargoda",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

export const STATUS_ORDER = [
  "sent",
  "received",
  "in_production",
  "quality_check",
  "shipped",
  "completed",
  "cancelled",
];

export function statusLabel(status) {
  return STATUS_LABELS[status] || status;
}

export function statusBadgeClass(status) {
  switch (status) {
    case "sent":
      return "badge-sent";
    case "received":
      return "badge-received";
    case "in_production":
      return "badge-production";
    case "quality_check":
      return "badge-qc";
    case "shipped":
      return "badge-shipped";
    case "completed":
      return "badge-completed";
    case "cancelled":
      return "badge-cancelled";
    default:
      return "badge-sent";
  }
}

export function formatDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatBytes(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function summarizeDentalPlan(plan) {
  const teeth = plan?.teeth || {};
  const entries = Object.entries(teeth);
  if (!entries.length) return "Plan yok";
  return entries
    .map(([fdi, t]) => `${fdi}: ${t.treatment || t.label || "?"}`)
    .join(", ");
}
