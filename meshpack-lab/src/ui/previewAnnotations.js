import * as THREE from "three";
import { emptyAnnotations, parseAnnotations } from "../lib/annotations.js";

const MARKER_COLORS = ["#60a5fa", "#4ade80", "#fbbf24", "#f472b6", "#a78bfa", "#f87171"];
const SCAN_LABELS = { upper: "Üst", lower: "Alt", bite: "Kapanış" };

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
  sprite.renderOrder = 2;
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

/** Lab önizlemesi — salt okunur annotation pinleri */
export class PreviewAnnotations {
  constructor(viewer) {
    this.viewer = viewer;
    this.data = emptyAnnotations();
    this.unitScale = 1;
    this._sprites = new Map();
    this.onMarkerFocus = null;
  }

  setAnnotations(raw, unitScale = 1) {
    this.unitScale = unitScale || 1;
    this.data = parseAnnotations(raw);
    this.rebuild();
  }

  clear() {
    this.data = emptyAnnotations();
    this._clearSprites();
  }

  dispose() {
    this._clearSprites();
  }

  rebuild() {
    this._clearSprites();
    this.data.markers.forEach((marker, index) => {
      const mesh = this.viewer.meshes[marker.scanType];
      if (!mesh) return;
      const sprite = makeMarkerSprite(index + 1, markerSpriteScale(mesh));
      this._attachSprite(sprite, mesh, marker);
      mesh.add(sprite);
      this._sprites.set(marker.id, sprite);
    });
  }

  focusMarker(markerId) {
    const marker = this.data.markers.find((m) => m.id === markerId);
    const mesh = marker ? this.viewer.meshes[marker.scanType] : null;
    if (!marker || !mesh) return;
    const local = new THREE.Vector3(
      marker.position[0] * this.unitScale,
      marker.position[1] * this.unitScale,
      marker.position[2] * this.unitScale
    );
    const world = mesh.localToWorld(local.clone());
    this.viewer.focusPoint(world);
    this.onMarkerFocus?.(marker);
  }

  _attachSprite(sprite, mesh, marker) {
    const s = this.unitScale;
    const local = new THREE.Vector3(
      marker.position[0] * s,
      marker.position[1] * s,
      marker.position[2] * s
    );
    const localNormal = new THREE.Vector3(
      marker.normal[0],
      marker.normal[1],
      marker.normal[2]
    ).normalize();
    local.addScaledVector(localNormal, surfaceOffset(mesh));
    sprite.position.copy(local);
    sprite.userData.markerId = marker.id;
  }

  _clearSprites() {
    for (const sprite of this._sprites.values()) {
      sprite.parent?.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
    }
    this._sprites.clear();
  }
}

export function indexLabel(marker, markers) {
  const idx = markers.findIndex((m) => m.id === marker.id);
  return idx >= 0 ? idx + 1 : null;
}

export function scanTypeLabel(scanType) {
  return SCAN_LABELS[scanType] || scanType;
}
