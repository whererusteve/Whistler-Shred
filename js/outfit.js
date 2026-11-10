// What the rider wears and rides. Choices are saved on this device.
import * as THREE from '../vendor/three.module.min.js';

export const COLORS = {
  jacket: { 'Glacier blue': 0x1e88e5, 'Signal red': 0xe53935, 'Avalanche orange': 0xfb8c00, 'Lime': 0x8bc34a,
    'Forest': 0x2e7d32, 'Purple': 0x7e57c2, 'Black': 0x212121, 'White': 0xeeeeee },
  pants: { 'Navy': 0x1f2a44, 'Black': 0x1b1b1b, 'Charcoal': 0x455a64, 'Tan': 0xa1887f, 'Olive': 0x556b2f, 'Red': 0xb71c1c },
  head: { 'Yellow': 0xffd23a, 'White': 0xf5f5f5, 'Black': 0x222222, 'Red': 0xd32f2f, 'Teal': 0x00897b, 'Pink': 0xec407a },
  mask: { 'Black': 0x1b1b1b, 'Grey': 0x6b7280, 'Camo green': 0x4b5d3a, 'Red': 0xc62828, 'Blue': 0x1e40af, 'Leopard tan': 0xc8a165 },
  lens: { 'Smoke': 0x0f172a, 'Gold mirror': 0xd4a017, 'Blue mirror': 0x1565c0, 'Rose': 0xd81b60, 'Green mirror': 0x2e7d32 },
  board: { 'Red': 0xff3b30, 'Black': 0x1b1b1b, 'White': 0xf2f2f2, 'Teal': 0x00acc1, 'Yellow': 0xffc531, 'Wood': 0xb07a4a },
  accent: { 'White': 0xffffff, 'Black': 0x111111, 'Orange': 0xff7a00, 'Blue': 0x1e88e5, 'Pink': 0xff4fa3, 'Green': 0x43a047 },
};

// Each board changes the feel a little. 1 = the all-mountain baseline.
//   turn: how quickly it turns   grip: how hard the edge holds in a carve
//   spin: spin speed in the air  drag: air drag (lower = faster)   pop: ollie height
export const BOARDS = {
  allmountain: {
    name: 'All-mountain', blurb: 'Does everything evenly. A good first board.',
    length: 1.55, width: 0.30, shape: 'twin',
    stats: { turn: 1, grip: 1, spin: 1, drag: 1, pop: 1 },
  },
  park: {
    name: 'Park twin', blurb: 'Short and soft: quick turns, faster spins, more pop. Lets go sooner in hard carves.',
    length: 1.45, width: 0.29, shape: 'twin',
    stats: { turn: 1.15, grip: 0.85, spin: 1.3, drag: 1.04, pop: 1.15 },
  },
  powder: {
    name: 'Powder swallowtail', blurb: 'Long, pointed nose and a split tail: a bit faster and steadier, slower to spin.',
    length: 1.62, width: 0.31, shape: 'swallow',
    stats: { turn: 0.9, grip: 1.05, spin: 0.85, drag: 0.93, pop: 0.95 },
  },
  carving: {
    name: 'Carving board', blurb: 'Narrow and stiff, like alpine racers ride: grips like a rail, not for tricks.',
    length: 1.65, width: 0.24, shape: 'carve',
    stats: { turn: 0.95, grip: 1.4, spin: 0.75, drag: 0.95, pop: 0.9 },
  },
};

export const DEFAULT_OUTFIT = {
  jacket: 'Glacier blue', top: 'jacket', pants: 'Navy', mask: 'none', maskColor: 'Black', headwear: 'helmet', head: 'Yellow', lens: 'Smoke',
  pack: false, board: 'allmountain', boardColor: 'Red', accent: 'White', stance: 'regular',
};

const KEY = 'peakrush.outfit';
export function loadOutfit() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    const out = { ...DEFAULT_OUTFIT, ...o };
    if (!BOARDS[out.board]) out.board = DEFAULT_OUTFIT.board;
    return out;
  } catch { return { ...DEFAULT_OUTFIT }; }
}
export function saveOutfit(o) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* private mode: fine */ }
}

// The board's outline seen from above: x across, y along (nose at +y).
function boardShape(type, w, L) {
  const s = new THREE.Shape();
  const tip = 0.16;
  if (type === 'swallow') {
    s.moveTo(-w, -L + tip);
    s.quadraticCurveTo(-w * 0.9, 0, -w, L - tip * 1.6);
    s.quadraticCurveTo(-w * 0.9, L, 0, L + 0.05);            // pointed nose
    s.quadraticCurveTo(w * 0.9, L, w, L - tip * 1.6);
    s.quadraticCurveTo(w * 0.9, 0, w, -L + tip);
    s.quadraticCurveTo(w, -L, w * 0.45, -L);
    s.lineTo(0, -L + 0.2);                                   // swallowtail notch
    s.lineTo(-w * 0.45, -L);
    s.quadraticCurveTo(-w, -L, -w, -L + tip);
  } else if (type === 'carve') {
    s.moveTo(-w, -L + 0.06);
    s.quadraticCurveTo(-w * 0.94, 0, -w, L - tip);
    s.quadraticCurveTo(-w, L, 0, L);
    s.quadraticCurveTo(w, L, w, L - tip);
    s.quadraticCurveTo(w * 0.94, 0, w, -L + 0.06);
    s.lineTo(-w, -L + 0.06);                                 // square race tail
  } else {
    s.moveTo(-w, -L + tip);
    s.quadraticCurveTo(-w * 0.88, 0, -w, L - tip);          // sidecut
    s.quadraticCurveTo(-w, L, 0, L);
    s.quadraticCurveTo(w, L, w, L - tip);
    s.quadraticCurveTo(w * 0.88, 0, w, -L + tip);
    s.quadraticCurveTo(w, -L, 0, -L);
    s.quadraticCurveTo(-w, -L, -w, -L + tip);
  }
  return s;
}

function flatPiece(shape, depth, y) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  g.rotateX(Math.PI / 2);         // lie flat: shape's y becomes the board's length (z)
  g.translate(0, y + depth, 0);
  return g;
}

// Body measurements (metres) for a rider about 1.75 m tall.
export const BODY = {
  thigh: 0.44, shin: 0.44, upperArm: 0.29, foreArm: 0.27,
  hipHalf: 0.10,            // hip joints either side of the pelvis
  ankle: [0, 0.27, 0.25],   // ankle above the board, half the stance width from centre
  shoulder: [0, 0.45, 0.2], // shoulder joints, measured from the hips
  neck: 0.53,
};

// The figure is a jointed body: pelvis, spine (torso + head), and arms and legs
// made of straight pieces that rider.js stretches between joints every frame.
// It is built facing -x (the toe edge) with the left foot at +z.
export function buildRiderModel(o) {
  const root = new THREE.Group();
  const lean = new THREE.Group();          // tilts into turns
  root.add(lean);
  const mat = c => new THREE.MeshLambertMaterial({ color: c });
  const C = (group, name) => COLORS[group][name] ?? Object.values(COLORS[group])[0];
  // Goofy riders lead with the right foot: the same body, turned to face the other edge.
  const fig = new THREE.Group();
  fig.rotation.y = o.stance === 'goofy' ? Math.PI : 0;
  lean.add(fig);
  // Board, bindings and boots move together (they swing forward on a chairlift).
  const feet = new THREE.Group();
  fig.add(feet);

  // Board, with a two-tone top sheet
  const boardGroup = new THREE.Group();
  boardGroup.rotation.y = fig.rotation.y;  // keep the nose pointing forward
  feet.add(boardGroup);
  const b = BOARDS[o.board];
  const w = b.width / 2, L = b.length / 2;
  boardGroup.add(new THREE.Mesh(flatPiece(boardShape(b.shape, w, L), 0.035, 0.0),
    [mat(C('board', o.boardColor)), mat(0x2a2a2a)]));
  const deco = new THREE.Shape();
  deco.moveTo(-w * 0.35, -L * 0.62); deco.lineTo(w * 0.35, -L * 0.62);
  deco.lineTo(w * 0.35, L * 0.62); deco.lineTo(-w * 0.35, L * 0.62); deco.closePath();
  boardGroup.add(new THREE.Mesh(flatPiece(deco, 0.004, 0.035), mat(C('accent', o.accent))));

  // Bindings and boots: toes at -x, angled out a little ("duck" stance).
  const dark = mat(0x161616), bootMat = mat(0x24262b);
  for (const sgn of [-1, 1]) {
    const foot = new THREE.Group();
    foot.position.set(0, 0.04, sgn * BODY.ankle[2]);
    foot.rotation.y = sgn * -0.21;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.03, 0.14), dark);
    base.position.y = 0.015;
    const highback = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.12), dark);
    highback.position.set(0.125, 0.13, 0); highback.rotation.z = 0.12;
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.115), bootMat);
    sole.position.set(-0.02, 0.08, 0);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.066, 0.17, 10), bootMat);
    cuff.position.set(0.04, 0.2, 0); cuff.rotation.z = 0.12;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.135), dark);
    strap.position.set(-0.01, 0.14, 0); strap.rotation.z = 0.5;
    const toe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.135), dark);
    toe.position.set(-0.12, 0.125, 0);
    foot.add(base, highback, sole, cuff, strap, toe);
    feet.add(foot);
  }

  // A limb piece: a tapered tube one metre long, stretched between two joints.
  const pants = mat(C('pants', o.pants)), jacket = mat(C('jacket', o.jacket)), glove = mat(0x1a1a1a);
  const piece = (rTop, rBottom, material) => {
    const g = new THREE.CylinderGeometry(rTop, rBottom, 1, 10);
    const m = new THREE.Mesh(g, material);
    fig.add(m);
    return m;
  };
  const ball = (r, material) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), material); fig.add(m); return m; };
  const legs = [-1, 1].map(sgn => ({
    sgn, thigh: piece(0.108, 0.09, pants), shin: piece(0.086, 0.088, pants), knee: ball(0.092, pants),
  }));
  const arms = [-1, 1].map(sgn => ({
    sgn, upper: piece(0.072, 0.062, jacket), fore: piece(0.055, 0.062, jacket),
    elbow: ball(0.063, jacket), shoulder: ball(0.08, jacket), hand: ball(0.066, glove),
  }));
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.115, 0.12, 4, 10), pants);
  pelvis.rotation.x = Math.PI / 2;   // lies across the hips
  fig.add(pelvis);

  // Spine: everything above the hips, measured up from the hip joint.
  const spine = new THREE.Group();
  spine.rotation.order = 'YZX';      // twist, then bend forward, then sideways
  fig.add(spine);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.3, 4, 12), jacket);
  torso.position.y = 0.26; torso.scale.set(0.98, 1, 1.32);   // wider across the shoulders
  spine.add(torso);
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.14, 12), jacket);
  hem.position.y = 0.04; hem.scale.set(0.95, 1, 1.25);
  spine.add(hem);

  const head = new THREE.Group();    // turns to look where the rider is going
  head.position.y = BODY.neck + 0.11;
  spine.add(head);
  // A balaclava covers the whole head except the goggles, so it replaces the skin.
  const maskMat = mat(C('mask', o.maskColor));
  const skin = o.mask === 'balaclava' ? maskMat : mat(0xe2b48c);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.112, 14, 10), skin));
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), skin);
  neck.position.y = -0.11;
  head.add(neck);
  if (o.mask === 'gaiter') {
    // Neck gaiter pulled up over nose and chin
    const gaiter = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.1, 0.15, 14), maskMat);
    gaiter.position.y = -0.09;
    head.add(gaiter);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.117, 14, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.22), maskMat));
  }
  if (o.top === 'hoodie') {
    // Hood down on the back, two drawstrings and a front pocket
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), jacket);
    hood.position.set(0.13, 0.47, 0);
    hood.rotation.z = -1.2;
    hood.scale.set(0.8, 0.55, 1.2); // lies flat between the shoulders
    spine.add(hood);
    for (const z of [-0.045, 0.045]) {
      const str = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.17, 4), mat(0xf5f5f5));
      str.position.set(-0.145, 0.38, z);
      spine.add(str);
    }
    const pocket = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.22), jacket);
    pocket.position.set(-0.14, 0.13, 0);
    spine.add(pocket);
  } else {
    // Jacket collar and a front zip
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.1, 0.08, 12), jacket);
    collar.position.y = 0.5;
    spine.add(collar);
    const zip = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.42, 0.015), mat(0x111111));
    zip.position.set(-0.142, 0.25, 0);
    spine.add(zip);
  }
  const headColor = mat(C('head', o.head));
  if (o.headwear === 'beanie') {
    const hat = new THREE.Mesh(new THREE.SphereGeometry(0.122, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.9), headColor);
    hat.position.y = 0.02; hat.scale.y = 1.15;
    head.add(hat);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.045, 14), headColor);
    cuff.position.y = 0.03;
    head.add(cuff);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), mat(0xffffff));
    pom.position.y = 0.175;
    head.add(pom);
  } else {
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.132, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), headColor);
    helmet.position.y = 0.012;
    head.add(helmet);
    for (const z of [-0.118, 0.118]) {   // ear pads
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), headColor);
      pad.position.set(0.01, -0.035, z); pad.scale.z = 0.5;
      head.add(pad);
    }
  }
  const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.119, 0.119, 0.035, 14, 1, true), mat(0x111111));
  strap.position.y = 0.012;
  head.add(strap);
  const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.18), new THREE.MeshLambertMaterial({
    color: C('lens', o.lens), emissive: C('lens', o.lens), emissiveIntensity: 0.25 }));
  goggles.position.set(-0.098, 0.012, 0);
  head.add(goggles);
  if (o.pack) {
    // Avalanche airbag pack, with the red trigger handle on the shoulder strap.
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, 0.27), mat(0xd84315));
    pack.position.set(0.19, 0.28, 0);
    spine.add(pack);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.04), mat(0xff1744));
    handle.position.set(-0.13, 0.38, 0.1);
    spine.add(handle);
  }
  return { root, lean, fig, feet, board: boardGroup, pelvis, spine, head, legs, arms,
    halfWidth: w, up: new THREE.Vector3(0, 1, 0) };
}
