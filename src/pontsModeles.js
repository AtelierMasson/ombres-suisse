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
  // volume balayé le long de l'axe entre t0 et t1 : en travers de largeur `l`, du bas `bas(t)` au haut `haut(t)`.
  // `o` : décalage en travers (nervures, garde-corps) ; `lb` : largeur du dessous (caisson plus étroit que la chaussée)
  const balaye = (t0, t1, l, bas, haut, pas = 2, route = false, { o = 0, lb = l } = {}) => {
    const n = Math.max(1, Math.ceil((t1 - t0) / pas)), coupe = t => {
      const A = surAxe(t), px = -A.uy, py = A.ux, cx = A.x + px * o, cy = A.y + py * o, b = bas(t), h = haut(t);
      const nx = px * l / 2, ny = py * l / 2, bx = px * lb / 2, by = py * lb / 2;
      // chaussée : aux bouts, chaque arête rejoint le terrain là où elle se pose (raccord sans marche)
      const hg = route ? raccord(cx + nx, cy + ny, t, h) : h, hd = route ? raccord(cx - nx, cy - ny, t, h) : h;
      return [[cx + bx, cy + by, Math.min(b, hg - 0.3)], [cx - bx, cy - by, Math.min(b, hd - 0.3)], [cx - nx, cy - ny, hd], [cx + nx, cy + ny, hg]];
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
  // épaisseur du tablier : constante, ou renforcée au droit des piles (goussets : `epaisseur_appuis` sur `gousset` m)
  const ep = P.epaisseur || 1, epA = P.epaisseur_appuis || ep, gousset = P.gousset || 0;
  const piles = (P.appuis || []).filter(p => p.type !== "culee").map(p => p.s);
  const epEn = t => {
    if (!(epA > ep && gousset > 0)) return ep;
    let f = 0;
    for (const s0 of piles) { const d = Math.abs(t - s0); if (d < gousset) f = Math.max(f, (1 - d / gousset) ** 2); }
    return ep + (epA - ep) * f;
  };
  const dessus = t => surAxe(t).z, dessous = t => surAxe(t).z - epEn(t);
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
  // tablier (caisson : dessous plus étroit, `largeur_dessous`)
  const tab = { lb: P.largeur_dessous || P.largeur };
  balaye(0, Math.min(RACCORD, L / 2), P.largeur, dessous, dessus, 1, true, tab);
  balaye(Math.min(RACCORD, L / 2), Math.max(L / 2, L - RACCORD), P.largeur, dessous, dessus, 2, true, tab);
  balaye(Math.max(L / 2, L - RACCORD), L, P.largeur, dessous, dessus, 1, true, tab);
  // garde-corps des deux bords : mur plein (parapet en pierre ou en béton) ou main courante et poteaux (ajouré)
  const GC = P.garde_corps;
  if (GC) {
    const h = GC.hauteur || 1.1, e = GC.epaisseur || (GC.plein ? 0.4 : 0.12), t0 = Math.min(RACCORD, L / 4), t1 = L - t0;
    for (const cote of [-1, 1]) {
      const o = cote * (P.largeur / 2 - e / 2);
      if (GC.plein) balaye(t0, t1, e, dessus, t => dessus(t) + h, 3, false, { o });
      else {
        balaye(t0, t1, e * 1.4, t => dessus(t) + h - 0.12, t => dessus(t) + h, 3, false, { o });
        const pasP = GC.pas || 2.5, nb = Math.max(1, Math.round((t1 - t0) / pasP));
        for (let k = 0; k <= nb; k++) { const t = t0 + (t1 - t0) * k / nb; balaye(t - e / 2, t + e / 2, e, dessus, u => dessus(u) + h, 1, false, { o }); }
      }
    }
  }
  // arches : arc parabolique de la naissance à la clé ; pleines (maçonnerie jusqu'au tablier) ou arc porteur et montants
  const arcs = P.arches || [];
  for (const A of arcs) {
    // forme de l'arc : parabole (par défaut), ou arc de cercle (`forme: "cintre"` : plein cintre ou arc surbaissé, de
    // rayon tiré de l'ouverture et de la flèche)
    const c = A.s1 - A.s0 || 1, f = Math.max(0.1, A.z_cle - A.z_naissance), Rc = (c * c / 4 + f * f) / (2 * f);
    // flèche plus grande que la demi-ouverture : plein cintre surhaussé (piédroits verticaux, puis demi-cercle)
    const zA = A.forme === "cintre" && f >= c / 2
      ? t => { const x = t - (A.s0 + A.s1) / 2, r = c / 2; return A.z_naissance + (f - r) + Math.sqrt(Math.max(0, r * r - x * x)); }
      : A.forme === "cintre"
      ? t => { const x = t - (A.s0 + A.s1) / 2; return A.z_naissance + Math.sqrt(Math.max(0, Rc * Rc - x * x)) - (Rc - f); }
      : A.s_cle != null
      // arc asymétrique : clé en `s_cle` (altitude `z_cle`), deux demi-paraboles jusqu'aux naissances, la seconde à
      // `z_naissance_fin` (versants de hauteurs différentes)
      ? t => {
        const avant = t <= A.s_cle, s0 = avant ? A.s0 : A.s1, zn = avant ? A.z_naissance : (A.z_naissance_fin ?? A.z_naissance);
        const u = (t - A.s_cle) / ((A.s_cle - s0) || 1);
        return A.z_cle - (A.z_cle - zn) * u * u;
      }
      : t => { const u = (2 * (t - A.s0) / c) - 1; return A.z_naissance + f * (1 - u * u); };
    const e = A.epaisseur || 1, l = A.larg || P.largeur * 0.85;
    if (A.plein) balaye(A.s0, A.s1, l, zA, dessous, 0.75);
    else {
      // arc porteur : une dalle, ou plusieurs nervures parallèles (`nervures`, `larg_nervure`) ; montants sur chacune
      const nN = Math.max(1, A.nervures || 1), lN = nN > 1 ? (A.larg_nervure || l / nN * 0.5) : l;
      const decal = k => nN > 1 ? -l / 2 + lN / 2 + k * (l - lN) / (nN - 1) : 0;
      const pasM = A.montants_pas || 7, nb = Math.max(1, Math.round((A.s1 - A.s0) / pasM)), eM = A.montant_ep || 0.6;
      for (let k = 0; k < nN; k++) {
        const o = decal(k);
        balaye(A.s0, A.s1, lN, zA, t => zA(t) + e, 1.5, false, { o });
        for (let j = 1; j < nb; j++) {
          const t = A.s0 + (A.s1 - A.s0) * j / nb;
          if (dessous(t) - (zA(t) + e) > 0.6) balaye(t - eM / 2, t + eM / 2, lN, t2 => zA(t2) + e, dessous, 1, false, { o });
        }
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
    } else {
      // pile rectangulaire (avec fruit : plus large en bas), ou deux colonnes (`forme: "double"`, `larg_colonne`)
      const colonnes = p.forme === "double" ? (() => { const lc = p.larg_colonne || la * 0.3; return [[-(la - lc) / 2, lc], [(la - lc) / 2, lc]]; })() : [[0, la]];
      for (const [o, lc] of colonnes) {
        const h = Math.max(0, dessous(t) - zb), dl = fr * h;
        // tronc de pyramide : sommet lo × lc, pied (lo + 2 dl) × (lc + 2 dl)
        const coin = (a, b, z, g) => { const L2 = (lo / 2 + g) * a, W = (lc / 2 + g) * b; return [A.x + A.ux * L2 - A.uy * (o + W), A.y + A.uy * L2 + A.ux * (o + W), z]; };
        const zh = dessous(t), bas4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => coin(a, b, zb, dl)), haut4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => coin(a, b, zh, 0));
        for (let f = 0; f < 4; f++) quad(bas4[f], bas4[(f + 1) % 4], haut4[(f + 1) % 4], haut4[f]);
        quad(...bas4);
      }
    }
  }
  // pylônes (pont à haubans ou suspendu) : mât unique dans l'axe, en H (deux mâts et une traverse) ou en A (deux mâts
  // qui se rejoignent en haut) ; du pied `z_bas` (sinon le terrain) au sommet `z_haut`
  const segment = (a, b, e) => {
    // barre de section carrée e × e de a à b (points [x, y, z])
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...d) || 1, u = d.map(x => x / l);
    const r = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const p1 = [u[1] * r[2] - u[2] * r[1], u[2] * r[0] - u[0] * r[2], u[0] * r[1] - u[1] * r[0]], n1 = Math.hypot(...p1) || 1;
    const v1 = p1.map(x => x / n1 * e / 2), v2 = [u[1] * v1[2] - u[2] * v1[1], u[2] * v1[0] - u[0] * v1[2], u[0] * v1[1] - u[1] * v1[0]];
    const c = (q, i, j) => [q[0] + i * v1[0] + j * v2[0], q[1] + i * v1[1] + j * v2[1], q[2] + i * v1[2] + j * v2[2]];
    const A4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => c(a, i, j)), B4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => c(b, i, j));
    for (let f = 0; f < 4; f++) quad(A4[f], A4[(f + 1) % 4], B4[(f + 1) % 4], B4[f]);
  };
  const sommets = [];
  for (const Y of P.pylones || []) {
    const t = Math.max(0, Math.min(L, Y.s)), A = surAxe(t), px = -A.uy, py = A.ux, zb = Y.z_bas ?? sol(A.x, A.y) - 1;
    const zh = Y.z_haut, e = Y.epaisseur || 3, ecart = Y.ecart ?? P.largeur + 2;
    const pt = (o, z) => [A.x + px * o, A.y + py * o, z];
    if (Y.forme === "H" || Y.forme === "A") {
      const oh = Y.forme === "A" ? 0 : ecart / 2;
      for (const c of [-1, 1]) segment(pt(c * ecart / 2, zb), pt(c * oh, zh), e);
      if (Y.forme === "H") segment(pt(-ecart / 2, dessous(t) - 1), pt(ecart / 2, dessous(t) - 1), e);
      sommets.push({ t, haut: c => pt(c * oh, zh - 2) });
    } else {
      segment(pt(0, zb), pt(0, zh), e);
      sommets.push({ t, haut: () => pt(0, zh - 2) });
    }
  }
  // haubans : de chaque pylône vers le tablier, en éventail, des deux côtés du pylône ; nappe axiale (au milieu du
  // tablier) ou latérale (aux deux bords)
  const H = P.haubans;
  if (H && sommets.length) {
    const pas = H.pas || 10, nb = H.nombre || 8, lat = H.nappe === "laterale", ep = H.epaisseur || 0.25;
    for (const S of sommets) for (const sens of [-1, 1]) for (let k = 1; k <= nb; k++) {
      const t = S.t + sens * (H.depart || 10) + sens * (k - 1) * pas;
      if (t < 0 || t > L) continue;
      const A = surAxe(t), px = -A.uy, py = A.ux;
      for (const c of lat ? [-1, 1] : [0]) {
        const o = c * (P.largeur / 2 - 0.5);
        segment(S.haut(c), [A.x + px * o, A.y + py * o, dessus(t) + 0.5], ep);
      }
    }
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
