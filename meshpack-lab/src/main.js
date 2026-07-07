import { initApp } from "./ui/app.js";

initApp().catch((err) => {
  console.error("MeshPack Lab başlatılamadı:", err);
});
