import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { convertFileSrc } from "@tauri-apps/api/core";
import { alignBiteRegistration } from "./alignment.js";

/** Kirli sarı (üst/alt çene) ve kırmızı (kapanış) */
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

const SCAN_OPACITY = {
  upper: 1,
  lower: 1,
  bite: 0.78,
};

export class MeshViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.meshes = {};
    this.meshGroup = null;
    this.animationId = null;
    this.aligned = false;
    this.visibility = { upper: true, lower: true, bite: false };
    this._init();
  }

  _init() {
    const container = this.canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a2030);

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 2000);
    this.camera.position.set(0, -80, 120);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.1);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xffffff, 0.45);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(80, 120, 100);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xc8d8f0, 0.7);
    fill.position.set(-80, 60, -60);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(0, -40, -120);
    this.scene.add(rim);

    this.meshGroup = new THREE.Group();
    this.scene.add(this.meshGroup);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);

    const ro = new ResizeObserver(() => this._resize());
    ro.observe(container);

    this._animate();
  }

  _resize() {
    const container = this.canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    this.animationId = requestAnimationFrame(() => this._animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  async _loadGeometry(filePath) {
    const ext = filePath.split(".").pop().toLowerCase();
    const assetUrl = convertFileSrc(filePath);

    if (ext === "stl") {
      return new STLLoader().loadAsync(assetUrl);
    }
    if (ext === "ply") {
      return new PLYLoader().loadAsync(assetUrl);
    }
    throw new Error(`Desteklenmeyen format: .${ext}`);
  }

  _clearMeshes() {
    for (const mesh of Object.values(this.meshes)) {
      this.meshGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.meshes = {};
    this.aligned = false;
  }

  clearAll() {
    this._clearMeshes();
    this.visibility = { upper: true, lower: true, bite: false };
  }

  setVisible(type, visible) {
    this.visibility[type] = visible;
    if (this.meshes[type]) {
      this.meshes[type].visible = visible;
    }
  }

  isVisible(type) {
    return !!this.visibility[type];
  }

  hasMesh(type) {
    return !!this.meshes[type];
  }

  _fitCamera() {
    const box = new THREE.Box3();
    for (const [, mesh] of Object.entries(this.meshes)) {
      if (mesh.visible) box.expandByObject(mesh);
    }
    if (box.isEmpty()) {
      for (const mesh of Object.values(this.meshes)) {
        box.expandByObject(mesh);
      }
    }
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    this.controls.target.copy(center);
    this.camera.position.set(center.x, center.y - maxDim * 0.8, center.z + maxDim * 1.4);
    this.controls.update();
  }

  async loadFile(filePath, type = "upper") {
    this._clearMeshes();
    await this.addScan(filePath, type);
    this._fitCamera();
  }

  async addScan(filePath, type) {
    const geometry = await this._loadGeometry(filePath);
    geometry.computeVertexNormals();

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
      flatShading: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = type;
    mesh.visible = this.visibility[type] ?? true;
    this.meshes[type] = mesh;
    this.meshGroup.add(mesh);
    this.aligned = false;
  }

  async alignBite() {
    if (!this.meshes.upper || !this.meshes.lower || !this.meshes.bite) {
      throw new Error("Hizalama için üç tarama da gerekli");
    }

    const transforms = alignBiteRegistration({
      upper: { mesh: this.meshes.upper, geometry: this.meshes.upper.geometry },
      lower: { mesh: this.meshes.lower, geometry: this.meshes.lower.geometry },
      bite: { mesh: this.meshes.bite, geometry: this.meshes.bite.geometry },
    });

    this.aligned = true;
    this._fitCamera();
    return transforms;
  }

  setLowerJawOffset(mm) {
    if (!this.meshes.lower) return;
    this.meshes.lower.position.z = mm;
  }

  getMeshCount() {
    return Object.keys(this.meshes).length;
  }

  dispose() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this._clearMeshes();
    this.controls?.dispose();
    this.renderer.dispose();
  }
}
