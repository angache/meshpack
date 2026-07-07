import * as THREE from "three";

const SAMPLE_COUNT = 600;
const MAX_ITERATIONS = 40;
const CONVERGENCE_THRESHOLD = 1e-5;

/**
 * Geometriden eşit aralıklı nokta örnekleri alır.
 */
function samplePoints(geometry, count = SAMPLE_COUNT) {
  const pos = geometry.attributes.position;
  const points = [];
  const step = Math.max(1, Math.floor(pos.count / count));
  for (let i = 0; i < pos.count; i += step) {
    points.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  }
  return points;
}

/**
 * İki nokta kümesinin kütle merkezini hesaplar.
 */
function centroid(points) {
  const c = new THREE.Vector3();
  for (const p of points) c.add(p);
  return c.divideScalar(points.length);
}

/**
 * En yakın komşu araması (kaba kuvvet — örneklenmiş noktalar için yeterli).
 */
function nearestNeighbor(point, targetPoints) {
  let minDist = Infinity;
  let nearest = targetPoints[0];
  for (const tp of targetPoints) {
    const d = point.distanceToSquared(tp);
    if (d < minDist) {
      minDist = d;
      nearest = tp;
    }
  }
  return nearest;
}

/**
 * Kabsch algoritması: iki nokta kümesi arasında optimal rigid dönüşüm.
 */
function kabsch(source, target) {
  const srcCentroid = centroid(source);
  const tgtCentroid = centroid(target);

  const h = new THREE.Matrix3();
  const a = [];
  const b = [];

  for (let i = 0; i < source.length; i++) {
    a.push(source[i].clone().sub(srcCentroid));
    b.push(target[i].clone().sub(tgtCentroid));
  }

  const m = new THREE.Matrix3();
  for (let i = 0; i < a.length; i++) {
    m.elements[0] += a[i].x * b[i].x;
    m.elements[1] += a[i].x * b[i].y;
    m.elements[2] += a[i].x * b[i].z;
    m.elements[3] += a[i].y * b[i].x;
    m.elements[4] += a[i].y * b[i].y;
    m.elements[5] += a[i].y * b[i].z;
    m.elements[6] += a[i].z * b[i].x;
    m.elements[7] += a[i].z * b[i].y;
    m.elements[8] += a[i].z * b[i].z;
  }

  // SVD yerine basitleştirilmiş: cross-covariance üzerinden quaternion
  const matrix4 = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const translation = new THREE.Vector3();

  // THREE.js Matrix4.setFromMatrix3 ile rotasyon
  const cov = m;
  const det =
    cov.elements[0] * (cov.elements[4] * cov.elements[8] - cov.elements[5] * cov.elements[7]) -
    cov.elements[1] * (cov.elements[3] * cov.elements[8] - cov.elements[5] * cov.elements[6]) +
    cov.elements[2] * (cov.elements[3] * cov.elements[7] - cov.elements[4] * cov.elements[6]);

  if (Math.abs(det) < 1e-10) {
    return new THREE.Matrix4().identity();
  }

  // Polar decomposition yaklaşımı
  const rotMat = new THREE.Matrix4().set(
    cov.elements[0], cov.elements[1], cov.elements[2], 0,
    cov.elements[3], cov.elements[4], cov.elements[5], 0,
    cov.elements[6], cov.elements[7], cov.elements[8], 0,
    0, 0, 0, 1
  );

  rotation.setFromRotationMatrix(rotMat);
  const rot3 = new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().makeRotationFromQuaternion(rotation)
  );

  // Orthogonalize via Gram-Schmidt
  const col0 = new THREE.Vector3(rot3.elements[0], rot3.elements[3], rot3.elements[6]).normalize();
  const col1 = new THREE.Vector3(rot3.elements[1], rot3.elements[4], rot3.elements[7]);
  col1.sub(col0.clone().multiplyScalar(col1.dot(col0))).normalize();
  const col2 = new THREE.Vector3().crossVectors(col0, col1);

  matrix4.makeBasis(col0, col1, col2);
  translation.copy(tgtCentroid).sub(srcCentroid.clone().applyMatrix4(matrix4));

  matrix4.setPosition(translation);
  return matrix4;
}

/**
 * ICP: source geometriyi target'a hizalar, 4x4 dönüşüm matrisi döner.
 */
export function icpAlign(sourceGeometry, targetGeometry) {
  let srcPoints = samplePoints(sourceGeometry);
  const tgtPoints = samplePoints(targetGeometry);

  let cumulative = new THREE.Matrix4().identity();
  let prevError = Infinity;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const pairs = [];
    for (const sp of srcPoints) {
      const transformed = sp.clone().applyMatrix4(cumulative);
      const nearest = nearestNeighbor(transformed, tgtPoints);
      pairs.push({ source: sp, target: nearest });
    }

    let error = 0;
    const srcArr = [];
    const tgtArr = [];
    for (const { source, target } of pairs) {
      const transformed = source.clone().applyMatrix4(cumulative);
      error += transformed.distanceToSquared(target);
      srcArr.push(source);
      tgtArr.push(target);
    }
    error /= pairs.length;

    if (Math.abs(prevError - error) < CONVERGENCE_THRESHOLD) break;
    prevError = error;

    const delta = kabsch(
      srcArr.map((s) => s.clone().applyMatrix4(cumulative)),
      tgtArr
    );
    cumulative = delta.multiply(cumulative);

    srcPoints = samplePoints(sourceGeometry);
  }

  return cumulative;
}

/**
 * İki geometri arasındaki ortalama en yakın nokta mesafesi (kayıt kalitesi).
 */
export function measureRegistrationError(sourceGeometry, targetGeometry) {
  const srcPoints = samplePoints(sourceGeometry, 300);
  const tgtPoints = samplePoints(targetGeometry, 400);
  if (srcPoints.length === 0 || tgtPoints.length === 0) return Infinity;

  let total = 0;
  for (const sp of srcPoints) {
    total += sp.distanceTo(nearestNeighbor(sp, tgtPoints));
  }
  return total / srcPoints.length;
}

/**
 * Exocad benzeri 3 adımlı kapanış hizalama:
 * 1. Üst çene = referans (sabit)
 * 2. Kapanış taraması → üst çeneye hizala
 * 3. Alt çene → hizalanmış kapanışa hizala
 */
export function alignBiteRegistration(meshes) {
  const { upper, lower, bite } = meshes;
  const transforms = {
    upper: new THREE.Matrix4().identity(),
    bite: new THREE.Matrix4().identity(),
    lower: new THREE.Matrix4().identity(),
  };

  // Adım 1: Kapanış → Üst
  const biteToUpper = icpAlign(bite.geometry, upper.geometry);
  bite.mesh.applyMatrix4(biteToUpper);
  bite.geometry.applyMatrix4(biteToUpper);
  transforms.bite = biteToUpper.clone();

  // Adım 2: Alt → Kapanış (artık hizalanmış)
  const lowerToBite = icpAlign(lower.geometry, bite.geometry);
  lower.mesh.applyMatrix4(lowerToBite);
  lower.geometry.applyMatrix4(lowerToBite);
  transforms.lower = lowerToBite.clone();

  return transforms;
}

/**
 * Matrisi JSON-serileştirilebilir dizi olarak döner.
 */
export function matrixToArray(matrix) {
  return matrix.elements.slice();
}

export function identityTransformSet() {
  const id = matrixToArray(new THREE.Matrix4().identity());
  return { upper: id, bite: id, lower: id };
}

/** CasePackage alignment.json — lab önizlemesi ile aynı format */
export function buildAlignmentPackage(transforms, mode = "scanner") {
  const base = transforms || identityTransformSet();
  return {
    version: 1,
    mode,
    upper: base.upper,
    lower: base.lower,
    bite: base.bite,
  };
}

export function resolveAlignmentFromSession(scanSession) {
  if (scanSession?.alignment) return scanSession.alignment;
  if (scanSession?.transforms) {
    return buildAlignmentPackage(scanSession.transforms, scanSession.alignmentMode || "icp");
  }
  return buildAlignmentPackage(null, "scanner");
}
