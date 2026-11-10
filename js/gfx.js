// How the mountain looks: sunlight and shadows, the sky, the snow surface,
// and the track your board leaves. Nothing here changes how the game plays.
//
// The main ideas, in plain words:
//  - The sun sits in one fixed place (SUN). When the mountain loads we work out,
//    for every 6 m patch of ground, whether a ridge or the forest blocks the sun
//    there. That "baked" shadow map costs nothing while you ride.
//  - Close to the rider, a real-time shadow map adds crisp shadows for the rider,
//    trees, lift towers and buildings.
//  - Far forest is painted on the ground; near forest is 3D trees on shaded snow.
//  - Distance haze (fog) lets you see right across the valley.
import * as THREE from '../vendor/three.module.min.js';

// ---------- Quality ----------
// Phones get a lighter version. Force one with ?gfx=low or ?gfx=high in the address.
const want = new URLSearchParams(location.search).get('gfx');
const phone = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
export const LOW = want ? want === 'low' : phone;
export const QUALITY = LOW
  ? { pixelRatio: 1.5, viewDistance: 6000, haze: 0.00026, shadowSize: 1024, shadowReach: 60, maxTrees: 9000 }
  : { pixelRatio: 2, viewDistance: 14000, haze: 0.00013, shadowSize: 2048, shadowReach: 95, maxTrees: 14000 };

// ---------- The sun ----------
// Direction towards the sun. x = east, y = up, z = south: a mid-morning winter
// sun in the south-east, low enough for long shadows.
export const SUN = new THREE.Vector3(0.66, 0.5, 0.56).normalize();
export const HAZE = new THREE.Color(0xb9d2ea);       // colour of distant air (and the horizon)
const CANOPY = 24;                                   // metres: how tall the forest is for shadows

// ---------- Noise ----------
// A small repeating texture of smooth random blotches, used for snow grain,
// wind drifts, rock, and clouds. Each colour channel is a different pattern.
function noiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const lattice = (period, seed) => {
    const v = new Float32Array(period * period);
    let a = seed >>> 0;
    for (let i = 0; i < v.length; i++) {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      v[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return v;
  };
  for (let c = 0; c < 4; c++) {
    const acc = new Float32Array(size * size);
    let amp = 0.5, total = 0;
    // The fourth channel is fine grain only; the others are soft blotches.
    for (const period of (c === 3 ? [32, 64, 128] : [4, 8, 16, 32, 64])) {
      const L = lattice(period, 1000 * c + period);
      const k = period / size;
      for (let y = 0; y < size; y++) {
        const gy = y * k, j = Math.floor(gy), fy = gy - j, sy = fy * fy * (3 - 2 * fy);
        const j1 = (j + 1) % period;
        for (let x = 0; x < size; x++) {
          const gx = x * k, i = Math.floor(gx), fx = gx - i, sx = fx * fx * (3 - 2 * fx);
          const i1 = (i + 1) % period;
          const a = L[j * period + i] + (L[j * period + i1] - L[j * period + i]) * sx;
          const b = L[j1 * period + i] + (L[j1 * period + i1] - L[j1 * period + i]) * sx;
          acc[y * size + x] += (a + (b - a) * sy) * amp;
        }
      }
      total += amp; if (c < 3) amp *= 0.5;
    }
    for (let i = 0; i < acc.length; i++) data[i * 4 + c] = Math.max(0, Math.min(255, (acc[i] / total - 0.5) * 1.7 * 255 + 128));
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
let _noise = null;
const noise = () => (_noise ||= noiseTexture());

// ---------- Sky ----------
// A dome around the camera: blue overhead fading to pale haze at the horizon,
// the sun with its glow, thin drifting cloud, and far-off ranges.
export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      sunDir: { value: SUN }, haze: { value: HAZE }, noiseMap: { value: noise() }, time: { value: 0 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 sunDir; uniform vec3 haze; uniform sampler2D noiseMap; uniform float time;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float up = max(d.y, 0.0);
        float sd = max(dot(d, sunDir), 0.0);
        // Blue deepens overhead and away from the sun.
        vec3 zenith = mix(vec3(0.07, 0.22, 0.58), vec3(0.13, 0.32, 0.68), sd);
        vec3 col = mix(haze, zenith, pow(up, 0.55));
        // Sun: wide warm glow, tight glow, then the disc itself.
        col += vec3(1.0, 0.86, 0.66) * (pow(sd, 6.0) * 0.10 + pow(sd, 60.0) * 0.25 + pow(sd, 900.0) * 1.2);
        col += vec3(1.0, 0.97, 0.90) * smoothstep(0.99955, 0.9998, sd) * 30.0;
        // High thin cloud, drifting slowly.
        vec2 p = d.xz / (up + 0.22);
        float c = texture2D(noiseMap, p * 0.11 + vec2(time * 0.0016, 0.0)).r * 0.65
                + texture2D(noiseMap, p * 0.31 - vec2(0.0, time * 0.0022)).g * 0.35;
        float cloud = smoothstep(0.50, 0.80, c) * smoothstep(0.03, 0.30, d.y) * 0.75;
        vec3 cloudCol = mix(vec3(0.80, 0.86, 0.95), vec3(1.0, 0.98, 0.94), smoothstep(0.55, 0.9, c) * 0.5 + pow(sd, 4.0) * 0.5);
        col = mix(col, cloudCol, cloud);
        // Two layers of distant ranges on the horizon, paler the further away.
        float az = atan(d.z, d.x) / 6.2831853;
        float r1 = 0.004 + 0.034 * texture2D(noiseMap, vec2(az * 3.0, 0.31)).b + 0.012 * texture2D(noiseMap, vec2(az * 13.0, 0.77)).r;
        float r2 = 0.0 + 0.022 * texture2D(noiseMap, vec2(az * 5.0, 0.63)).g + 0.009 * texture2D(noiseMap, vec2(az * 17.0, 0.12)).b;
        r1 += 0.012 * abs(texture2D(noiseMap, vec2(az * 41.0, 0.45)).g - 0.5);   // jagged tops
        r2 += 0.010 * abs(texture2D(noiseMap, vec2(az * 53.0, 0.85)).r - 0.5);
        // Blue silhouettes, a little paler towards their tops.
        vec3 far = mix(vec3(0.26, 0.37, 0.54), vec3(0.42, 0.53, 0.70), smoothstep(r1 - 0.03, r1, d.y));
        col = mix(col, mix(far, haze, 0.55), smoothstep(r1 + 0.001, r1 - 0.001, d.y));
        vec3 near = mix(vec3(0.15, 0.24, 0.38), vec3(0.28, 0.38, 0.54), smoothstep(r2 - 0.02, r2, d.y));
        col = mix(col, mix(near, haze, 0.40), smoothstep(r2 + 0.001, r2 - 0.001, d.y));
        // Below the horizon: valley haze.
        col = mix(col, mix(vec3(0.15, 0.24, 0.38), haze, 0.62), smoothstep(0.004, -0.03, d.y));
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

// ---------- Baking the mountain's light ----------
// Two whole-mountain textures at the forest map's detail (about 6 m):
//   A: red = bare rock (steep ground), green = forest
//   B: red/green = which way the ground faces, blue = sun reaches here (0 = shadow),
//      alpha = how much open sky the spot sees (gullies and forest floor are darker)
function bakeGround(terrain) {
  const fw = terrain.fw || terrain.W * 2, fh = terrain.fh || terrain.H * 2;
  const step = terrain.cell / 2, n = fw * fh;
  const forest = terrain.forest;
  const H = new Float32Array(n), O = new Float32Array(n);
  for (let j = 0; j < fh; j++) {
    for (let i = 0; i < fw; i++) {
      const k = j * fw + i;
      const h = terrain.smoothHeight((i + 0.5) * step, (j + 0.5) * step);
      const f = forest ? forest[k] / 255 : 0;
      H[k] = h; O[k] = h + f * f * CANOPY;
    }
  }
  const A = new Uint8Array(n * 4), B = new Uint8Array(n * 4);
  // Sun: walk from each spot towards the sun; if anything rises above the sun's
  // angle, the spot is in shadow. Steps get longer with distance (out to ~2 km).
  const hl = Math.hypot(SUN.x, SUN.z), sx = SUN.x / hl, sz = SUN.z / hl, tanSun = SUN.y / hl;
  const D = [1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36, 48, 64, 85, 113, 150, 200, 266, 354];
  const sunOff = D.map(d => {
    const ox = Math.round(sx * d), oz = Math.round(sz * d);
    return [ox, oz, 1 / (Math.hypot(ox, oz) * step), d];
  });
  // Sky: look a short, medium and long way in six directions.
  const skyOff = [];
  for (let a = 0; a < 6; a++) {
    const ang = a / 6 * Math.PI * 2 + 0.3;
    skyOff.push([2, 6, 16].map(d => [Math.round(Math.cos(ang) * d), Math.round(Math.sin(ang) * d), 1 / (d * step)]));
  }
  for (let j = 0; j < fh; j++) {
    for (let i = 0; i < fw; i++) {
      const k = j * fw + i, h0 = H[k];
      // Which way the ground faces, from heights one grid cell either side.
      const il = Math.max(0, i - 2), ir = Math.min(fw - 1, i + 2), ju = Math.max(0, j - 2), jd = Math.min(fh - 1, j + 2);
      let nx = H[j * fw + il] - H[j * fw + ir], nz = H[ju * fw + i] - H[jd * fw + i];
      const ny = (ir - il + jd - ju) / 2 * step, len = Math.hypot(nx, ny, nz);
      const rise = -(nx * sx + nz * sz) / ny;   // how steeply the ground climbs towards the sun
      nx /= len; nz /= len;
      let maxS = -1e9;
      for (let s = 0; s < sunOff.length; s++) {
        const o = sunOff[s], x = i + o[0], z = j + o[1];
        if (x < 0 || z < 0 || x >= fw || z >= fh) break;
        const q = z * fw + x;
        // Right next to the spot only trees count (the slope itself is handled by
        // ordinary shading); further out, the real shape of the mountain.
        const sl = o[3] < 4 ? rise + (O[q] - H[q]) * o[2] : (O[q] - h0) * o[2];
        if (sl > maxS) maxS = sl;
      }
      const vis = Math.max(0, Math.min(1, (tanSun - maxS) / 0.2 + 0.5));
      let occ = 0;
      for (let a = 0; a < 6; a++) {
        let m = 0;
        for (let s = 0; s < 3; s++) {
          const o = skyOff[a][s];
          const x = Math.min(fw - 1, Math.max(0, i + o[0])), z = Math.min(fh - 1, Math.max(0, j + o[1]));
          const sl = (O[z * fw + x] - h0) * o[2];
          if (sl > m) m = sl;
        }
        occ += m;
      }
      const ao = 1 / (1 + occ / 6 * 1.6);
      const slope = Math.acos(Math.min(1, ny / len)) * 180 / Math.PI;
      const f = forest ? forest[k] / 255 : 0;
      const rock = Math.max(0, Math.min(1, (slope - 31) / 13)) * (1 - f);
            A[k * 4] = rock * 255; A[k * 4 + 1] = f * 255; A[k * 4 + 2] = 0; A[k * 4 + 3] = 255;
      B[k * 4] = nx * 127.5 + 127.5; B[k * 4 + 1] = nz * 127.5 + 127.5; B[k * 4 + 2] = vis * 255; B[k * 4 + 3] = ao * 255;
    }
  }
  const tex = d => {
    const t = new THREE.DataTexture(d, fw, fh, THREE.RGBAFormat);
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  };
  return { a: tex(A), b: tex(B), size: new THREE.Vector2(fw * step, fh * step) };
}

// ---------- The ground ----------
// Snow, rock and far forest, lit by the sun with the baked shadows.
export function groundMaterial(terrain) {
  const baked = bakeGround(terrain);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, {
      gA: { value: baked.a }, gB: { value: baked.b }, gSize: { value: baked.size },
      gNoise: { value: noise() }, gSun: { value: SUN },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D gA; uniform sampler2D gB; uniform sampler2D gNoise;
        uniform vec2 gSize; uniform vec3 gSun;
        varying vec3 vW;`)
      .replace('#include <map_fragment>', `
        vec2 gUv = vW.xz / gSize;
        vec4 gMask = texture2D(gA, gUv);
        vec4 gLight = texture2D(gB, gUv);
        float gDist = length(vW - cameraPosition);
        float gFine = texture2D(gNoise, vW.xz / 6.0).a;      // snow grain
        float gMid = texture2D(gNoise, vW.xz / 70.0).g;      // wind drifts
        float gBig = texture2D(gNoise, vW.xz / 900.0).b;     // slow change across a slope
        // 3D trees stand near the camera; beyond them the forest is painted on.
        float gNearK0 = 1.0 - smoothstep(25.0, 120.0, gDist);
        float gFar = smoothstep(300.0, 390.0, gDist);
        // Thin forest near the treeline breaks into clumps rather than a grey wash.
        float gClump = texture2D(gNoise, vW.xz / 45.0).r;
        float gForest = smoothstep(0.30, 0.55, gMask.g + (gClump - 0.5) * 0.55) * gFar;
        float gRock = smoothstep(0.30, 0.62, gMask.r + (gMid - 0.5) * 0.7 + (gFine - 0.5) * 0.25);
        vec3 gSnow = vec3(0.91, 0.93, 0.96) * (0.94 + 0.04 * gBig + 0.02 * gMid + 0.03 * gFine * gNearK0);
        vec3 gStone = mix(vec3(0.10, 0.10, 0.11), vec3(0.30, 0.27, 0.24), gMid) * (0.65 + 0.7 * gFine);
        vec3 gTrees = mix(vec3(0.016, 0.038, 0.027), vec3(0.050, 0.082, 0.050), texture2D(gNoise, vW.xz / 17.0).g);
        gTrees = mix(gTrees, vec3(0.55, 0.60, 0.66), 0.05 + 0.14 * gBig);   // snow on the boughs
        diffuseColor.rgb = mix(mix(gSnow, gStone, gRock), gTrees, gForest);`)
      .replace('#include <normal_fragment_maps>', `
        // Far away, use the baked facing (sharper than the coarse far mesh).
        vec3 gN = vec3(gLight.r * 2.0 - 1.0, 0.0, gLight.g * 2.0 - 1.0);
        gN.y = sqrt(max(0.0, 1.0 - gN.x * gN.x - gN.z * gN.z));
        vec3 gWn = normalize(mix(inverseTransformDirection(normal, viewMatrix), gN, smoothstep(150.0, 450.0, gDist)));
        // Small bumps: snow grain up close, wind drifts further out.
        float gNearK = gNearK0;
        float gMidK = 1.0 - smoothstep(300.0, 1200.0, gDist);
        vec2 gBump = vec2(texture2D(gNoise, (vW.xz + vec2(0.03, 0.0)) / 6.0).a - gFine,
                          texture2D(gNoise, (vW.xz + vec2(0.0, 0.03)) / 6.0).a - gFine) * 0.55 * gNearK * (1.0 + 4.0 * gRock);
        gBump += vec2(texture2D(gNoise, (vW.xz + vec2(1.2, 0.0)) / 70.0).g - gMid,
                      texture2D(gNoise, (vW.xz + vec2(0.0, 1.2)) / 70.0).g - gMid) * 0.45 * gMidK * (1.0 - gForest);
        gWn = normalize(gWn - vec3(gBump.x, 0.0, gBump.y));
        normal = normalize((viewMatrix * vec4(gWn, 0.0)).xyz);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        // Baked shadows from ridges and forest; treetops in the far forest still catch the sun.
        float gSunVis = mix(gLight.b, max(gLight.b, 0.75), gForest);
        reflectedLight.directDiffuse *= gSunVis;
        reflectedLight.indirectDiffuse *= mix(0.45, 1.0, mix(gLight.a, 1.0, gForest * 0.6));
        // Sun glinting off snow: a soft sheen towards the sun, plus sparkles up close.
        vec3 gV = normalize(cameraPosition - vW);
        float gLit = dot(reflectedLight.directDiffuse, vec3(0.3333)) * (1.0 - gRock) * (1.0 - gForest);
        float gSpec = pow(max(dot(gWn, normalize(gSun + gV)), 0.0), 48.0);
        vec2 gCell = floor(vW.xz * 22.0);
        float gH = fract(sin(dot(gCell, vec2(127.1, 311.7))) * 43758.5453);
        float gTw = fract(gH * 31.0 + dot(gV, vec3(7.0, 5.0, 9.0)));
        float gGlint = step(0.93, gH) * smoothstep(0.80, 1.0, gTw) * (1.0 - smoothstep(6.0, 45.0, gDist));
        totalEmissiveRadiance += vec3(1.0, 0.96, 0.9) * gLit * (gSpec * 0.55 + gGlint * 1.6);`);
  };
  return mat;
}

// ---------- Lights and real-time shadows ----------
export function makeLights(scene, renderer) {
  // Sky light is blue, so shadows on snow are blue; snow bounces light back up.
  const skyLight = new THREE.HemisphereLight(0x8fb8ff, 0xd9e2f0, 1.75);
  scene.add(skyLight);
  const sun = new THREE.DirectionalLight(0xfff0d8, 5.2);
  sun.castShadow = true;
  const R = QUALITY.shadowReach, s = sun.shadow;
  s.mapSize.set(QUALITY.shadowSize, QUALITY.shadowSize);
  Object.assign(s.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 800 });
  s.camera.updateProjectionMatrix();
  s.bias = -0.0003; s.normalBias = 0.06;
  scene.add(sun, sun.target);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Keep the shadow map centred on the rider. It moves in whole-pixel steps so
  // shadow edges don't shimmer as you ride.
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), SUN).normalize();
  const up = new THREE.Vector3().crossVectors(SUN, right).normalize();
  const texel = 2 * R / QUALITY.shadowSize, c = new THREE.Vector3();
  function follow(p) {
    const a = Math.round(p.dot(right) / texel) * texel, b = Math.round(p.dot(up) / texel) * texel;
    c.copy(SUN).multiplyScalar(p.dot(SUN)).addScaledVector(right, a).addScaledVector(up, b);
    sun.target.position.copy(c);
    sun.position.copy(c).addScaledVector(SUN, 400);
    sun.target.updateMatrixWorld();
  }
  return { sun, skyLight, follow };
}

// Everything solid in a group casts and receives shadows.
export function shadows(root, cast = true, receive = true) {
  root.traverse(o => {
    if (!o.isMesh || (o.material && o.material.transparent)) return;
    o.castShadow = cast; o.receiveShadow = receive;
  });
}

// ---------- Snow spray ----------
// Soft puffs that grow and fade as they fly.
export class Spray {
  constructor(scene, count = 500) {
    this.n = count;
    this.pos = new Float32Array(count * 3).fill(-1e5);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);        // 1 = just thrown, 0 = gone
    this.rate = new Float32Array(count).fill(1);
    this.next = 0; this.acc = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('life', new THREE.BufferAttribute(this.life, 1));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        attribute float life; uniform float scale; varying float vLife;
        void main() {
          vLife = life;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = scale * (0.25 + 0.75 * (1.0 - life)) / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vLife;
        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = (1.0 - smoothstep(0.1, 1.0, r)) * smoothstep(0.0, 0.5, vLife) * 0.42;
          gl_FragColor = vec4(vec3(1.3, 1.35, 1.45), a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  setSize(h) { this.points.material.uniforms.scale.value = h * 0.5; }
  emit(p, v, amount, dt) {
    this.acc += amount * 320 * dt;
    while (this.acc > 1) {
      this.acc--;
      const i = this.next = (this.next + 1) % this.n;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.8;
      this.pos[i * 3 + 1] = p.y + 0.1;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.8;
      this.vel[i * 3] = v.x * 0.4 + (Math.random() - 0.5) * 3.2;
      this.vel[i * 3 + 1] = 1.2 + Math.random() * 2.6;
      this.vel[i * 3 + 2] = v.z * 0.4 + (Math.random() - 0.5) * 3.2;
      this.life[i] = 1;
      this.rate[i] = 1 / (0.5 + Math.random() * 0.6);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * this.rate[i];
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -1e5; continue; }
      const drag = Math.exp(-1.6 * dt);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.vel[i * 3 + 1] -= 5 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.life.needsUpdate = true;
  }
}

// ---------- Board track ----------
// A ribbon pressed into the snow behind the board. The newest piece is at the
// end of the list; older pieces fade out.
export class Trail {
  constructor(scene, terrain, pieces = 500) {
    this.terrain = terrain; this.n = pieces;
    this.pos = new Float32Array(pieces * 2 * 3);
    this.col = new Float32Array(pieces * 2 * 4);
    this.on = new Float32Array(pieces);          // 0 where the track is broken (in the air)
    this.last = new THREE.Vector3(1e9, 0, 0);
    const idx = [];
    for (let i = 0; i < pieces - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  clear() { this.on.fill(0); this.last.set(1e9, 0, 0); this.paint(); }
  // Call every frame: p = rider position, v = velocity, down = board is on the snow.
  add(p, v, down, carve) {
    const hs = Math.hypot(v.x, v.z);
    const far = this.last.distanceToSquared(p);
    if (!down || hs < 0.8) { if (this.on[this.n - 1]) this.push(p, 0, 1, 0, 0); return; }
    if (far < 0.3 * 0.3) return;
    // Carving on edge leaves a narrow trench; riding flat leaves a board-wide track.
    this.push(p, -v.z / hs, v.x / hs, 0.12 - 0.06 * Math.min(1, carve), far > 9 ? 0 : 1);
  }
  push(p, sx, sz, half, on) {
    const T = this.terrain, n = this.n;
    this.pos.copyWithin(0, 6); this.on.copyWithin(0, 1);
    const o = (n - 1) * 6;
    for (let k = 0; k < 2; k++) {
      const s = k ? half : -half, x = p.x + sx * s, z = p.z + sz * s;
      this.pos[o + k * 3] = x; this.pos[o + k * 3 + 1] = T.groundHeight(x, z) + 0.035; this.pos[o + k * 3 + 2] = z;
    }
    this.on[n - 1] = on;
    this.last.copy(p);
    this.paint();
  }
  paint() {
    const n = this.n, c = this.col;
    for (let i = 0; i < n; i++) {
      // A piece is drawn only if both its ends are on the snow.
      const a = this.on[i] * (i + 1 < n ? this.on[i + 1] || this.on[i] : 1) * Math.min(1, i / (n * 0.6)) * 0.24;
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 4;
        c[o] = 0.10; c[o + 1] = 0.15; c[o + 2] = 0.28; c[o + 3] = this.on[i] ? a : 0;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}
