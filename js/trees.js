// The forest, from the satellite forest map.
//
// A whole mountain of trees is far too many to draw, so 3D trees exist only
// within NEAR metres of the rider; further away the forest is painted on the
// ground. Tree positions come from a fixed pattern (a hash of each spot), so
// the same tree is always in the same place, and collisions match what you see.
import * as THREE from '../vendor/three.module.min.js';
import { QUALITY, LOW } from './gfx.js';

const SPACING = 7.5;     // metres between possible tree spots
const BLOCK = 10;        // tree spots per block side (blocks are 75 m squares)
const NEAR = 450;        // draw 3D trees this far around the rider
const MAX_TREES = QUALITY.maxTrees;
// Coast Mountain firs and hemlocks are tall and narrow: 16-33 m here.
// The model is ~10.7 m at scale 1, so it is stretched upward by TALL.
export const TALL = 2.2;

function hash(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// One conifer: a trunk and drooping tiers of boughs, dark underneath and
// snow-laden on top. Every tree is this shape, turned, stretched and tinted.
function treeGeometry() {
  const pos = [], col = [], idx = [];
  const SIDES = 6;
  const bark = [0.10, 0.065, 0.045], dark = [0.018, 0.042, 0.028], green = [0.06, 0.135, 0.065], snow = [0.80, 0.84, 0.90];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ring = (y, r, color, wobble, phase) => {
    const first = pos.length / 3;
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2 + phase;
      const w = 1 + wobble * Math.sin(k * 2.4 + phase * 5);       // uneven boughs
      pos.push(Math.cos(a) * r * w, y - wobble * r * 0.5 * Math.cos(k * 1.7 + phase), Math.sin(a) * r * w);
      col.push(...color);
    }
    return first;
  };
  const band = (a, b) => {
    for (let k = 0; k < SIDES; k++) {
      const k1 = (k + 1) % SIDES;
      idx.push(a + k, a + k1, b + k, a + k1, b + k1, b + k);
    }
  };
  band(ring(2.6, 0.2, bark, 0, 0), ring(0, 0.32, bark, 0, 0));
  const TIERS = LOW ? 5 : 7;
  for (let t = 0; t < TIERS; t++) {
    const f = t / (TIERS - 1);                    // 0 = lowest tier, 1 = top
    const y0 = 1.5 + f * 6.6, h = (3.4 - f * 0.9) * 5 / TIERS + 0.9, r = 2.35 - f * 1.6;
    const phase = t * 0.9;
    const apex = pos.length / 3;
    pos.push(0, y0 + h, 0); col.push(...snow);
    // Snow sits on the upper half of each tier; the drooping rim is dark needles.
    const mid = ring(y0 + h * 0.42, r * 0.55, mix(green, snow, 0.28 + f * 0.3), 0.12, phase);
    const rim = ring(y0, r, mix(dark, green, f * 0.5), 0.22, phase);
    for (let k = 0; k < SIDES; k++) idx.push(apex, mid + (k + 1) % SIDES, mid + k);
    band(mid, rim);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class TreeField {
  // keepClear(x, z) returns true where no tree may stand (buildings, jumps, the course line).
  constructor(terrain, scene, keepClear = () => false) {
    this.terrain = terrain;
    this.keepClear = keepClear;
    this.blocks = new Map();
    const geo = treeGeometry();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    // Trees at the edge of the drawn forest shrink away instead of popping in and out.
    mat.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 treeAt = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          transformed *= 1.0 - smoothstep(${(NEAR * 0.7).toFixed(1)}, ${(NEAR * 0.87).toFixed(1)}, distance(treeAt, cameraPosition));
        #endif`);
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_TREES);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false; // it always surrounds the camera
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
    // Only the nearest trees cast real-time shadows. This second mesh shares the
    // same trees but draws nothing itself: it exists just for the shadow pass.
    this.casters = new THREE.InstancedMesh(geo,
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), MAX_TREES);
    this.casters.instanceMatrix = this.mesh.instanceMatrix;
    this.casters.count = 0;
    this.casters.frustumCulled = false;
    this.casters.castShadow = true;
    scene.add(this.casters);
    this.centre = null;
  }

  // The tree at spot (i, j), or null.
  spot(i, j) {
    const T = this.terrain;
    const x = (i + 0.5 + (hash(i, j, 1) - 0.5) * 0.8) * SPACING;
    const z = (j + 0.5 + (hash(i, j, 2) - 0.5) * 0.8) * SPACING;
    if (x < 0 || z < 0 || x > T.sizeX || z > T.sizeZ) return null;
    const d = T.forestAt(x, z);
    if (d < 0.05 || hash(i, j, 3) > d * 0.9) return null;
    if (this.keepClear(x, z)) return null;
    const scale = 0.7 + hash(i, j, 4) * 0.7;
    return { x, z, y: T.terrainHeight(x, z), scale, yaw: hash(i, j, 5) * Math.PI * 2 };
  }

  block(bi, bj) {
    const key = bi * 100000 + bj;
    let list = this.blocks.get(key);
    if (!list) {
      list = [];
      for (let j = bj * BLOCK; j < (bj + 1) * BLOCK; j++) {
        for (let i = bi * BLOCK; i < (bi + 1) * BLOCK; i++) {
          const t = this.spot(i, j);
          if (t) list.push(t);
        }
      }
      this.blocks.set(key, list);
    }
    return list;
  }

  // Rebuild the drawn trees when the rider moves into a new block.
  update(x, z) {
    const size = SPACING * BLOCK;
    const bi = Math.floor(x / size), bj = Math.floor(z / size);
    if (this.centre && this.centre[0] === bi && this.centre[1] === bj) return;
    this.centre = [bi, bj];
    const r = Math.ceil(NEAR / size);
    const order = [];
    for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) {
      const d2 = a * a + b * b;
      if (d2 <= r * r) order.push([d2, bi + a, bj + b]);
    }
    order.sort((p, q) => p[0] - q[0]); // nearest first, in case we hit the limit
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3(), s = new THREE.Vector3();
    const tint = new THREE.Color();
    const castRange = Math.ceil((QUALITY.shadowReach + 40) / size) + 0.5;
    let n = 0, casting = 0;
    for (const [d2, a, b] of order) {
      for (const t of this.block(a, b)) {
        if (n >= MAX_TREES) break;
        q.setFromAxisAngle(up, t.yaw);
        m.compose(v.set(t.x, t.y - 0.3, t.z), q, s.set(t.scale, t.scale * TALL, t.scale));
        this.mesh.setMatrixAt(n, m);
        // Each tree a slightly different green (the tint is fixed per tree).
        const k = 0.72 + (t.yaw * 7.3 % 1) * 0.5;
        this.mesh.setColorAt(n++, tint.setRGB(k * (0.9 + t.scale * 0.1), k, k * (1.12 - t.scale * 0.12)));
      }
      if (d2 <= castRange * castRange) casting = n; // nearest blocks come first
    }
    this.mesh.count = n;
    this.casters.count = casting;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  // Trees close enough to bump into.
  near(x, z) {
    const out = [];
    const ci = Math.floor(x / SPACING), cj = Math.floor(z / SPACING);
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) {
      const t = this.spot(ci + a, cj + b);
      if (t) out.push(t);
    }
    return out;
  }
}
