// Ponts modélisés à part (outils/ponts : un JSON par pont, tiré du relevé laser et de photos), au niveau de détail de
// swissBUILDINGS3D : tablier, culées, piles, arches. Ils remplacent le pont reconstruit automatiquement à leur place.
import * as THREE from "three";

const BASE = `${import.meta.env.BASE_URL}ponts/`;
let index = null;

/** Ponts modélisés qui touchent le carré de demi-côté `R` autour de (E0, N0). */
export async function pontsAutour(E0, N0, R) {
  index ||= fetch(BASE + "index.json").then(r => r.ok ? r.json() : []).catch(() => []);
  const liste = (await index).filter(p => p.boite[2] > E0 - R && p.boite[0] < E0 + R && p.boite[3] > N0 - R && p.boite[1] < N0 + R);
  return (await Promise.all(liste.map(p => fetch(BASE + p.fichier).then(r => r.ok ? r.json() : null).catch(() => null)))).filter(Boolean);
}

/** Le pont occupe-t-il (x, y) (relatif au centre E0, N0) ? Tablier et 2 m de marge : pour effacer le pont automatique. */
export function dansPont(P, E0, N0, x, y) {
  const a = P.axe;
  for (let i = 0; i < a.length - 1; i++) {
    const ax = a[i][0] - E0, ay = a[i][1] - N0, bx = a[i + 1][0] - E0, by = a[i + 1][1] - N0, L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(-0.05, Math.min(1.05, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2));
    if (Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) < P.largeur / 2 + 2) return true;
  }
  return false;
}

/**
 * Maillage d'un pont modélisé, dans le repère de la scène (x est, y = altitude - zRef, z = -nord).
 * `sol(x, y)` : altitude du terrain (relative au centre) pour le pied des culées ; `uvPlan(x, y)` : coordonnées du plan
 * au sol (cadastre, photo) pour le dessus de la chaussée, qui prend la matière du terrain.
 * Renvoie { dessus, reste } : la chaussée (avec uv) et tout le reste (tablier, appuis, arches).
 */
export function maillagePont(P, E0, N0, zRef, sol, uvPlan = () => [0, 0]) {
  const a = P.axe.map(([e, n, z]) => [e - E0, n - N0, z]), s = [0];
  for (let i = 1; i < a.length; i++) s.push(s[i - 1] + Math.hypot(a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]));
  const L = s.at(-1);
  // point de l'axe à la distance t : position, altitude de la chaussée, direction
  const surAxe = t => {
    let i = 0; while (i < a.length - 2 && t > s[i + 1]) i++;
    const u = (t - s[i]) / ((s[i + 1] - s[i]) || 1), dx = a[i + 1][0] - a[i][0], dy = a[i + 1][1] - a[i][1], l = Math.hypot(dx, dy) || 1;
    return { x: a[i][0] + dx * u, y: a[i][1] + dy * u, z: a[i][2] + (a[i + 1][2] - a[i][2]) * u, ux: dx / l, uy: dy / l };
  };
  const pos = [], posD = [], uvD = [];
  const v = (x, y, z) => [x, z - zRef, -y];
  // dessus de la chaussée : une seule face, vers le haut, avec les coordonnées du plan au sol
  // deux faces : selon le sens de l'axe, la face « avant » regardait vers le bas (trous vus d'en haut)
  const chaussee = (p, q, r, w) => { for (const c of [p, r, q, p, w, r, p, q, r, p, r, w]) { posD.push(...v(...c)); uvD.push(...uvPlan(c[0], c[1])); } };
  // quadrilatère (quatre sommets [x, y, z] dans l'ordre) en deux triangles, les deux faces
  const quad = (p, q, r, w) => pos.push(...v(...p), ...v(...q), ...v(...r), ...v(...p), ...v(...r), ...v(...w), ...v(...p), ...v(...r), ...v(...q), ...v(...p), ...v(...w), ...v(...r));
  // volume balayé le long de l'axe entre t0 et t1 : en travers de largeur `l`, du bas `bas(t)` au haut `haut(t)`
  const balaye = (t0, t1, l, bas, haut, pas = 2, route = false) => {
    const n = Math.max(1, Math.ceil((t1 - t0) / pas)), coupe = t => {
      const A = surAxe(t), nx = -A.uy * l / 2, ny = A.ux * l / 2, b = bas(t), h = haut(t);
      // chaussée : aux bouts, chaque arête rejoint le terrain là où elle se pose (raccord sans marche)
      const hg = route ? raccord(A.x + nx, A.y + ny, t, h) : h, hd = route ? raccord(A.x - nx, A.y - ny, t, h) : h;
      return [[A.x + nx, A.y + ny, Math.min(b, hg - 0.3)], [A.x - nx, A.y - ny, Math.min(b, hd - 0.3)], [A.x - nx, A.y - ny, hd], [A.x + nx, A.y + ny, hg]];
    };
    let avant = coupe(t0);
    quad(...avant);
    for (let k = 1; k <= n; k++) {
      const c = coupe(t0 + (t1 - t0) * k / n);
      for (let f = 0; f < 4; f++) (route && f === 2 ? chaussee : quad)(avant[f], c[f], c[(f + 1) % 4], avant[(f + 1) % 4]);
      avant = c;
    }
    quad(...avant);
  };
  const ep = P.epaisseur || 1, dessus = t => surAxe(t).z, dessous = t => surAxe(t).z - ep;
  // raccord au terrain : sur les 6 derniers mètres de chaque bout, le dessus glisse vers l'altitude du terrain mesurée
  // sous l'arête (si elle est proche : moins de 2,5 m d'écart, sinon le terrain est le fond de la vallée)
  const RACCORD = 6, raccord = (x, y, t, h) => {
    const d = Math.min(t, L - t);
    if (d >= RACCORD) return h;
    const z = sol(x, y);
    if (!(Math.abs(z - h) < 2.5)) return h;
    const w = 1 - d / RACCORD, f = w * w * (3 - 2 * w);
    return h + (z - h) * f;
  };
  // tablier
  balaye(0, Math.min(RACCORD, L / 2), P.largeur, dessous, dessus, 1, true);
  balaye(Math.min(RACCORD, L / 2), Math.max(L / 2, L - RACCORD), P.largeur, dessous, dessus, 2, true);
  balaye(Math.max(L / 2, L - RACCORD), L, P.largeur, dessous, dessus, 1, true);
  // arches : arc parabolique de la naissance à la clé ; pleines (maçonnerie jusqu'au tablier) ou arc porteur et montants
  const arcs = P.arches || [];
  for (const A of arcs) {
    const zA = t => { const u = (2 * (t - A.s0) / ((A.s1 - A.s0) || 1)) - 1; return A.z_naissance + (A.z_cle - A.z_naissance) * (1 - u * u); };
    const e = A.epaisseur || 1, l = A.larg || P.largeur * 0.85;
    if (A.plein) balaye(A.s0, A.s1, l, zA, dessous, 1.5);
    else {
      balaye(A.s0, A.s1, l, zA, t => zA(t) + e, 1.5);
      // montants : un tous les ~7 m entre l'arc et le tablier
      const nb = Math.max(1, Math.round((A.s1 - A.s0) / 7));
      for (let k = 1; k < nb; k++) {
        const t = A.s0 + (A.s1 - A.s0) * k / nb;
        if (dessous(t) - (zA(t) + e) > 0.6) balaye(t - 0.3, t + 0.3, l, t2 => zA(t2) + e, dessous, 1);
      }
    }
  }
  // culées et piles
  for (const p of P.appuis || []) {
    const t = Math.max(0, Math.min(L, p.s)), A = surAxe(t);
    if (p.type === "culee") {
      // bloc de 4 m vers l'extérieur, du tablier au terrain (ou aux naissances des arches voisines)
      const dehors = t < L / 2 ? -1 : 1, t0 = t < L / 2 ? t : t - 4, t1 = t0 + 4;
      const zs = sol(A.x + A.ux * 2 * dehors, A.y + A.uy * 2 * dehors), naiss = Math.min(...arcs.map(x => x.z_naissance), Infinity);
      const bas = Math.min(isNaN(zs) ? naiss : zs, naiss) - 1;
      if (bas < dessous(t) - 0.5) balaye(Math.max(0, t0), Math.min(L, t1), P.largeur, () => bas, dessous, 4);
      continue;
    }
    const lo = p.long || 3, la = p.larg || P.largeur * 0.8, zb = p.z_bas ?? sol(A.x, A.y) - 1, fr = p.fruit || 0;
    if (p.forme === "rond") {
      const r = Math.min(lo, la) / 2, h = dessous(t) - zb, n = 16;
      for (let k = 0; k < n; k++) {
        const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2, rb = r + fr * h;
        quad([A.x + Math.cos(a0) * rb, A.y + Math.sin(a0) * rb, zb], [A.x + Math.cos(a1) * rb, A.y + Math.sin(a1) * rb, zb],
          [A.x + Math.cos(a1) * r, A.y + Math.sin(a1) * r, dessous(t)], [A.x + Math.cos(a0) * r, A.y + Math.sin(a0) * r, dessous(t)]);
      }
    } else balaye(t - lo / 2, t + lo / 2, la, () => zb, dessous, lo);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const d = new THREE.BufferGeometry();
  d.setAttribute("position", new THREE.Float32BufferAttribute(posD, 3));
  d.setAttribute("uv", new THREE.Float32BufferAttribute(uvD, 2));
  d.computeVertexNormals();
  return { dessus: d, reste: g };
}
