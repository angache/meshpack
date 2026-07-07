import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { alignBiteRegistration } from "../../../src/alignment.js";
import { PreviewAnnotations } from "./previewAnnotations.js";

/** Klinik viewer.js ile aynı görsel ayarlar */
const SCAN_COLORS = {
  upper: 0xc9b87a,
  lower: 0xc9b87a,
  bite: 0xd45c5c,
};

const SCAN_EMISSIVE = {
  upper: 0x3a3020,
  lower: 0x3a3020,
  bite: 0x501818,
};

const SCAN_OPACITY = { upper: 1, lower: 1, bite: 0.78 };
const TARGET_MAX_DIM = 80;

async function loadGeometryFromBlob(blob, ext) {
  const url = URL.createObjectURL(blob);
  try {
    if (ext === "stl") return await new STLLoader().loadAsync(url);
    if (ext === "ply") return await new PLYLoader().loadAsync(url);
    throw new Error(`Desteklenmeyen önizleme türü: ${ext}`);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Klinik viewer geometriyi olduğu gibi yükler; yalnızca aşırı birim sapmasında
 * tüm çenelere aynı ölçeği uygular (merkezleme yok — tarayıcı hizası korunur).
 */
function normalizeSceneUnitScale(meshes) {
  let maxDim = 0;
  for (const mesh of Object.values(meshes)) {
    mesh.geometry.computeBoundingBox();
    const size = new THREE.Vector3();
    mesh.geometry.boundingBox.getSize(size);
    maxDim = Math.max(maxDim, size.x, size.y, size.z);
  }
  if (!maxDim || !Number.isFinite(maxDim)) return 1;
  if (maxDim >= 2 && maxDim <= 500) return 1;

  const scale = TARGET_MAX_DIM / maxDim;
  for (const mesh of Object.values(meshes)) {
    mesh.geometry.scale(scale, scale, scale);
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  }
  return scale;
}

export class MeshPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.meshes = {};
    this.meshGroup = null;
    this.annotations = null;
    this.scanEntries = [];
    this.visibility = { upper: true, lower: true, bite: true };
    this.unitScale = 1;
    this.aligned = false;
    this.alignmentMode = null;
    this.animationId = null;
    this.resizeObserver = null;
    this.resizeRaf = null;
    this._init();
  }

  _init() {
    const host = this.canvas.parentElement;
    const w = Math.max(10, host.clientWidth);
    const h = Math.max(10, host.clientHeight);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x161b22);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 50000);
    this.camera.position.set(0, -80, 120);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setSize(w, h, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.meshGroup = new THREE.Group();
    this.scene.add(this.meshGroup);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(80, 120, 100);
    this.scene.add(key);

    this.annotations = new PreviewAnnotations(this);

    this.resizeObserver = new ResizeObserver(() => {
      if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf);
      this.resizeRaf = requestAnimationFrame(() => this._resize());
    });
    this.resizeObserver.observe(host);
    this._animate();
  }

  _animate() {
    this.animationId = requestAnimationFrame(() => this._animate());
    this.controls?.update();
    this.renderer?.render(this.scene, this.camera);
  }

  _resize() {
    const host = this.canvas.parentElement;
    const w = Math.max(10, host.clientWidth);
    const h = Math.max(10, host.clientHeight);
    if (w === 0 || h === 0) return;
    if (Math.abs(w - (this._lastW || 0)) < 2 && Math.abs(h - (this._lastH || 0)) < 2) return;
    this._lastW = w;
    this._lastH = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  _resetMeshTransform(mesh) {
    mesh.position.set(0, 0, 0);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.updateMatrix();
  }

  clear() {
    this.annotations?.clear();
    for (const mesh of Object.values(this.meshes)) {
      this.meshGroup?.remove(mesh);
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    }
    this.meshes = {};
    this.unitScale = 1;
    this.aligned = false;
    this.alignmentMode = null;
  }

  dispose() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    if (this.resizeRaf) cancelAnimationFrame(this.resizeRaf);
    this.resizeObserver?.disconnect();
    this.annotations?.dispose();
    this.controls?.dispose();
    this.clear();
    this.scanEntries = [];
    this.renderer?.dispose();
  }

  hasMesh(type) {
    return !!this.meshes[type];
  }

  setVisible(type, visible) {
    this.visibility[type] = !!visible;
    if (this.meshes[type]) this.meshes[type].visible = this.visibility[type];
    this.fitCamera();
  }

  async _addScanBlob(type, blob, ext) {
    const geometry = await loadGeometryFromBlob(blob, ext);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    if (this.meshes[type]) {
      this.meshGroup.remove(this.meshes[type]);
      this.meshes[type].geometry.dispose();
      this.meshes[type].material.dispose();
    }

    const isBite = type === "bite";
    const material = new THREE.MeshStandardMaterial({
      color: SCAN_COLORS[type] || 0xeeeeee,
      emissive: SCAN_EMISSIVE[type] || 0x111111,
      emissiveIntensity: 0.15,
      metalness: 0.05,
      roughness: 0.42,
      transparent: isBite,
      opacity: SCAN_OPACITY[type] ?? 1,
      side: THREE.DoubleSide,
      depthWrite: !isBite,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = type;
    mesh.visible = this.visibility[type] ?? true;
    this._resetMeshTransform(mesh);
    this.meshes[type] = mesh;
    this.meshGroup.add(mesh);
    return mesh;
  }

  async _reloadAllScansFromBlobs() {
    const entries = [...this.scanEntries];
    this.clear();
    this.scanEntries = entries;

    for (const { type, blob, ext } of entries) {
      await this._addScanBlob(type, blob, ext);
    }
    this.unitScale = normalizeSceneUnitScale(this.meshes);
    this.aligned = false;
    this.alignmentMode = null;
  }

  async loadScans(entries) {
    this.scanEntries = [...entries];
    await this._reloadAllScansFromBlobs();
    return this.scanEntries.length;
  }

  applyAlignmentFromPackage(transforms) {
    if (!transforms || typeof transforms !== "object") return false;

    let applied = false;
    for (const type of ["upper", "bite", "lower"]) {
      const mesh = this.meshes[type];
      const raw = transforms[type];
      if (!mesh || !Array.isArray(raw) || raw.length !== 16) continue;
      const matrix = new THREE.Matrix4().fromArray(raw.map(Number));
      mesh.applyMatrix4(matrix);
      mesh.geometry.applyMatrix4(matrix);
      applied = true;
    }

    this.aligned = applied;
    this.alignmentMode = applied ? transforms.mode || "package" : null;
    return applied;
  }

  /** Klinik main.js acceptScannerAlignment — tarayıcıdan gelen hizayı koru */
  acceptScannerAlignment() {
    this.aligned = Object.keys(this.meshes).length > 0;
    this.alignmentMode = this.aligned ? "scanner" : null;
  }

  /** Yalnızca elle/ileride: ICP (tarayıcı hizasını bozabilir) */
  async alignBiteIcp() {
    if (!this.meshes.upper || !this.meshes.lower || !this.meshes.bite) {
      return false;
    }

    await this._reloadAllScansFromBlobs();

    alignBiteRegistration({
      upper: { mesh: this.meshes.upper, geometry: this.meshes.upper.geometry },
      lower: { mesh: this.meshes.lower, geometry: this.meshes.lower.geometry },
      bite: { mesh: this.meshes.bite, geometry: this.meshes.bite.geometry },
    });

    this.aligned = true;
    this.alignmentMode = "icp";
    this.annotations?.rebuild();
    this.fitCamera();
    return true;
  }

  setAnnotations(raw) {
    this.annotations?.setAnnotations(raw, this.unitScale);
  }

  focusPoint(worldPoint) {
    this.controls.target.copy(worldPoint);
    const box = new THREE.Box3();
    for (const mesh of Object.values(this.meshes)) {
      if (mesh.visible) box.expandByObject(mesh);
    }
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    this.camera.position.set(
      worldPoint.x,
      worldPoint.y - maxDim * 0.8,
      worldPoint.z + maxDim * 1.4
    );
    this.camera.up.set(0, 1, 0);
    this.controls.update();
  }

  /** Klinik MeshViewer._fitCamera */
  fitCamera() {
    const box = new THREE.Box3();
    for (const mesh of Object.values(this.meshes)) {
      if (mesh.visible) box.expandByObject(mesh);
    }
    if (box.isEmpty()) {
      for (const mesh of Object.values(this.meshes)) box.expandByObject(mesh);
    }
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);

    this.controls.target.copy(center);
    this.camera.position.set(center.x, center.y - maxDim * 0.8, center.z + maxDim * 1.4);
    this.camera.near = Math.max(0.1, maxDim / 500);
    this.camera.far = Math.max(5000, maxDim * 50);
    this.camera.up.set(0, 1, 0);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }
}
