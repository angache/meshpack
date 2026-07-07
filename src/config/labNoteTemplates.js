/** Hızlı lab notu şablonları — planlama sayfasında kullanılır */

export const LAB_NOTE_TEMPLATES = [
  { label: "+ Zirkonyum", text: "Zirkonyum Kron" },
  { label: "+ E-Max", text: "E-Max İnley" },
  { label: "+ Kapanış", text: "Kapanış Kontrol" },
  { label: "+ Geçici", text: "Geçici protez" },
];

export function appendLabNoteTemplate(currentValue, templateText) {
  const current = String(currentValue || "").trim();
  if (!current) return templateText;
  if (current.includes(templateText)) return current;
  return `${current}, ${templateText}`;
}
