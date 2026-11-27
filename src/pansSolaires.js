// Pans de toit utilisables pour des panneaux solaires, et implantation des modules. Sans three.js ni DOM.
//
// Un pan = cellules de la grille de 0,5 m (G) qu'il couvre en plan, et son plan z = a·x + b·y + d (x est, y nord, en
// mètres relatifs au centre de la maquette ; z altitude). Deux sources :
//  - bâtiment du relevé : pans de pans.js (plans ajustés sur le nuage de points), regroupés par bâtiment ;
//  - volume dessiné (Pro) : triangles du toit de son maillage, regroupés par plan, rastérisés sur la grille.
// Implantation : modules en rangées alignées sur la pente (toit en pente) ou sur la façade la plus proche du sud
// (toit plat : modules relevés à 15° plein sud, ou 10° est-ouest dos à dos), à une distance `marge` des bords du pan.
import { MODULE } from "./solairePV.js";

const RAD = Math.PI / 180;

/** Inclinaison (°) et azimut (° depuis le nord, sens horaire, côté vers lequel le pan descend) d'un plan a·x + b·y + d. */
export function orientationPlan(a, b) {
  const pente = Math.hypot(a, b);
  return { inclinaison: Math.atan(pente) / RAD, azimut: pente < 1e-6 ? 180 : (Math.atan2(-a, -b) / RAD + 360) % 360 };
}

function decrire(G, cellules, [a, b, d], extra = {}) {
  const { inclinaison, azimut } = orientationPlan(a, b), c = G.c;
  return { cellules: Int32Array.from(cellules), plan: [a, b, d], inclinaison, azimut, emprise: cellules.length * c * c, aire: cellules.length * c * c / Math.cos(inclinaison * RAD), ...extra };
}

/**
 * Pans des volumes `segs` (numéros de volumes de contours.js) d'après pans.js.
 * @param P résultat de pansToits(G, C) ; @returns pans triés par aire décroissante
 */
export function pansReleve(G, P, segs, { aireMin = 3 } = {}) {
  const parPan = new Map(), N = G.n * G.n;
  for (let p = 0; p < N; p++) {
    const k = P.pan[p];
    if (k < 0 || !segs.has(P.volume[k])) continue;
    let l = parPan.get(k);
    if (!l) parPan.set(k, l = []);
    l.push(p);
  }
  const pans = [];
  for (const [k, l] of parPan) {
    const pan = decrire(G, l, P.plans[k], { id: `r${k}`, volume: P.volume[k] });
    if (pan.aire >= aireMin && pan.inclinaison <= 65) pans.push(pan);
  }
  return pans.sort((x, y) => y.aire - x.aire);
}

/**
 * Pans d'un toit donné par ses triangles (x, y, z en mètres relatifs / altitude) : regroupés par plan (normales à
 * moins de 2°, plans à moins de 5 cm), puis rastérisés (centre de cellule dans un triangle du groupe).
 * @param tri tableau plat [x0, y0, z0, x1, y1, z1, x2, y2, z2, …]
 */
export function pansMaillage(G, tri, { aireMin = 3, id = "v" } = {}) {
  const groupes = [];
  for (let t = 0; t < tri.length; t += 9) {
    const [x0, y0, z0, x1, y1, z1, x2, y2, z2] = tri.slice(t, t + 9);
    const ux = x1 - x0, uy = y1 - y0, uz = z1 - z0, vx = x2 - x0, vy = y2 - y0, vz = z2 - z0;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) continue;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nx /= l; ny /= l; nz /= l;
    if (nz < Math.cos(70 * RAD)) continue; // mur ou pignon
    const a = -nx / nz, b = -ny / nz, d = z0 - a * x0 - b * y0;
    let g = groupes.find(q => q.n[0] * nx + q.n[1] * ny + q.n[2] * nz > Math.cos(2 * RAD) && Math.abs(q.a * x0 + q.b * y0 + q.d - z0) < 0.05);
    if (!g) groupes.push(g = { n: [nx, ny, nz], a, b, d, tris: [] });
    g.tris.push([x0, y0, x1, y1, x2, y2]);
  }
  const { n, c, x0: X0 } = G, pans = [];
  groupes.forEach((g, k) => {
    const cellules = new Set();
    for (const [ax, ay, bx, by, cx, cy] of g.tris) {
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - X0) / c)), i1 = Math.min(n - 1, Math.floor((Math.max(ax, bx, cx) - X0) / c));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - X0) / c)), j1 = Math.min(n - 1, Math.floor((Math.max(ay, by, cy) - X0) / c));
      const s = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
      const aire = s(ax, ay, bx, by, cx, cy);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = X0 + (i + 0.5) * c, y = X0 + (j + 0.5) * c;
        const w0 = s(bx, by, cx, cy, x, y), w1 = s(cx, cy, ax, ay, x, y), w2 = s(ax, ay, bx, by, x, y);
        if (aire > 0 ? w0 >= 0 && w1 >= 0 && w2 >= 0 : w0 <= 0 && w1 <= 0 && w2 <= 0) cellules.add(j * n + i);
      }
    }
    if (!cellules.size) return;
    const pan = decrire(G, [...cellules].sort((p, q) => p - q), [g.a, g.b, g.d], { id: `${id}-${k}` });
    if (pan.aire >= aireMin) pans.push(pan);
  });
  return pans.sort((x, y) => y.aire - x.aire);
}

/** Hauteur du plan d'un pan en (x, y). */
export const zPan = (pan, x, y) => pan.plan[0] * x + pan.plan[1] * y + pan.plan[2];

/**
 * Implantation des modules sur un pan.
 * @param o { marge (m, en plan, depuis le bord du pan), plat: "sud" | "eo", orientationPlat (° : azimut de la façade
 *   la plus proche du sud, pour aligner les rangées), espace (m entre modules), module (MODULE) }
 * @returns {{ modules: { coins: number[][] (4 × [x, y, z]), centre: [x, y], inclinaison, azimut }[], disposition }}
 */
export function implanter(G, pan, o = {}) {
  const { marge = 0.5, plat = "sud", orientationPlat = 180, espace = 0.02, module = MODULE } = o;
  const { n, c, x0: X0 } = G;
  // masque du pan, érodé de la marge (disque)
  const dans = new Set(pan.cellules);
  const r = Math.max(0, Math.round(marge / c)), noyau = [];
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (Math.hypot(di, dj) <= r + 0.01) noyau.push([di, dj]);
  const ok = new Set();
  for (const p of pan.cellules) {
    const i = p % n, j = (p - i) / n;
    if (noyau.every(([di, dj]) => { const a = i + di, b = j + dj; return a >= 0 && b >= 0 && a < n && b < n && dans.has(b * n + a); })) ok.add(p);
  }
  if (!ok.size) return { modules: [], disposition: null };
  const libre = (x, y) => {
    const i = Math.floor((x - X0) / c), j = Math.floor((y - X0) / c);
    return i >= 0 && j >= 0 && i < n && j < n && ok.has(j * n + i);
  };
  const estPlat = pan.inclinaison < 5;
  // axes en plan : d = sens de la pente (vers le bas, côté exposé), u = le long des rangées
  const az = estPlat ? orientationPlat : pan.azimut;
  const d = [Math.sin(az * RAD), Math.cos(az * RAD)], u = [d[1], -d[0]];
  // dispositions candidates : { largeur (le long de u), rangee (pas des rangées, en plan, selon d), elements (modules d'une
  // rangée selon d : [décalage en plan, profondeur en plan, inclinaison, azimut]) }
  const cands = [];
  if (!estPlat) {
    const cb = Math.cos(pan.inclinaison * RAD);
    for (const [Lu, Ld, nom] of [[module.l, module.L, "portrait"], [module.L, module.l, "paysage"]])
      cands.push({ nom, largeur: Lu, rangee: (Ld + espace) * cb, elements: [[0, Ld * cb, pan.inclinaison, pan.azimut]] });
  } else if (plat === "eo") {
    const b = 10, p = module.l * Math.cos(b * RAD);
    cands.push({ nom: "eo", largeur: module.L, rangee: 2 * p + 0.3, elements: [[0, p, b, (az + 90) % 360], [p, p, b, (az + 270) % 360]] });
  } else {
    const b = 15, p = module.l * Math.cos(b * RAD), h = module.l * Math.sin(b * RAD);
    // rangées espacées pour que le soleil à 18° de hauteur passe par-dessus la rangée de devant
    cands.push({ nom: "sud", largeur: module.L, rangee: p + h / Math.tan(18 * RAD), elements: [[0, p, b, az]] });
  }
  // étendue du pan dans le repère (u, d)
  let umin = Infinity, umax = -Infinity, dmin = Infinity, dmax = -Infinity;
  for (const p of ok) {
    const x = X0 + (p % n + 0.5) * c, y = X0 + (Math.floor(p / n) + 0.5) * c, pu = x * u[0] + y * u[1], pd = x * d[0] + y * d[1];
    umin = Math.min(umin, pu); umax = Math.max(umax, pu); dmin = Math.min(dmin, pd); dmax = Math.max(dmax, pd);
  }
  umin -= c; dmin -= c; umax += c; dmax += c;
  const versXY = (pu, pd) => [pu * u[0] + pd * d[0], pu * u[1] + pd * d[1]];
  const rectLibre = (u0, u1, d0, d1) => {
    const nu = Math.max(2, Math.ceil((u1 - u0) / 0.25) + 1), nd = Math.max(2, Math.ceil((d1 - d0) / 0.25) + 1);
    for (let a = 0; a < nu; a++) for (let b = 0; b < nd; b++) {
      const [x, y] = versXY(u0 + (u1 - u0) * a / (nu - 1), d0 + (d1 - d0) * b / (nd - 1));
      if (!libre(x, y)) return false;
    }
    return true;
  };
  let meilleur = { modules: [], disposition: null };
  for (const C of cands) {
    const pasU = C.largeur + espace, prof = C.elements.reduce((m, e) => Math.max(m, e[0] + e[1]), 0);
    for (let ou = 0; ou < 4; ou++) for (let od = 0; od < 4; od++) {
      const mods = [];
      for (let d0 = dmin + od * C.rangee / 4; d0 + prof <= dmax; d0 += C.rangee) {
        for (let u0 = umin + ou * pasU / 4; u0 + C.largeur <= umax; u0 += pasU) {
          if (!rectLibre(u0, u0 + C.largeur, d0, d0 + prof)) continue;
          for (const [dec, p, b, azm] of C.elements) {
            const coins = [[u0, d0 + dec], [u0 + C.largeur, d0 + dec], [u0 + C.largeur, d0 + dec + p], [u0, d0 + dec + p]].map(([a, e]) => versXY(a, e));
            // altitude des coins : sur le plan du toit (+ 12 cm de pose) ; toit plat : bord bas à 15 cm, bord haut relevé
            const zs = coins.map(([x, y]) => zPan(pan, x, y) + 0.12);
            if (estPlat) {
              const haut = module.l * Math.sin(b * RAD);
              // le bord haut est celui qui est à l'opposé du côté exposé (azimut azm)
              const dirm = [Math.sin(azm * RAD), Math.cos(azm * RAD)], proj = coins.map(([x, y]) => x * dirm[0] + y * dirm[1]), pmin = Math.min(...proj);
              coins.forEach((q, k) => { if (proj[k] - pmin < 0.01) zs[k] += haut; });
            }
            mods.push({ coins: coins.map(([x, y], k) => [x, y, zs[k]]), centre: [coins.reduce((s, q) => s + q[0], 0) / 4, coins.reduce((s, q) => s + q[1], 0) / 4], inclinaison: b, azimut: azm });
          }
        }
      }
      if (mods.length > meilleur.modules.length) meilleur = { modules: mods, disposition: C.nom };
    }
  }
  return meilleur;
}

/**
 * Points de calcul d'un pan (centres de cellules, un sur `pas` dans chaque direction), à `hauteur` m au-dessus du plan.
 * @returns {{ xy: number[][], z: number[], cellules: number[] }}
 */
export function pointsPan(G, pan, pas = 1, hauteur = 0.15) {
  const { n, c, x0 } = G, xy = [], z = [], cellules = [];
  for (const p of pan.cellules) {
    const i = p % n, j = (p - i) / n;
    if (pas > 1 && (i % pas || j % pas)) continue;
    const x = x0 + (i + 0.5) * c, y = x0 + (j + 0.5) * c;
    xy.push([x, y]); z.push(zPan(pan, x, y) + hauteur); cellules.push(p);
  }
  if (!xy.length) { const p = pan.cellules[0], x = x0 + (p % n + 0.5) * c, y = x0 + (Math.floor(p / n) + 0.5) * c; xy.push([x, y]); z.push(zPan(pan, x, y) + hauteur); cellules.push(p); }
  return { xy, z, cellules };
}

/** Le point (x, y) est-il sous le module (polygone convexe de ses coins en plan) ? */
export function sousModule(m, x, y) {
  const C = m.coins;
  let signe = 0;
  for (let k = 0; k < 4; k++) {
    const [ax, ay] = C[k], [bx, by] = C[(k + 1) % 4], s = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(s) < 1e-9) continue;
    if (!signe) signe = Math.sign(s); else if (Math.sign(s) !== signe) return false;
  }
  return true;
}
