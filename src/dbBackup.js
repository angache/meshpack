import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

export async function backupDatabase() {
  return invoke("backup_database");
}

export async function exportDatabaseToPath(destPath) {
  return invoke("export_database", { destPath });
}

export async function pickAndExportDatabase() {
  const dest = await save({
    title: "Veritabanını dışa aktar",
    defaultPath: `meshpack-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: "SQLite", extensions: ["db"] }],
  });
  if (!dest) return null;
  await exportDatabaseToPath(dest);
  return dest;
}

function setBackupStatus(message, ok = true) {
  const el = document.getElementById("db-backup-status");
  if (!el) return;
  if (!message) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.textContent = message;
  el.className = `text-[10px] ${ok ? "text-medical-green" : "text-red-400"}`;
  el.classList.remove("hidden");
}

export function initDbBackupUI() {
  document.getElementById("btn-db-backup")?.addEventListener("click", async () => {
    setBackupStatus("Yedekleniyor…");
    try {
      const path = await backupDatabase();
      await invoke("reveal_path_in_folder", { path });
      setBackupStatus(`Yedek oluşturuldu: ${path}`);
    } catch (err) {
      setBackupStatus(`Yedeklenemedi: ${err}`, false);
    }
  });

  document.getElementById("btn-db-export")?.addEventListener("click", async () => {
    setBackupStatus("");
    try {
      const path = await pickAndExportDatabase();
      if (path) {
        await invoke("reveal_path_in_folder", { path });
        setBackupStatus(`Dışa aktarıldı: ${path}`);
      }
    } catch (err) {
      setBackupStatus(`Dışa aktarılamadı: ${err}`, false);
    }
  });
}
