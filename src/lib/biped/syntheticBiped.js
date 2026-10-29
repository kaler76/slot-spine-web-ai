// src/lib/biped/syntheticBiped.js — personaggio SINTETICO "nato per Spine" (capsule colorate
// con contorno), mezzo busto o figura intera. Serve a collaudare rig e animazioni senza
// generazioni AI: stesso formato del kit che produrrà il generatore (pezzi separati in posa
// neutra, articolazioni con estremità tonde sovrapposte, viso separato, bocca con varianti,
// capelli e mantello a catena, spada in mano, bagliore della magia).
// Puro: restituisce i pixel RGBA, nessun DOM.

const SKIN = [242, 200, 168], SHIRT = [52, 96, 200], PANTS = [48, 52, 70], HAIR = [120, 60, 30], CAPE = [170, 30, 50], METAL = [200, 210, 225], GOLD = [220, 170, 40], DARK = [30, 20, 25], WHITE = [250, 250, 250];

const segSdf = (x, y, a, b, r) => {
  const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / l2));
  return Math.hypot(x - (a.x + t * vx), y - (a.y + t * vy)) - r;
};
const ellSdf = (x, y, c, rx, ry) => (Math.hypot((x - c.x) / rx, (y - c.y) / ry) - 1) * Math.min(rx, ry);
const boxSdf = (x, y, x0, y0, x1, y1, r = 0) => {
  const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1);
  const inside = Math.min(Math.max(x0 - x, x - x1), Math.max(y0 - y, y - y1));
  return (dx || dy ? Math.hypot(dx, dy) : inside) - r;
};

/** Disegna una sagoma (sdf < 0) con contorno nero di 3 px nel riquadro dato. */
function paint(box, layers) {
  const x0 = Math.floor(box.x0), y0 = Math.floor(box.y0);
  const w = Math.ceil(box.x1) - x0, h = Math.ceil(box.y1) - y0;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = x + x0 + 0.5, py = y + y0 + 0.5;
      for (const L of layers) {
        const d = L.sdf(px, py);
        if (d < 0) {
          const ink = L.outline !== false && d > -3;
          const col = ink ? DARK : typeof L.color === "function" ? L.color(px, py, d) : L.color;
          const i = (y * w + x) * 4;
          rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = col[3] ?? 255;
        }
      }
    }
  return { x: x0, y: y0, width: w, height: h, rgba };
}
const boxOf = (pts, m) => ({ x0: Math.min(...pts.map((p) => p.x)) - m, y0: Math.min(...pts.map((p) => p.y)) - m, x1: Math.max(...pts.map((p) => p.x)) + m, y1: Math.max(...pts.map((p) => p.y)) + m });
const shade = (c, f) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));

/**
 * @param {{ body?: "bust"|"full", weapon?: boolean, fxColor?: number[] }} opt
 * @returns {{ kit, images: Object<string, {width,height,rgba}> }}
 */
export function syntheticBipedKit(opt = {}) {
  const body = opt.body === "full" ? "full" : "bust";
  const F = body === "full";
  const P = F
    ? { crown: { x: 300, y: 60 }, neck: { x: 300, y: 235 }, waist: { x: 300, y: 430 }, pelvis: { x: 300, y: 485 }, face_center: { x: 300, y: 150 } }
    : { crown: { x: 300, y: 60 }, neck: { x: 300, y: 250 }, waist: { x: 300, y: 540 }, face_center: { x: 300, y: 158 } };
  const sy = P.neck.y + 22;
  Object.assign(P, {
    shoulder_sx: { x: 378, y: sy }, elbow_sx: { x: 420, y: sy + 105 }, wrist_sx: { x: 446, y: sy + 200 }, fingertip_sx: { x: 455, y: sy + 255 },
    shoulder_dx: { x: 222, y: sy }, elbow_dx: { x: 180, y: sy + 105 }, wrist_dx: { x: 154, y: sy + 200 }, fingertip_dx: { x: 145, y: sy + 255 }
  });
  if (F) Object.assign(P, {
    hip_sx: { x: 335, y: 495 }, knee_sx: { x: 348, y: 660 }, ankle_sx: { x: 342, y: 820 }, toe_sx: { x: 380, y: 840 },
    hip_dx: { x: 265, y: 495 }, knee_dx: { x: 252, y: 660 }, ankle_dx: { x: 258, y: 820 }, toe_dx: { x: 220, y: 840 }
  });

  const images = {};
  const parts = [];
  const add = (name, role, img, extra = {}) => {
    images[name] = { width: img.width, height: img.height, rgba: img.rgba };
    parts.push({ name, role, x: img.x, y: img.y, width: img.width, height: img.height, ...extra });
  };
  const capsule = (a, b, r, color) => paint(boxOf([a, b], r + 2), [{ sdf: (x, y) => segSdf(x, y, a, b, r), color: (x, y, d) => shade(color, 1 - Math.min(0.18, Math.max(0, d + r * 0.4) / (r * 3))) }]);

  // busto: trapezio arrotondato dalle spalle alla vita (con colletto)
  const tb = { x0: P.shoulder_dx.x - 30, y0: P.neck.y - 18, x1: P.shoulder_sx.x + 30, y1: P.waist.y + 20 };
  add("torso", "torso", paint(tb, [
    { sdf: (x, y) => segSdf(x, y, P.neck, { x: P.neck.x, y: P.neck.y + 30 }, 22), color: SKIN },
    { sdf: (x, y) => Math.max(boxSdf(x, y, tb.x0 + 6, P.neck.y + 10, tb.x1 - 6, P.waist.y + 14, 26), Math.abs(x - P.waist.x) - (70 + (P.waist.y + 14 - y) * 0.16)), color: (x, y) => (Math.abs(x - P.waist.x) < 6 ? GOLD : SHIRT) }
  ]));
  if (F) add("pelvis", "pelvis", paint({ x0: 228, y0: 405, x1: 372, y1: 540 }, [{ sdf: (x, y) => boxSdf(x, y, 236, 412, 364, 530, 22), color: PANTS }]));

  for (const side of ["sx", "dx"]) {
    add(`upper_arm_${side}`, "upper_arm", capsule(P[`shoulder_${side}`], P[`elbow_${side}`], 25, SHIRT), { side });
    add(`forearm_${side}`, "forearm", capsule(P[`elbow_${side}`], P[`wrist_${side}`], 20, SKIN), { side });
    add(`hand_${side}`, "hand", capsule(P[`wrist_${side}`], P[`fingertip_${side}`], 19, SKIN), { side });
    if (F) {
      add(`thigh_${side}`, "thigh", capsule(P[`hip_${side}`], P[`knee_${side}`], 30, PANTS), { side });
      add(`shin_${side}`, "shin", capsule(P[`knee_${side}`], P[`ankle_${side}`], 24, PANTS), { side });
      const a = P[`ankle_${side}`], t = P[`toe_${side}`];
      add(`foot_${side}`, "foot", paint(boxOf([a, t], 24), [{ sdf: (x, y) => segSdf(x, y, a, t, 18), color: DARK.map((v) => v + 40) }]), { side });
    }
  }

  // testa senza tratti (pelle liscia + palpebre chiuse dipinte sotto gli occhi)
  const hc = { x: P.face_center.x, y: P.face_center.y };
  const eyeY = hc.y - 4, eyeDx = 36;
  add("head", "head", paint({ x0: hc.x - 100, y0: P.crown.y - 6, x1: hc.x + 100, y1: P.neck.y + 12 }, [
    { sdf: (x, y) => ellSdf(x, y, { x: hc.x, y: hc.y + 6 }, 88, 98), color: SKIN },
    { sdf: (x, y) => Math.max(ellSdf(x, y, { x: hc.x, y: hc.y - 30 }, 92, 66), y - (hc.y - 40)), color: HAIR },
    { sdf: (x, y) => Math.min(segSdf(x, y, { x: hc.x - eyeDx - 12, y: eyeY }, { x: hc.x - eyeDx + 12, y: eyeY }, 2), segSdf(x, y, { x: hc.x + eyeDx - 12, y: eyeY }, { x: hc.x + eyeDx + 12, y: eyeY }, 2)), color: DARK, outline: false }
  ]));
  for (const [side, sx] of [["sx", 1], ["dx", -1]]) {
    const c = { x: hc.x + sx * eyeDx, y: eyeY };
    add(`eye_${side}`, "eye", paint({ x0: c.x - 18, y0: c.y - 18, x1: c.x + 18, y1: c.y + 18 }, [
      { sdf: (x, y) => ellSdf(x, y, c, 15, 16), color: WHITE },
      { sdf: (x, y) => ellSdf(x, y, { x: c.x, y: c.y + 2 }, 7, 8), color: DARK, outline: false }
    ]), { side });
    const bc = { x: c.x, y: c.y - 30 };
    add(`brow_${side}`, "brow", paint({ x0: bc.x - 22, y0: bc.y - 8, x1: bc.x + 22, y1: bc.y + 8 }, [{ sdf: (x, y) => boxSdf(x, y, bc.x - 18, bc.y - 3, bc.x + 18, bc.y + 3, 2), color: HAIR, outline: false }]), { side });
  }
  const mc = { x: hc.x, y: hc.y + 50 };
  const mouthBox = { x0: mc.x - 30, y0: mc.y - 22, x1: mc.x + 30, y1: mc.y + 22 };
  const MOUTH = {
    neutral: [{ sdf: (x, y) => boxSdf(x, y, mc.x - 18, mc.y - 2, mc.x + 18, mc.y + 2, 1), color: DARK, outline: false }],
    open: [{ sdf: (x, y) => ellSdf(x, y, mc, 22, 16), color: [150, 40, 50] }],
    o: [{ sdf: (x, y) => ellSdf(x, y, mc, 11, 14), color: [150, 40, 50] }],
    smile: [{ sdf: (x, y) => Math.max(Math.abs(Math.hypot(x - mc.x, y - (mc.y - 18)) - 22) - 2.5, mc.y - 6 - y), color: DARK, outline: false }],
    sad: [{ sdf: (x, y) => Math.max(Math.abs(Math.hypot(x - mc.x, y - (mc.y + 22)) - 22) - 2.5, y - (mc.y + 6)), color: DARK, outline: false }]
  };
  const variants = {};
  for (const [v, layers] of Object.entries(MOUTH)) {
    const img = paint(mouthBox, layers);
    const name = `mouth_${v}`;
    images[name] = { width: img.width, height: img.height, rgba: img.rgba };
    variants[v] = { name, x: img.x, y: img.y, width: img.width, height: img.height };
  }
  parts.push({ name: "mouth", role: "mouth", variants });

  // capelli dietro (catena) e mantello (catena)
  const hairPts = [{ x: hc.x, y: P.crown.y + 40 }, { x: hc.x, y: P.neck.y + 30 }, { x: hc.x + 6, y: P.neck.y + 130 }];
  const hb = { x0: hc.x - 92, y0: P.crown.y + 20, x1: hc.x + 92, y1: P.neck.y + 150 };
  add("hair_back", "chain", paint(hb, [{ sdf: (x, y) => boxSdf(x, y, hb.x0 + 6, hb.y0 + 4, hb.x1 - 6, hb.y1 - 6, 40), color: shade(HAIR, 0.85) }]), { kind: "hair", layer: "hair_back", points: hairPts });
  const capeTop = P.neck.y + 30, capeLen = F ? 430 : 300;
  const cb = { x0: P.shoulder_dx.x - 40, y0: capeTop - 10, x1: P.shoulder_sx.x + 40, y1: capeTop + capeLen };
  add("cape", "chain", paint(cb, [{ sdf: (x, y) => Math.max(boxSdf(x, y, cb.x0 + 6, cb.y0 + 6, cb.x1 - 6, cb.y1 - 4, 18), Math.abs(x - P.neck.x) - (95 + (y - cb.y0) * 0.22)), color: CAPE }]), { kind: "cape", points: [{ x: P.neck.x, y: capeTop }, { x: P.neck.x, y: capeTop + capeLen - 20 }] });

  // spada nella mano dx, punta in alto
  if (opt.weapon !== false) {
    const w = P.wrist_dx, f = P.fingertip_dx;
    const g = { x: (w.x + f.x) / 2, y: (w.y + f.y) / 2 };
    const sb = { x0: g.x - 34, y0: g.y - 260, x1: g.x + 34, y1: g.y + 40 };
    add("sword", "prop", paint(sb, [
      { sdf: (x, y) => segSdf(x, y, { x: g.x, y: g.y + 26 }, { x: g.x, y: g.y - 10 }, 7), color: [90, 60, 40] },
      { sdf: (x, y) => boxSdf(x, y, g.x - 30, g.y - 22, g.x + 30, g.y - 12, 3), color: GOLD },
      { sdf: (x, y) => Math.max(boxSdf(x, y, g.x - 9, g.y - 245, g.x + 9, g.y - 22, 0), Math.abs(x - g.x) - (9 - Math.max(0, (g.y - 215 - y)) * 0.3)), color: (x) => (x < g.x ? METAL : shade(METAL, 0.8)) }
    ]), { side: "dx", grip: g });
  }
  // bagliore della magia su entrambe le mani (additivo, invisibile a riposo)
  const fxc = opt.fxColor || [80, 200, 255];
  for (const side of ["sx", "dx"]) {
    const R = 64;
    const rgba = new Uint8ClampedArray(R * 2 * R * 2 * 4);
    for (let y = 0; y < 2 * R; y++) for (let x = 0; x < 2 * R; x++) {
      const d = Math.hypot(x - R + 0.5, y - R + 0.5) / R;
      const a = Math.max(0, 1 - d) ** 2;
      const i = (y * 2 * R + x) * 4;
      rgba[i] = Math.min(255, fxc[0] + 120 * a); rgba[i + 1] = Math.min(255, fxc[1] + 60 * a); rgba[i + 2] = fxc[2]; rgba[i + 3] = Math.round(255 * a);
    }
    images[`glow_${side}`] = { width: 2 * R, height: 2 * R, rgba };
    parts.push({ name: `glow_${side}`, role: "fx", side, x: 0, y: 0, width: 2 * R, height: 2 * R });
  }

  const kit = { name: `sintetico_${body}`, body, points: P, ground: F ? 842 : undefined, parts };
  return { kit, images };
}
