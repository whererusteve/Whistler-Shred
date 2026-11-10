// The snowboarder: physics (how the board moves on snow and through the air)
// and the 3D figure you see.
import * as THREE from '../vendor/three.module.min.js';
import { buildRiderModel, BOARDS, BODY, DEFAULT_OUTFIT } from './outfit.js';

// All the feel of the game lives in these numbers. Units: metres, seconds.
// "g" means multiples of gravity: 1 g of sideways grip is a turn that presses
// you into the snow as hard as your own weight.
export const PHYSICS = {
  gravity: 9.81,
  snowFriction: 0.035,  // gliding friction on groomed snow
  brakeFriction: 0.45,  // holding a stop once you've nearly stopped
  drag: 0.0085,         // air resistance; sets top speed (~70-80 km/h on a steep pitch)
  tuckDrag: 0.0058,     // crouched "tuck" for more speed
  carveG: 1.3,          // grip of an edge locked in a clean carve (a strong rider holds 1.3-1.5 g)
  skidG: 0.6,           // grip once the board is sliding sideways (much less: that's a wash-out)
  brakeG: 0.72,         // a hockey stop: board across the hill, scraping speed off
  heelGrip: 0.93,       // heelside holds a little less than toeside
  breakaway: 1.3,       // sideways slide (m/s) at which a carve lets go...
  hookup: 0.5,          // ...and the slide speed below which the edge bites again
  overdrive: 1.05,      // holding a turn asks for slightly more than the edge has, so long hard turns drift
  sidecut: 9,           // board's turning radius on a gentle edge (m); tighter as it tips over
  edgeTime: 0.22,       // seconds to roll from flat onto an edge
  carveDrag: 0.06,      // speed lost to the snow in a hard carve (share of the turning force)
  align: 2.5,           // how quickly the nose swings back to the direction of travel when you let go
  turnSlow: 2.4,        // pivoting the board with your feet at low speed (radians/s)
  push: 3,              // skating push on flats (m/s²)
  ollie: 2.6,           // basic jump pop (m/s): about 0.35 m off the snow, like a real ollie
  ollieCharged: 1.6,    // extra pop when held: up to about 0.9 m, a strong ollie
  airSpin: 6.5,         // top spin speed in the air (radians/s)
  spinUp: 0.15,         // seconds to wind a spin up to speed...
  spinDown: 0.2,        // ...and to open up and stop it
  heavyImpact: 8,       // landing this hard (m/s into the slope) buckles your knees and costs speed
  crashImpact: 12,      // landing this hard is a wipeout (about a 7 m drop onto flat ground)
  crashAngle: 0.45,     // land more than ~63° sideways and you wipe out
};

const UP = new THREE.Vector3(0, 1, 0);
const NO_INPUT = { steer: 0, jump: false, brake: false, tuck: false };

export class Rider {
  constructor(terrain, scene) {
    this.terrain = terrain;
    this.p = new THREE.Vector3();
    this.lastSafe = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.yaw = 0;
    this.n = new THREE.Vector3(0, 1, 0);
    this.contact = true;
    this.airTime = 0;
    this.spin = 0;          // how far we've rotated in this air (radians)
    this.spinRate = 0;      // how fast we're rotating in the air
    this.charge = 0;        // jump charge 0..1
    this.crashed = 0;       // seconds left in a wipeout
    this.edge = 0;          // -1..1: how far the board is tipped onto its left (-) or right (+) edge
    this.locked = true;     // edge holding a clean carve (false = sliding)
    this.sw = false;        // riding switch (tail first)
    this.lean = 0;          // how far the rider leans into the turn (radians)
    this.load = 1;          // how hard the snow pushes back, in g
    this.compress = 0;      // knees soaking up a landing, 1..0
    this.grab = 0;          // seconds the board has been grabbed in this air
    this.skid = 0;          // how sideways the board is sliding, 0..1
    this.carve = 0;         // how much snow we're spraying
    this.input = NO_INPUT;
    this.events = [];       // 'land', 'crash', 'jump', 'trick' for sound & HUD
    this.scene = scene;
    this.pose = null;
    this.setOutfit(DEFAULT_OUTFIT);
  }

  // Change clothes and board. The board also changes how the rider handles.
  setOutfit(outfit) {
    if (this.model) this.scene.remove(this.model.root);
    this.outfit = outfit;
    this.board = BOARDS[outfit.board].stats;
    this.model = buildRiderModel(outfit);
    // The rider casts a real shadow (see gfx.js); clear parts like goggles don't.
    this.model.root.traverse(o => { if (o.isMesh) { o.castShadow = !o.material.transparent; o.receiveShadow = true; } });
    this.scene.add(this.model.root);
    this.pose = null;
  }

  place(x, z, dirX, dirZ, speed = 0) {
    this.p.set(x, this.terrain.groundHeight(x, z), z);
    this.yaw = Math.atan2(dirX, dirZ);
    this.v.set(dirX * speed, 0, dirZ * speed);
    this.crashed = 0;
    this.airTime = 0;
    this.contact = true;
    this.edge = 0; this.lean = 0; this.locked = true; this.sw = false;
    this.spinRate = 0; this.grab = 0; this.compress = 0;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  speed() { return this.v.length(); }

  step(dt, input) {
    const P = PHYSICS, T = this.terrain, B = this.board;
    const p = this.p, v = this.v;
    const n = T.normalAt(p.x, p.z, this.n);
    const gap = p.y - T.groundHeight(p.x, p.z);
    this.contact = gap < 0.15;
    const steer = this.crashed > 0 ? 0 : input.steer;
    this.input = input;

    v.y -= P.gravity * dt;
    this.compress = Math.max(0, this.compress - dt * 2.2);
    let load = 0;

    if (this.crashed > 0) {
      this.crashed -= dt;
      v.multiplyScalar(Math.exp(-2.5 * dt));
      this.edge = 0; this.spinRate = 0;
      if (this.crashed <= 0) this.recover();
    } else if (this.contact) {
      // Board axes on the slope: bf along the board, side out to the rider's left.
      const f = this.forward(_f);
      const bf = _bf.copy(f).addScaledVector(n, -f.dot(n)).normalize();
      const side = _side.crossVectors(n, bf);
      const vn = v.dot(n);
      let vf = v.dot(bf), vs = v.dot(side);

      // Going tail first? Then that end is now the front: we're riding switch.
      if (vf < -0.8) { this.yaw += Math.PI; vf = -vf; vs = -vs; bf.negate(); side.negate(); this.sw = !this.sw; this.edge = -this.edge; this.lean = -this.lean; }

      const speed = Math.hypot(vf, vs);
      const slip = Math.atan2(vs, Math.max(vf, 0.01));   // angle between where the board points and where it's going
      const braking = input.brake && speed > 1.2;
      const press = P.gravity * Math.max(0.3, n.y);       // how hard the slope holds the board

      // --- Edge: tip the board the way you steer. In a slide, stay on the uphill
      // edge (the one you're sliding away from) so the other can't catch. ---
      const edgeWant = braking || Math.abs(vs) > P.breakaway ? Math.sign(vs) || steer : steer;
      const roll = dt / P.edgeTime * B.turn;
      this.edge += THREE.MathUtils.clamp(edgeWant - this.edge, -roll, roll);
      const e = this.edge, tip = Math.abs(e);
      // Toeside is the edge the rider faces: the right edge for a regular rider.
      const toeRight = (this.outfit.stance === 'goofy') === this.sw;
      const heel = (e > 0) !== toeRight;

      // --- Grip: a locked carve holds far more than a sliding board. ---
      if (Math.abs(vs) > P.breakaway) this.locked = false;
      else if (Math.abs(vs) < P.hookup) this.locked = true;
      const carveGrip = P.carveG * press * B.grip * (0.45 + 0.55 * tip) * (heel ? P.heelGrip : 1);
      const grip = braking ? P.brakeG * press * B.grip
        : this.locked ? carveGrip : P.skidG * press * B.grip * (0.5 + 0.5 * tip);

      // --- Turning ---
      if (braking) {
        // Hockey stop: swing the board across the direction of travel. Steer picks
        // the side; otherwise carry on the way it's sliding, or stop heelside (facing downhill).
        const way = steer || (Math.abs(vs) > 0.4 ? Math.sign(vs) : toeRight ? -1 : 1);
        this.yaw -= THREE.MathUtils.clamp((way * 1.4 - slip) * 6, -5, 5) * dt;
      } else {
        // An edged board follows its sidecut: tighter the further it's tipped, and
        // no tighter than the edge can hold at this speed. At walking pace you pivot it with your feet.
        const radius = P.sidecut / B.turn * Math.cos(tip * 1.05);
        const want = e * speed / radius + steer * P.turnSlow * B.turn / (1 + (speed / 6) ** 2);
        // The edge also has to hold you against the slope's sideways pull, which
        // leaves less for turning one way and more for the other.
        const pull = -P.gravity * side.y;
        const hold = this.locked ? P.overdrive * carveGrip : grip, least = 0.15 * hold;
        const v1 = Math.max(speed, 0.5);
        this.yaw -= THREE.MathUtils.clamp(want, -Math.max(least, hold + pull) / v1, Math.max(least, hold - pull) / v1) * dt;
        // Hands off, the nose swings round to where you're going.
        if (!steer && speed > 2) this.yaw += slip * P.align * Math.min(1, speed / 6) * dt;
      }

      // --- The edge pushes back against sideways sliding, up to its grip. ---
      const dvs = THREE.MathUtils.clamp(-vs, -grip * dt, grip * dt);
      const used = Math.abs(dvs) / dt;                    // turning force actually used (m/s²)
      const vs2 = vs + dvs;
      this.carve = Math.min(1, used / (1.2 * P.gravity) * (this.locked && !braking ? 0.6 : 1.1)
        + (this.locked && !braking ? 0 : Math.abs(vs) / 9));

      // Snow friction, air drag and the drag of a hard carve slow you along the board.
      const mu = input.brake && !braking ? P.brakeFriction : P.snowFriction;
      const cd = (input.tuck && speed > 6 && !input.brake ? P.tuckDrag : P.drag) * B.drag;
      const slow = (mu * press + cd * speed * speed + P.carveDrag * used) * dt;
      vf = vf > 0 ? Math.max(0, vf - slow) : Math.min(0, vf + slow);

      // Push along on the flats.
      if (input.tuck && speed < 7 && !input.brake) vf += P.push * dt;

      // Jump: hold to charge, release to pop. Steering as you pop winds up a spin.
      if (input.jump) this.charge = Math.min(1, this.charge + dt / 0.5);
      let pop = 0;
      this.spinRate = 0;
      if (!input.jump && this.charge > 0) {
        pop = (P.ollie + P.ollieCharged * this.charge) * B.pop;
        this.charge = 0;
        this.spinRate = steer * P.airSpin * B.spin * 0.5;
        this.events.push('jump');
      }

      v.copy(bf).multiplyScalar(vf).addScaledVector(side, vs2).addScaledVector(n, vn + pop);
      this.skid = speed > 1 ? Math.abs(vs2) / speed : 0;   // 0 = tracking straight, 1 = fully sideways
      // Lean into the turn as far as the turning force needs (1 g = 45°).
      const leanWant = used > 1.5 ? -Math.sign(dvs) * Math.min(1.05, Math.atan(used / P.gravity))
        : e * 0.22 * Math.min(1, speed / 4);
      this.lean += (leanWant - this.lean) * Math.min(1, dt * 9);
      load = n.y + used / P.gravity * 0.5;
    } else {
      // In the air: left/right winds a spin up; let go and it slows as you open up.
      // Skipping off a bump isn't a jump: no spinning until you're properly airborne.
      const flying = this.airTime > 0.1 || Math.abs(this.spinRate) > 0.5;
      const want = flying ? steer * P.airSpin * B.spin : 0;
      this.spinRate += (want - this.spinRate) * Math.min(1, dt / (steer ? P.spinUp : P.spinDown));
      this.yaw -= this.spinRate * dt;
      this.spin += this.spinRate * dt;
      // Hold tuck in the air to grab the board.
      this.grab = input.tuck && this.airTime > 0.2 ? this.grab + dt : 0;
      this.grabBest = Math.max(this.grabBest || 0, this.grab);
      v.multiplyScalar(1 - 0.0006 * v.length() * dt);
      this.charge = 0;
      this.edge *= 1 - Math.min(1, dt * 6);
      this.lean *= 1 - Math.min(1, dt * 4);
    }
    this.load += (load - this.load) * Math.min(1, dt * 6);

    if (gap > 0.3) this.airTime += dt;

    this.lastSafe.copy(p);
    p.addScaledVector(v, dt);

    // Keep inside the map.
    const pad = 4;
    if (p.x < pad || p.x > T.sizeX - pad) { p.x = THREE.MathUtils.clamp(p.x, pad, T.sizeX - pad); v.x = 0; }
    if (p.z < pad || p.z > T.sizeZ - pad) { p.z = THREE.MathUtils.clamp(p.z, pad, T.sizeZ - pad); v.z = 0; }

    // Touching down: stop at the surface and lose the speed going into it.
    const ground = T.groundHeight(p.x, p.z);
    if (p.y < ground) {
      const n2 = T.normalAt(p.x, p.z, _n2);
      const into = v.dot(n2);
      p.y = ground;
      if (into < 0) v.addScaledVector(n2, -into);
      if (this.airTime > 0.35) this.land(-into);
      this.airTime = 0;
      this.spin = 0; this.grab = 0; this.grabBest = 0;
    }
  }

  land(impact) {
    const P = PHYSICS;
    const f = this.forward(_f);
    const h = _h.set(this.v.x, 0, this.v.z);
    const hs = h.length();
    const align = hs > 1 ? Math.abs(f.dot(h) / hs) : 1;
    const turns = Math.round(Math.abs(this.spin) / Math.PI) * 180;
    this.spinRate = 0;
    if (impact > P.crashImpact || align < P.crashAngle) {
      this.crash();
      return;
    }
    // The board lands pointing wherever you left it. Off-line, it skids until the
    // edge bites: a sketchy landing that costs speed. A hard one buckles the knees.
    const heavy = impact > P.heavyImpact;
    if (heavy) this.v.multiplyScalar(0.8);
    this.compress = Math.min(1, impact / 9);
    this.events.push({ type: 'land', spin: turns, air: this.airTime, grab: this.grabBest || 0, heavy });
  }

  crash() {
    this.crashed = 1.6;
    this.charge = 0;
    this.spin = 0;
    this.events.push('crash');
  }

  recover() {
    // Get up facing downhill.
    const n = this.terrain.normalAt(this.p.x, this.p.z);
    const dx = n.x, dz = n.z;
    if (Math.hypot(dx, dz) > 0.02) this.yaw = Math.atan2(dx, dz);
    this.v.multiplyScalar(0.2);
    this.p.y = this.terrain.groundHeight(this.p.x, this.p.z);
    this.sw = false; this.edge = 0; this.lean = 0; this.locked = true;
  }

  // Bump into trees.
  checkTrees(course) {
    // Buildings: step back out and wipe out (unless already down).
    if (course.buildings.hit(this.p.x, this.p.z, this.p.y, 0.4)) {
      this.p.copy(this.lastSafe);
      this.v.multiplyScalar(this.crashed > 0 ? 0 : 0.1);
      if (this.crashed <= 0) this.crash();
      return;
    }
    if (this.crashed > 0) return;
    // Lift stations
    for (const k of course.lifts.keepClear) {
      const dx = this.p.x - k.x, dz = this.p.z - k.z;
      if (dx * dx + dz * dz < k.r * k.r && this.p.y < k.top) {
        this.p.copy(this.lastSafe);
        this.v.multiplyScalar(0.1);
        this.crash();
        return;
      }
    }
    for (const t of course.treesNear(this.p.x, this.p.z)) {
      const dx = this.p.x - t.x, dz = this.p.z - t.z;
      const r = 0.55 + 0.9 * t.scale;
      if (dx * dx + dz * dz < r * r && this.p.y < t.y + 9 * t.scale * 2.2) {
        const d = Math.hypot(dx, dz) || 1;
        this.p.x = t.x + dx / d * r; this.p.z = t.z + dz / d * r;
        this.v.multiplyScalar(0.15);
        this.crash();
        return;
      }
    }
  }

  // Put the 3D figure where the physics says it is, and move the body the way
  // a rider would: knees and hips over the working edge, shoulders and head
  // turned to look down the hill, arms out for balance.
  updateModel(dt, time) {
    const m = this.model, inp = this.crashed > 0 ? NO_INPUT : this.input;
    const sit = !!this.seated;
    if (sit) this.sw = false;
    const air = !this.contact && !sit && this.airTime > 0.12;
    // On the snow the board follows the slope; in the air it levels out, then
    // tips to match the landing.
    const below = air ? this.terrain.normalAt(this.p.x, this.p.z, _n2).lerp(UP, 0.4).normalize() : null;
    const n = this.crashed > 0 || sit ? UP : air ? below : this.n;
    m.up.lerp(n, Math.min(1, dt * (air ? 4 : 12))).normalize();
    // Riding switch, the body keeps facing the same edge: only the direction of travel changes.
    const s = this.sw ? -1 : 1;
    const f = this.forward(_f).multiplyScalar(s);
    const fwd = _bf.copy(f).addScaledVector(m.up, -f.dot(m.up)).normalize();
    const side = _side.crossVectors(m.up, fwd);
    _mat.makeBasis(side, m.up, fwd);
    m.root.quaternion.setFromRotationMatrix(_mat);
    m.root.position.copy(this.p);

    // Whole-body lean, pivoting on the edge that's in the snow.
    const goofy = this.outfit.stance === 'goofy' ? -1 : 1;
    const lean = this.lean * s * 0.82;   // the body angles in a little less than the board
    m.lean.rotation.z = lean;
    m.lean.rotation.x = 0;
    m.lean.position.y = Math.abs(Math.sin(lean)) * m.halfWidth * 0.9;
    m.fig.rotation.y = sit ? 0 : goofy < 0 ? Math.PI : 0;
    m.board.rotation.y = m.fig.rotation.y;

    // From here on everything is measured in the body's own space: toes at -x,
    // and `tz` is which way along the board (+z or -z) the rider is travelling.
    const tz = sit ? 1 : goofy * s;
    const toe = Math.max(0, lean * goofy), heel = Math.max(0, -lean * goofy);
    const speed = this.speed(), fast = Math.min(1, speed / 14);
    const tuck = inp.tuck && this.contact && speed > 6 && !inp.brake ? 1 : 0;
    const soak = Math.max(this.compress, THREE.MathUtils.clamp((this.load - 1) * 0.5, -0.15, 0.4));
    const spinning = air ? THREE.MathUtils.clamp(this.spinRate / PHYSICS.airSpin, -1, 1) : 0;
    const grab = air && this.grab > 0 ? 1 : 0;
    const B = BODY, P = _pose;

    // Target pose. hip* = where the hips sit over the board; bend/twist/tilt = spine.
    P.hipY = 1.0 - 0.07 * fast - 0.1 * toe - 0.2 * heel - 0.3 * this.charge - 0.34 * soak - 0.3 * tuck;
    P.hipX = 0.02 - 0.13 * toe + 0.17 * heel - 0.04 * tuck;
    P.hipZ = 0.03 * tz * fast;
    P.bend = 0.2 + 0.12 * fast - 0.3 * toe + 0.3 * heel + 0.25 * this.charge + 0.25 * soak + 0.62 * tuck;
    P.twist = tz * (0.4 + 0.12 * fast) - 0.5 * spinning;
    P.tilt = 0;
    P.look = tz * 0.85 - 0.35 * spinning;
    P.nod = -0.1 - 0.35 * tuck;
    // Hands, measured from the hips: lead hand out over the nose, rear hand low
    // over the tail, both further out as the turn builds.
    const reach = 0.1 * Math.max(toe, heel);
    setHand(P.lead, -0.2 - 0.12 * heel, 0.2 + reach, tz * 0.44);
    setHand(P.rear, -0.14 - 0.1 * heel + 0.05 * toe, 0.12 + reach - 0.14 * toe, -tz * 0.42);
    if (this.charge > 0) {              // winding up: arms swing down and back
      setHand(P.lead, 0.05, -0.02, tz * 0.36); setHand(P.rear, 0.08, -0.04, -tz * 0.36);
    }
    if (tuck) { setHand(P.lead, -0.36, 0.2, tz * 0.1); setHand(P.rear, -0.34, 0.16, -tz * 0.08); }
    if (inp.brake && this.contact && speed > 1.2) { P.lead[1] += 0.12; P.rear[1] += 0.1; P.hipY -= 0.05; }
    if (air) {
      // Knees up under the body; arms wide, or pulled in to spin faster.
      const wrap = Math.abs(spinning);
      P.hipY = 0.76 - 0.34 * grab; P.hipX = 0.04 * grab; P.bend = 0.38 + 0.65 * grab; P.tilt = -tz * 0.4 * grab;
      setHand(P.lead, -0.2 + 0.1 * wrap, 0.3 - 0.1 * wrap, tz * (0.5 - 0.22 * wrap));
      setHand(P.rear, -0.18 + 0.1 * wrap, 0.26 - 0.1 * wrap, -tz * (0.48 - 0.22 * wrap));
      if (grab) { setHand(P.rear, -0.2 - P.hipX, 0.07 - P.hipY, -tz * 0.04); setHand(P.lead, -0.05, 0.5, tz * 0.5); P.nod = -0.35; }   // indy: rear hand on the toe edge
    }
    if (sit) {
      // Chairlift: hips on the seat, board hanging off in front, hands on the knees.
      P.hipY = 0.16; P.hipX = 0.12; P.hipZ = 0; P.bend = 0.05; P.twist = 0; P.look = 0; P.nod = 0;
      setHand(P.lead, -0.36, 0.1, 0.16); setHand(P.rear, -0.36, 0.1, -0.16);
    }
    if (this.crashed > 0) {
      // Tumbling: limbs flail.
      m.lean.rotation.z = Math.sin(time * 9) * 1.2;
      m.lean.rotation.x = time * 7;
      P.hipY = 0.7; P.bend = 0.6 + Math.sin(time * 11) * 0.3; P.tilt = Math.sin(time * 7) * 0.4;
      setHand(P.lead, -0.2, 0.3 + Math.sin(time * 13) * 0.25, 0.5); setHand(P.rear, 0.1, 0.3 + Math.cos(time * 12) * 0.25, -0.5);
    }
    // A little life: breathing at rest, chatter at speed.
    P.hipY += Math.sin(time * 2.1) * 0.006 + Math.sin(time * 31) * 0.006 * fast * (this.contact ? 1 : 0);

    // Ease from the last pose to the target so nothing snaps.
    const C = this.pose ||= clonePose(P);
    const k = Math.min(1, dt * (sit ? 30 : 11));
    for (const key of POSE_KEYS) C[key] += (P[key] - C[key]) * k;
    for (let i = 0; i < 3; i++) { C.lead[i] += (P.lead[i] - C.lead[i]) * k; C.rear[i] += (P.rear[i] - C.rear[i]) * k; }

    // Feet: on the snow under the hips, or swung forward on the chair.
    m.feet.position.set(sit ? -0.56 : 0, sit ? -0.36 : 0, 0);
    m.feet.rotation.z = sit ? -0.55 : 0;
    // Hips can't be further from an ankle than the leg is long.
    const hip = _hip.set(C.hipX, C.hipY, C.hipZ).add(m.feet.position);
    for (const leg of m.legs) {
      const ankle = _a.set(B.ankle[0], B.ankle[1], leg.sgn * B.ankle[2]).applyQuaternion(m.feet.quaternion).add(m.feet.position);
      const d = _b.copy(hip).setZ(hip.z + leg.sgn * B.hipHalf).sub(ankle), far = B.thigh + B.shin - 0.02;
      if (d.length() > far) hip.addScaledVector(d, far / d.length() - 1);
    }
    m.pelvis.position.copy(hip);
    m.spine.position.copy(hip);
    m.spine.rotation.set(C.tilt, C.twist, C.bend);
    m.head.rotation.set(0, C.look - C.twist, C.nod);

    for (const leg of m.legs) {
      const top = _b.set(hip.x, hip.y, hip.z + leg.sgn * B.hipHalf);
      const ankle = _a.set(B.ankle[0], B.ankle[1], leg.sgn * B.ankle[2]).applyQuaternion(m.feet.quaternion).add(m.feet.position);
      // Knees point over the toes and a little apart.
      const knee = bendJoint(top, ankle, B.thigh, B.shin, _c.set(-1, 0.15, leg.sgn * 0.3), _d);
      stretch(leg.thigh, knee, top); stretch(leg.shin, ankle, knee);
      leg.knee.position.copy(knee);
    }
    for (const arm of m.arms) {
      const isLead = arm.sgn === tz;
      const h = isLead ? C.lead : C.rear;
      const top = _b.set(B.shoulder[0], B.shoulder[1], arm.sgn * B.shoulder[2]).applyQuaternion(m.spine.quaternion).add(hip);
      const hand = _a.set(hip.x + h[0], hip.y + h[1], hip.z + h[2]);
      // Don't let an arm pass through the body: keep the hand on its own side.
      if (hand.z * arm.sgn < 0.02 && !(grab && !isLead)) hand.z = arm.sgn * 0.02;
      const d = _c.copy(hand).sub(top), far = B.upperArm + B.foreArm - 0.01;
      if (d.length() > far) hand.copy(top).addScaledVector(d, far / d.length());
      // Elbows hang down and back.
      const elbow = bendJoint(top, hand, B.upperArm, B.foreArm, _c.set(0.5, -1, arm.sgn * 0.35), _d);
      stretch(arm.upper, elbow, top); stretch(arm.fore, hand, elbow);
      arm.elbow.position.copy(elbow); arm.shoulder.position.copy(top); arm.hand.position.copy(hand);
    }
  }
}

// ---------- Body helpers ----------
const POSE_KEYS = ['hipX', 'hipY', 'hipZ', 'bend', 'twist', 'tilt', 'look', 'nod'];
const _pose = { hipX: 0, hipY: 1.0, hipZ: 0, bend: 0.3, twist: 0, tilt: 0, look: 0, nod: 0, lead: [0, 0, 0], rear: [0, 0, 0] };
const clonePose = p => ({ ...p, lead: [...p.lead], rear: [...p.rear] });
const setHand = (h, x, y, z) => { h[0] = x; h[1] = y; h[2] = z; };

// Where a knee or elbow goes: the two bones have fixed lengths, so the joint
// sits off the straight line between the ends, pushed towards `pole`.
function bendJoint(top, end, l1, l2, pole, out) {
  const dir = _e.copy(end).sub(top);
  const dist = THREE.MathUtils.clamp(dir.length(), Math.abs(l1 - l2) + 0.001, l1 + l2 - 0.001);
  dir.normalize();
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const off = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  pole.addScaledVector(dir, -pole.dot(dir)).normalize();
  return out.copy(top).addScaledVector(dir, along).addScaledVector(pole, off);
}

// Stretch a one-metre limb piece from `from` (its lower end) to `to`.
function stretch(mesh, from, to) {
  const d = _e.copy(to).sub(from), len = d.length() || 0.001;
  mesh.position.copy(from).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.multiplyScalar(1 / len));
  mesh.scale.set(1, len, 1);
}

const _f = new THREE.Vector3(), _bf = new THREE.Vector3(), _side = new THREE.Vector3();
const _n2 = new THREE.Vector3(), _h = new THREE.Vector3(), _hip = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();
const _mat = new THREE.Matrix4();
