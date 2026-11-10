// Wires everything together: scene, camera, controls, the game loop and the HUD.
import * as THREE from '../vendor/three.module.min.js';
import { loadTerrain } from './terrain.js';
import { buildCourse } from './course.js';
import { Rider } from './rider.js';
import { Sound } from './audio.js';
import { COLORS, BOARDS, loadOutfit, saveOutfit } from './outfit.js';
import { QUALITY, HAZE, makeSky, makeLights, groundMaterial, shadows, Spray, Trail } from './gfx.js';

// Pick a run with #peak-to-creek or ?course=peak-to-creek; free ride by default.
const COURSE_ID = location.hash.slice(1) || new URLSearchParams(location.search).get('course') || 'freeride';
const $ = id => document.getElementById(id);

// ---------- Renderer, scene, camera ----------
// The look of everything (sun, shadows, sky, snow) is set up in gfx.js.
const renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY.pixelRatio));
// Film-like response to bright light: sunlit snow stays detailed instead of going flat white.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const scene = new THREE.Scene();
scene.background = HAZE;
// Thin haze: far slopes fade to blue-grey, as they do on a clear day.
scene.fog = new THREE.FogExp2(HAZE, QUALITY.haze);
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, QUALITY.viewDistance);
const lights = makeLights(scene, renderer);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (spray) spray.setSize(h * renderer.getPixelRatio());
}
window.addEventListener('resize', resize);

const sky = makeSky();
scene.add(sky);

// ---------- Controls ----------
const keys = new Set();
const touch = { left: false, right: false, jump: false, brake: false, tuck: false };
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'tuck', KeyW: 'tuck', ArrowDown: 'brake', KeyS: 'brake', Space: 'jump',
};
window.addEventListener('keydown', e => {
  if (KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); }
  if (e.code === 'KeyR') restart();
  if (e.code === 'Escape') { if (game.state === 'intro' && game.resumeState) resume(); else openMenu(); }
  if (e.code === 'KeyL' || (e.code === 'KeyE')) boardLift();
  if (e.code === 'Space' && game.state === 'riding') skipRide();
  if (e.code === 'Enter' && (game.state === 'intro' || game.state === 'finished')) begin();
});
window.addEventListener('keyup', e => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });
window.addEventListener('blur', () => keys.clear());
document.querySelectorAll('[data-touch]').forEach(btn => {
  const k = btn.dataset.touch;
  const on = e => { touch[k] = true; btn.classList.add('down'); e.preventDefault(); };
  const off = e => { touch[k] = false; btn.classList.remove('down'); e.preventDefault(); };
  btn.addEventListener('pointerdown', on);
  btn.addEventListener('pointerup', off);
  btn.addEventListener('pointercancel', off);
  btn.addEventListener('pointerleave', off);
});
function readInput() {
  const held = k => keys.has(k) || touch[k];
  return {
    steer: (held('right') ? 1 : 0) - (held('left') ? 1 : 0),
    jump: held('jump'),
    brake: held('brake') || game.state === 'finished',
    tuck: held('tuck'),
  };
}

// ---------- Game state ----------
const sound = new Sound();
const game = { state: 'loading', time: 0, stars: 0, routeIndex: 0, toastTimer: 0, spawn: 0,
  gnar: 0, combo: 1, lastTrick: -99, resumeState: null };
let terrain, course, rider, spray, trail;
resize();

function fmtTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

// Put the rider at (x, z) facing downhill, first stepping downhill until clear
// of lift stations and buildings (many drop-in spots are at a lift's top).
function placeClear(x, z) {
  const blocked = () => course.lifts.keepClear.some(k => (k.x - x) ** 2 + (k.z - z) ** 2 < (k.r + 9) ** 2)
    || course.buildings.hit(x, z, terrain.terrainHeight(x, z), 6);
  for (let i = 0; i < 25 && blocked(); i++) {
    const n = terrain.normalAt(x, z), d = Math.hypot(n.x, n.z) || 1;
    x += (n.x / d) * 4; z += (n.z / d) * 4;
  }
  const n = terrain.normalAt(x, z), d = Math.hypot(n.x, n.z) || 1;
  rider.place(x, z, n.x / d || 0, n.z / d || 1, 0);
}

function restart() {
  if (!course) return;
  ride = null;
  rider.seated = false;
  course.lifts.carry(null);
  $('lift-skip').hidden = true;
  if (game.state === 'riding') game.state = 'playing';
  if (course.route) {
    const s = course.route.at(0), a = course.route.at(25);
    const dx = a.x - s.x, dz = a.z - s.z, d = Math.hypot(dx, dz);
    rider.place(s.x, s.z, dx / d, dz / d, 0);
  } else {
    // Free ride: drop in at the chosen spot, facing downhill.
    const sp = course.spawns[game.spawn] || course.spawns[0];
    placeClear(sp.x, sp.z);
  }
  resetStarMatrices();
  game.stars = 0; game.time = 0; game.routeIndex = 0;
  game.gnar = 0; game.combo = 1; game.lastTrick = -99;
  rider.events.length = 0;
  havePrev = false;
  trail.clear();
  $('finish').hidden = true;
  if (game.state === 'finished') game.state = 'playing';
  snapCamera();
}

// Main menu: pauses the game. Resume carries on; Drop in starts the run over.
function openMenu() {
  if (game.state === 'intro' || game.state === 'loading') return;
  if (game.state === 'locker') { openLocker(false); return; }
  game.resumeState = game.state === 'finished' ? null : game.state;
  game.state = 'intro';
  $('finish').hidden = true;
  $('intro').hidden = false;
  $('resume').hidden = !game.resumeState;
  $('drop').textContent = 'Restart run';
  game.restartOnDrop = true;
  keys.clear();
}
function resume() {
  $('intro').hidden = true;
  game.state = game.resumeState || 'playing';
  game.resumeState = null;
  last = performance.now();
}

function begin() {
  if (game.restartOnDrop) {
    // Coming from the main menu: start the run over.
    game.restartOnDrop = false;
    game.resumeState = null;
    restart();
  }
  $('resume').hidden = true;
  sound.start();
  document.activeElement?.blur();
  $('intro').hidden = true;
  $('locker').hidden = true;
  if (game.state === 'finished') restart();
  game.state = 'playing';
}

// ---------- Camera ----------
const camDir = new THREE.Vector3(0, 0, 1);
const camTarget = new THREE.Vector3();
function snapCamera() {
  rider.forward(camDir);
  updateCamera(1, true);
}
// On a chairlift: a three-quarter view from behind and to the side, so you see
// the rider sitting with the board hanging, and the lift line ahead.
function chairCamera(dt) {
  const p = rider.p, d = ride.lift.dir;
  // beside the chair, slightly ahead, looking back across at the rider and up the line
  const want = new THREE.Vector3(p.x + d.x * 1.2 + d.z * 4.6, p.y + 1.0, p.z + d.z * 1.2 - d.x * 4.6);
  camera.position.copy(want); // locked to the chair, which moves smoothly anyway
  camera.lookAt(p.x + d.x * 1.5, p.y + 0.3, p.z + d.z * 1.5);
  if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
  sky.position.copy(camera.position);
}

// In the locker, look at the rider from the front so you can see the outfit.
function lockerCamera(t) {
  const p = rider.p, f = rider.forward();
  const ang = Math.sin(t * 0.4) * 0.5;               // slow sway
  const side = new THREE.Vector3(-f.z, 0, f.x);      // the rider's toe side
  const goofy = rider.outfit.stance === 'goofy' ? -1 : 1;
  const dir = side.multiplyScalar(goofy).applyAxisAngle(_yAxis, ang);
  camera.position.set(p.x + dir.x * 3.6, p.y + 1.6, p.z + dir.z * 3.6);
  camera.lookAt(p.x, p.y + 0.9, p.z);
  // Shift the picture so the rider sits in the space the panel leaves free:
  // to the right of it on wide screens, above it when it's a bottom sheet.
  const w = window.innerWidth, h = window.innerHeight;
  if (w > 560) camera.setViewOffset(w, h, -w * 0.24, 0, w, h);
  else camera.setViewOffset(w, h, 0, h * 0.22, w, h);
  camera.fov = 50;
  camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
}
function updateCamera(dt, snap = false) {
  if (camera.view && camera.view.enabled) camera.clearViewOffset();
  if (ride && ride.lift.type !== 'gondola') { chairCamera(dt); return; }
  const p = rider.p, v = rider.v;
  const hs = Math.hypot(v.x, v.z);
  // On a lift, look up the lift line; otherwise follow the direction of travel.
  const want = ride ? new THREE.Vector3(ride.lift.dir.x, 0, ride.lift.dir.z)
    : hs > 2 ? new THREE.Vector3(v.x / hs, 0, v.z / hs) : rider.forward();
  camDir.lerp(want, snap ? 1 : 1 - Math.exp(-2.5 * dt)).normalize();
  const speed = v.length();
  const dist = 6.5 + Math.min(speed, 40) * 0.06;
  const height = 2.4 + Math.min(speed, 40) * 0.025;
  const desired = new THREE.Vector3(p.x - camDir.x * dist, p.y + height, p.z - camDir.z * dist);
  const floor = terrain.groundHeight(desired.x, desired.z) + 1.4;
  if (desired.y < floor) desired.y = floor;
  if (snap) camera.position.copy(desired);
  else camera.position.lerp(desired, 1 - Math.exp(-7 * dt));
  const gMin = terrain.groundHeight(camera.position.x, camera.position.z) + 1.0;
  if (camera.position.y < gMin) camera.position.y = gMin;
  camTarget.set(p.x + camDir.x * 5, p.y + 1.1, p.z + camDir.z * 5);
  camera.lookAt(camTarget);
  // A narrow lens keeps slopes looking as steep as they are; a wide one flattens them.
  const fov = 55 + Math.min(10, speed * 0.25);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  sky.position.copy(camera.position);
}

// ---------- Stars ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
// Where the rider's body was last frame. Stars are collected anywhere along the
// path between then and now, so fast riders on slow phones don't skip past them.
const bodyNow = new THREE.Vector3(), bodyPrev = new THREE.Vector3();
let havePrev = false;
const STAR_REACH = 2.5;
function distToPath(st, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((st.x - a.x) * abx + (st.y - a.y) * aby + (st.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + abx * t - st.x, a.y + aby * t - st.y, a.z + abz * t - st.z);
}
// Stars are sorted into 100 m squares so each frame only the ones near the
// rider are checked and animated; the rest keep their last position.
let starGrid = null;
function starsNear(x, z, r) {
  if (!starGrid) {
    starGrid = new Map();
    course.stars.forEach((st, i) => {
      st.i = i;
      const k = `${Math.floor(st.x / 100)},${Math.floor(st.z / 100)}`;
      if (!starGrid.has(k)) starGrid.set(k, []);
      starGrid.get(k).push(st);
    });
  }
  const out = [], n = Math.ceil(r / 100), ci = Math.floor(x / 100), cj = Math.floor(z / 100);
  for (let b = -n; b <= n; b++) for (let a = -n; a <= n; a++) {
    const list = starGrid.get(`${ci + a},${cj + b}`);
    if (list) out.push(...list);
  }
  return out;
}
function resetStarMatrices() {
  course.stars.forEach(st => { st.got = -1; });
}
// Stars are packed into the first slots of the instanced mesh each frame;
// collected ones are left out.
// On a course every star is drawn (a few hundred); free ride draws those within 900 m.
const starDraw = () => (course.route ? 1e6 : 900);
function updateStars(now) {
  bodyNow.copy(rider.p).addScaledVector(rider.n, 0.9);
  if (!havePrev) { bodyPrev.copy(bodyNow); havePrev = true; }
  const mesh = course.starMesh;
  _q.setFromAxisAngle(_yAxis, now * 3);
  let n = 0;
  for (const st of (course.route ? course.stars : starsNear(rider.p.x, rider.p.z, starDraw()))) {
    if (st.got < 0 && rider.crashed <= 0 && game.state === 'playing') {
      if (distToPath(st, bodyPrev, bodyNow) < STAR_REACH) {
        st.got = now;
        game.stars++;
        sound.star();
      }
    }
    if (st.got >= 0) {
      const e = now - st.got;
      if (e > 0.22) continue; // collected: gone
      _s.setScalar(1.35 + e * 5);
      _m.compose(_v.set(st.x, st.y + e * 8, st.z), _q, _s);
    } else {
      _s.setScalar(1.35);
      _m.compose(_v.set(st.x, st.y + Math.sin(now * 2 + st.i) * 0.12, st.z), _q, _s);
    }
    mesh.setMatrixAt(n++, _m);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  bodyPrev.copy(bodyNow);
}

// ---------- Locker: clothes and board ----------
let outfit = null;
function buildLocker() {
  outfit = { ...rider.outfit };
  const body = $('locker-body');
  body.textContent = '';
  const hex = n => '#' + n.toString(16).padStart(6, '0');
  const apply = () => { rider.setOutfit({ ...outfit }); saveOutfit(outfit); buildLocker(); };
  const row = (label, el) => {
    const r = document.createElement('div'); r.className = 'row';
    const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
    r.append(l, el); body.append(r);
  };
  const swatches = (key, group) => {
    const wrap = document.createElement('div'); wrap.className = 'swatches';
    for (const [name, c] of Object.entries(COLORS[group])) {
      const b = document.createElement('button');
      b.className = 'swatch'; b.style.background = hex(c); b.title = name;
      b.setAttribute('aria-label', name);
      b.setAttribute('aria-pressed', String(outfit[key] === name));
      b.onclick = () => { outfit[key] = name; apply(); };
      wrap.append(b);
    }
    return wrap;
  };
  const chips = (key, options) => {
    const wrap = document.createElement('div'); wrap.className = 'chips';
    for (const [value, label] of options) {
      const b = document.createElement('button');
      b.className = 'chip'; b.textContent = label;
      b.setAttribute('aria-pressed', String(outfit[key] === value));
      b.onclick = () => { outfit[key] = value; apply(); };
      wrap.append(b);
    }
    return wrap;
  };
  row('Top', chips('top', [['jacket', 'Jacket'], ['hoodie', 'Hoodie']]));
  row(outfit.top === 'hoodie' ? 'Hoodie colour' : 'Jacket colour', swatches('jacket', 'jacket'));
  row('Pants', swatches('pants', 'pants'));
  row('On your head', chips('headwear', [['helmet', 'Helmet'], ['beanie', 'Beanie']]));
  row(outfit.headwear === 'beanie' ? 'Beanie colour' : 'Helmet colour', swatches('head', 'head'));
  row('Goggle lens', swatches('lens', 'lens'));
  row('Face mask', chips('mask', [['none', 'None'], ['gaiter', 'Neck gaiter'], ['balaclava', 'Balaclava']]));
  if (outfit.mask !== 'none') row('Mask colour', swatches('maskColor', 'mask'));
  row('Pack', chips('pack', [[false, 'None'], [true, 'Avalanche airbag pack']]));
  // Boards, with what each one does to the riding.
  const boards = document.createElement('div'); boards.className = 'boards';
  const bar = v => Math.round(Math.min(1, Math.max(0.1, (v - 0.6) / 0.9)) * 100);
  for (const [id, b] of Object.entries(BOARDS)) {
    const card = document.createElement('button');
    card.className = 'boardcard';
    card.setAttribute('aria-pressed', String(outfit.board === id));
    const st = b.stats;
    card.innerHTML = `<strong></strong><span></span><div class="stats">
      <span>Turning</span><i><b style="width:${bar(st.turn)}%"></b></i>
      <span>Edge grip</span><i><b style="width:${bar(st.grip)}%"></b></i>
      <span>Spins</span><i><b style="width:${bar(st.spin)}%"></b></i>
      <span>Speed</span><i><b style="width:${bar(2 - st.drag)}%"></b></i>
      <span>Pop</span><i><b style="width:${bar(st.pop)}%"></b></i></div>`;
    card.querySelector('strong').textContent = b.name;
    card.querySelector('span').textContent = b.blurb;
    card.onclick = () => { outfit.board = id; apply(); };
    boards.append(card);
  }
  row('Board', boards);
  row('Board colour', swatches('boardColor', 'board'));
  row('Top sheet stripe', swatches('accent', 'accent'));
  row('Stance', chips('stance', [['regular', 'Regular (left foot forward)'], ['goofy', 'Goofy (right foot forward)']]));
}
function openLocker(open) {
  $('locker').hidden = !open;
  $('intro').hidden = open;
  game.state = open ? 'locker' : 'intro';
  document.body.classList.toggle('in-locker', open);
  if (!open) snapCamera();
}

// ---------- Minimap ----------
// A small map of the whole mountain: shaded relief, forest, the course line
// and drop-in spots, with your position and heading on top.
let mini = null;
function buildMinimap() {
  const cv = $('minimap');
  const scale = 4; // terrain cells per minimap pixel
  const w = Math.floor(terrain.W / scale), h = Math.floor(terrain.H / scale);
  cv.width = w; cv.height = h;
  const base = document.createElement('canvas');
  base.width = w; base.height = h;
  const g = base.getContext('2d');
  const img = g.createImageData(w, h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const ti = i * scale, tj = j * scale;
      const dx = terrain.at(ti + 1, tj) - terrain.at(ti - 1, tj);
      const dz = terrain.at(ti, tj + 1) - terrain.at(ti, tj - 1);
      const shade = Math.max(0.35, Math.min(1.1, 0.8 + (-dx + dz) * 0.02));
      const f = terrain.forestAt(ti * terrain.cell, tj * terrain.cell);
      const k = (j * w + i) * 4;
      img.data[k] = (235 - 165 * f) * shade;
      img.data[k + 1] = (240 - 140 * f) * shade;
      img.data[k + 2] = (250 - 160 * f) * shade;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const px = v => v / terrain.cell / scale;
  if (course.route) {
    g.strokeStyle = '#ff2d95'; g.lineWidth = 2; g.beginPath();
    course.route.p.forEach((p, i) => (i ? g.lineTo(px(p.x), px(p.z)) : g.moveTo(px(p.x), px(p.z))));
    g.stroke();
  }
  g.fillStyle = '#1d4ed8';
  // Lifts: red lines, like on a trail map
  g.strokeStyle = '#e11d48'; g.lineWidth = 1.2;
  for (const L of course.lifts.lifts) {
    g.beginPath();
    L.st.forEach((p, i) => (i ? g.lineTo(px(p.x), px(p.z)) : g.moveTo(px(p.x), px(p.z))));
    g.stroke();
  }
  for (const sp of course.spawns) { g.beginPath(); g.arc(px(sp.x), px(sp.z), 2.5, 0, Math.PI * 2); g.fill(); }
  mini = { cv, ctx: cv.getContext('2d'), base, px };
}
function drawMinimap() {
  if (!mini) return;
  const { ctx, base, px } = mini;
  ctx.drawImage(base, 0, 0);
  const x = px(rider.p.x), z = px(rider.p.z);
  const f = rider.forward();
  ctx.fillStyle = '#ffc531'; ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + f.x * 7, z + f.z * 7);
  ctx.lineTo(x - f.x * 4 - f.z * 4, z - f.z * 4 + f.x * 4);
  ctx.lineTo(x - f.x * 4 + f.z * 4, z - f.z * 4 - f.x * 4);
  ctx.closePath(); ctx.fill(); ctx.stroke();
}

// ---------- HUD ----------
function updateHud() {
  $('gnar').textContent = game.gnar.toLocaleString();
  const comboLive = game.combo > 1 && performance.now() / 1000 - game.lastTrick < GNAR.comboWindow;
  $('combo').textContent = comboLive ? `×${game.combo}` : '';
  $('stars').textContent = course.route ? `${game.stars} / ${course.stars.length}` : `${game.stars}`;
  $('speed').textContent = Math.round(rider.speed() * 3.6);
  $('elev').textContent = Math.round(rider.p.y + terrain.base);
  $('clock').textContent = fmtTime(game.time);
  if (course.route) {
    const left = Math.max(0, course.route.length - course.route.s[game.routeIndex]);
    $('togo').textContent = left > 1000 ? `${(left / 1000).toFixed(1)} km` : `${Math.round(left)} m`;
  } else {
    // Free ride: name the nearest landmark instead of distance to go.
    let best = null, bd = Infinity;
    for (const sp of course.spawns) {
      const d = (sp.x - rider.p.x) ** 2 + (sp.z - rider.p.z) ** 2;
      if (d < bd) { bd = d; best = sp; }
    }
    $('togo').textContent = best ? best.name : '';
    $('togo-label').textContent = '';
    $('togo-pre').textContent = 'near';
  }
  drawMinimap();
  $('charge').style.transform = `scaleX(${rider.charge})`;
  $('charge').parentElement.style.opacity = rider.charge > 0 ? 1 : 0;
}

// ---------- Gnar points ----------
// Airtime and spins score on a clean landing. Land tricks within COMBO_WINDOW
// seconds of each other to build a multiplier; a wipeout loses the trick and the combo.
const GNAR = {
  minAir: 0.6,            // seconds: shorter hops don't score
  airPoints: t => Math.round(60 * Math.pow(t, 1.6)),        // 1 s = 60, 2 s = 182, 3 s = 349
  spinPoints: { 180: 150, 360: 400, 540: 750, 720: 1200, 900: 1800, 1080: 2500 },
  comboWindow: 4,         // seconds
  maxCombo: 4,
};
function spinScore(deg) {
  if (deg < 180) return 0;
  return GNAR.spinPoints[deg] ?? 2500 + (deg - 1080) / 180 * 800;
}
function scoreLanding(e, now) {
  const air = e.air >= GNAR.minAir ? GNAR.airPoints(e.air) : 0;
  const spin = spinScore(e.spin);
  if (!air && !spin) return;
  game.combo = now - game.lastTrick < GNAR.comboWindow ? Math.min(GNAR.maxCombo, game.combo + 0.5) : 1;
  game.lastTrick = now;
  const pts = Math.round((air + spin) * game.combo);
  game.gnar += pts;
  const what = [e.spin >= 180 ? `${e.spin}` : '', e.air >= GNAR.minAir ? `${e.air.toFixed(1)} s air` : '']
    .filter(Boolean).join(' · ');
  toastHtml(what, `+${pts.toLocaleString()} gnar${game.combo > 1 ? ` ×${game.combo}` : ''}`);
}
function toastHtml(what, pts) {
  const el = $('toast');
  el.textContent = '';
  const a = document.createElement('span'); a.className = 'what'; a.textContent = what;
  const b = document.createElement('span'); b.className = 'pts'; b.textContent = pts;
  el.append(a, b);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

function handleEvents(now) {
  for (const e of rider.events) {
    if (e === 'jump') sound.jump();
    else if (e === 'crash') {
      sound.crash(); toast('Wipeout!');
      game.combo = 1; game.lastTrick = -99;
    } else if (e.type === 'land') { sound.land(); scoreLanding(e, now); }
  }
  rider.events.length = 0;
}

// ---------- Main loop ----------
const STEP = 1 / 120;
let acc = 0, last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  // Cap at 0.25 s (e.g. after switching tabs), but otherwise always keep up with real
  // time, so a slow phone never plays in slow motion.
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  if (game.state === 'riding') rideStep(dt);
  else if (game.state === 'playing' || game.state === 'finished') {
    acc += dt;
    const input = readInput();
    let n = 0;
    while (acc >= STEP && n++ < 30) {
      rider.step(STEP, input);
      rider.checkTrees(course);
      acc -= STEP;
    }
    if (game.state === 'playing') {
      game.time += dt;
      if (course.route) {
        const near = course.route.nearest(rider.p.x, rider.p.z, game.routeIndex);
        game.routeIndex = near.index;
        if (near.s > course.route.length - 30 && near.distance < 60) finish();
      }
    }
    handleEvents(t);
    if (rider.contact && rider.carve > 0.15 && rider.crashed <= 0) spray.emit(rider.p, rider.v, rider.carve, dt);
    sound.update(rider.speed(), rider.carve, rider.contact);
  }
  spray.update(dt);
  trail.add(rider.p, rider.v, rider.contact && rider.crashed <= 0 && game.state !== 'riding' && !terrain.onBump(rider.p.x, rider.p.z), rider.carve);
  lights.follow(rider.p);
  sky.material.uniforms.time.value = t;
  course.trees.update(rider.p.x, rider.p.z);
  course.lifts.update(t, rider.p);
  updateLiftPrompt();
  rider.updateModel(dt, t);
  updateStars(t);
  if (game.state === 'locker') lockerCamera(t); else updateCamera(dt);
  updateHud();
  renderer.render(scene, camera);
}

// ---------- Riding lifts ----------
let ride = null, offer = null;
function updateLiftPrompt() {
  const can = game.state === 'playing' && rider.crashed <= 0 && rider.contact && rider.speed() < 6;
  const o = can ? course.lifts.boardable(rider.p.x, rider.p.z) : null;
  if ((o && o.lift) !== (offer && offer.lift)) {
    offer = o;
    $('lift-prompt').hidden = !o;
    if (o) $('lift-name').textContent = o.lift.name;
  }
}
// Jump to the last couple of seconds of the ride.
function skipRide() { if (ride) ride.t = Math.max(ride.t, ride.duration - 2); }
function boardLift() {
  if (!offer || game.state !== 'playing') return;
  ride = course.lifts.ride(offer.lift, offer.from);
  game.state = 'riding';
  $('lift-prompt').hidden = true;
  $('lift-skip').hidden = false;
  toast(offer.lift.name);
  offer = null;
}
const _ride = new THREE.Vector3();
function rideStep(dt) {
  ride.t += dt;
  ride.pos(_ride);
  const d = ride.lift.dir, chair = ride.lift.type !== 'gondola';
  course.lifts.carry(ride.lift, _ride);
  // Sit one seat over from the centre hanger, facing up the lift.
  rider.p.set(_ride.x + (chair ? -d.z * 0.55 : 0), _ride.y - course.lifts.seatDrop(ride.lift), _ride.z + (chair ? d.x * 0.55 : 0));
  rider.seated = chair;
  rider.v.set(0, 0, 0);
  rider.yaw = chair ? Math.atan2(d.z, -d.x) : Math.atan2(d.x, d.z);
  rider.contact = false;
  if (ride.t >= ride.duration) {
    // Unload: step off just past the top station, facing downhill.
    const top = ride.lift.st[ride.lift.st.length - 1];
    placeClear(top.x + ride.lift.dir.x * 12, top.z + ride.lift.dir.z * 12);
    ride = null;
    rider.seated = false;
    course.lifts.carry(null);
    $('lift-skip').hidden = true;
    game.state = 'playing';
    havePrev = false;
    snapCamera();
  }
}

function finish() {
  game.state = 'finished';
  sound.finish();
  $('f-time').textContent = fmtTime(game.time);
  $('f-stars').textContent = `${game.stars} of ${course.stars.length}`;
  $('f-gnar').textContent = game.gnar.toLocaleString();
  const key = `peakrush.best.${COURSE_ID}`;
  let best = 0;
  try { best = +localStorage.getItem(key) || 0; } catch { /* storage off */ }
  if (game.gnar > best) {
    try { localStorage.setItem(key, String(game.gnar)); } catch { /* storage off */ }
    $('f-best').textContent = best ? `New best! (was ${best.toLocaleString()})` : 'First score on this run.';
  } else $('f-best').textContent = `Best on this run: ${best.toLocaleString()}`;
  $('finish').hidden = false;
}

// ---------- Start up ----------
async function init() {
  try {
    terrain = await loadTerrain(COURSE_ID);
  } catch (err) {
    $('loading').textContent = 'Could not load the mountain. If you opened the file directly, run it from a web server (see README).';
    throw err;
  }
  $('course-name').textContent = terrain.meta.name;
  const pick = $('course-pick');
  pick.value = COURSE_ID;
  pick.addEventListener('change', () => { location.hash = pick.value; location.reload(); });
  scene.add(terrain.buildMesh(groundMaterial(terrain)));
  const before = scene.children.length;
  course = buildCourse(terrain, scene);
  // Buildings, lifts, jumps and gates cast and catch shadows. Trees set up their
  // own; stars glow, so they're left alone.
  for (const o of scene.children.slice(before)) {
    if (o !== course.trees.mesh && o !== course.trees.casters && o !== course.starMesh) shadows(o);
  }
  rider = new Rider(terrain, scene);
  spray = new Spray(scene);
  trail = new Trail(scene, terrain);
  resize();
  const spawnPick = $('spawn-pick');
  if (course.spawns.length && !course.route) {
    course.spawns.forEach((sp, i) => spawnPick.add(new Option(sp.name, i)));
    spawnPick.addEventListener('change', () => { game.spawn = +spawnPick.value; restart(); });
    $('spawn-row').hidden = false;
  }
  course.stars.forEach((st, i) => { st.i = i; });
  rider.setOutfit(loadOutfit());
  buildLocker();
  buildMinimap();
  restart();
  game.state = 'intro';
  $('loading').hidden = true;
  $('drop').disabled = false;
  $('drop').addEventListener('click', begin);
  $('locker-open').addEventListener('click', () => openLocker(true));
  $('lift-prompt').addEventListener('click', boardLift);
  $('lift-skip').addEventListener('click', skipRide);
  $('menu').addEventListener('click', openMenu);
  $('resume').addEventListener('click', resume);
  $('f-menu').addEventListener('click', openMenu);
  $('locker-done').addEventListener('click', () => openLocker(false));
  $('again').addEventListener('click', () => { restart(); begin(); });
  $('restart').addEventListener('click', () => { restart(); });
  requestAnimationFrame(frame);
  // Handy for tuning from the browser console.
  window.game = { game, rider, course, terrain, camera, snapCamera, restart, renderer };
}
init();
