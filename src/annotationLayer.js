import * as THREE from "three";
import { createMarker, emptyAnnotations, parseAnnotations } from "./annotations.js";

const MARKER_COLORS = ["#60a5fa", "#4ade80", "#fbbf24", "#f472b6", "#a78bfa", "#f87171"];

function makeMarkerSprite(index, scale) {
  const color = MARKER_COLORS[(index - 1) % MARKER_COLORS.length];
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 26px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(index), 32, 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: true,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 1;
  sprite.scale.set(scale, scale, 1);
  return sprite;
}

function surfaceOffset(mesh) {
  const radius = mesh.geometry.boundingSphere?.radius || 10;
  return Math.max(0.08, radius * 0.0015);
}

function markerSpriteScale(mesh) {
  const radius = mesh.geometry.boundingSphere?.radius || 10;
  return Math.max(1.2, radius * 0.045);
}

export class AnnotationLayer {
  /** @param {import('./viewer.js').MeshViewer} viewer */
  constructor(viewer) {
    this.viewer = viewer;
    this.data = emptyAnnotations();
    this.mode = false;
    this.onChange = null;
    /** @type {((hit: object) => void) | null} */
    this.onPlaceRequest = null;

    this._sprites = new Map();
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._pointerDown = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  setAnnotations(raw) {
    this.data = parseAnnotations(raw);
    this._rebuildSprites();
  }

  getAnnotations() {
    return this.data;
  }

  setMode(enabled) {
    this.mode = !!enabled;
    const canvas = this.viewer.canvas;
    if (!canvas) return;

    if (this.mode) {
      canvas.addEventListener("pointerdown", this._onPointerDown);
      canvas.addEventListener("pointerup", this._onPointerUp);
      canvas.classList.add("viewer-annotate-mode");
    } else {
      canvas.removeEventListener("pointerdown", this._onPointerDown);
      canvas.removeEventListener("pointerup", this._onPointerUp);
      canvas.classList.remove("viewer-annotate-mode");
    }
  }

  addMarker({ scanType, position, normal, text }) {
    const marker = createMarker({ scanType, position, normal, text });
    this.data.markers.push(marker);
    this._rebuildSprites();
    this.onChange?.(this.data);
    return marker;
  }

  updateMarker(id, text) {
    const marker = this.data.markers.find((m) => m.id === id);
    if (!marker) return null;
    marker.text = String(text || "").trim();
    this.onChange?.(this.data);
    return marker;
  }

  removeMarker(id) {
    this.data.markers = this.data.markers.filter((m) => m.id !== id);
    this._rebuildSprites();
    this.onChange?.(this.data);
  }

  /** Mesh child olarak eklendiği için genelde gerek yok; mesh yeniden yüklendiğinde çağrılır */
  syncPositions() {
    this._rebuildSprites();
  }

  refresh() {
    this._rebuildSprites();
  }

  clear() {
    this.data = emptyAnnotations();
    this._clearSprites();
  }

  dispose() {
    this.setMode(false);
    this._clearSprites();
  }

  _clearSprites() {
    for (const sprite of this._sprites.values()) {
      sprite.parent?.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    this._sprites.clear();
  }

  _rebuildSprites() {
    this._clearSprites();
    this.data.markers.forEach((marker, index) => {
      const mesh = this.viewer.meshes[marker.scanType];
      if (!mesh) return;
      const sprite = makeMarkerSprite(index + 1, markerSpriteScale(mesh));
      this._attachSpriteToMesh(sprite, mesh, marker);
      mesh.add(sprite);
      this._sprites.set(marker.id, sprite);
    });
  }

  /** Pin mesh yüzeyine yerel koordinatta yapışır — mesh hareket edince birlikte gider */
  _attachSpriteToMesh(sprite, mesh, marker) {
    const local = new THREE.Vector3(...marker.position);
    const localNormal = new THREE.Vector3(...marker.normal).normalize();
    local.addScaledVector(localNormal, surfaceOffset(mesh));
    sprite.position.copy(local);
  }

  _onPointerDown(e) {
    if (!this.mode || e.button !== 0) return;
    this._pointerDown = { x: e.clientX, y: e.clientY };
  }

  _onPointerUp(e) {
    if (!this.mode || !this._pointerDown || e.button !== 0) return;
    const dx = e.clientX - this._pointerDown.x;
    const dy = e.clientY - this._pointerDown.y;
    this._pointerDown = null;
    if (dx * dx + dy * dy > 36) return;

    const hit = this._raycast(e);
    if (!hit) return;
    this.onPlaceRequest?.(hit);
  }

  _raycast(event) {
    const canvas = this.viewer.canvas;
    const rect = canvas.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.viewer.camera);

    const targets = Object.values(this.viewer.meshes).filter((m) => m.visible);
    if (!targets.length) return null;

    const hits = this._raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;

    const hit = hits[0];
    const mesh = hit.object;
    const scanType = mesh.name;

    mesh.updateMatrixWorld(true);

    const localPoint = mesh.worldToLocal(hit.point.clone());
    // face.normal zaten mesh yerel uzayında
    const localNormal = hit.face.normal.clone().normalize();

    return {
      scanType,
      position: [localPoint.x, localPoint.y, localPoint.z],
      normal: [localNormal.x, localNormal.y, localNormal.z],
      mesh,
    };
  }
}
