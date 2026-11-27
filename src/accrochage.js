// Accrochage des points d'une emprise (dessin coin par coin, coin déplacé) : un côté qui passe à moins de quelques
// degrés d'une direction de référence (angle droit sur le côté précédent, orientation de la parcelle ou des bâtiments
// voisins) la prend ; quand deux côtés s'accrochent à la fois (vers le point précédent et vers le suivant), le point
// tombe à leur croisement. Sinon la longueur du côté s'arrondit au pas demandé.

const PI = Math.PI;
/** Écart entre deux directions de droites (modulo π), en radians. */
const ecart = (a, b) => { const d = ((a - b) % PI + PI) % PI; return Math.min(d, PI - d); };

/** Directions (radians, modulo π) : chaque orientation et sa perpendiculaire, sans doublons à 0,5° près. */
export function directions(orientations) {
  const out = [];
  for (const o of orientations) if (o != null && isFinite(o)) for (const a of [o, o + PI / 2]) {
    const r = ((a % PI) + PI) % PI;
    if (!out.some(b => ecart(b, r) < 0.5 * PI / 180)) out.push(r);
  }
  return out;
}

const droite = (p, a) => ({ p, u: [Math.cos(a), Math.sin(a)] });
const projeter = (q, D) => { const s = (q[0] - D.p[0]) * D.u[0] + (q[1] - D.p[1]) * D.u[1]; return [D.p[0] + s * D.u[0], D.p[1] + s * D.u[1]]; };
function croiser(D, E) {
  const d = D.u[0] * E.u[1] - D.u[1] * E.u[0];
  if (Math.abs(d) < 0.05) return null;
  const s = ((E.p[0] - D.p[0]) * E.u[1] - (E.p[1] - D.p[1]) * E.u[0]) / d;
  return [D.p[0] + s * D.u[0], D.p[1] + s * D.u[1]];
}
/** Meilleure direction de `dirs` pour le côté ancre → q, à moins de `tol` (radians), ou null. */
function meilleure(ancre, q, dirs, tol) {
  const l = Math.hypot(q[0] - ancre[0], q[1] - ancre[1]);
  if (l < 0.3) return null;
  const a = Math.atan2(q[1] - ancre[1], q[0] - ancre[0]);
  let best = null;
  for (const d of dirs) { const e = ecart(a, d); if (e < tol && (!best || e < best.e)) best = { e, d }; }
  return best && droite(ancre, best.d);
}

/**
 * Point accroché. `ancres` = [{ p, dirs }] (une ou deux : point précédent, point suivant) ; `pas` = arrondi de la
 * longueur du côté vers la première ancre (m) ; `tol` en degrés. Renvoie { p, guides: [[a, b], …] } (côtés accrochés).
 */
export function accrocherPoint(q, ancres, { pas = 0.1, tol = 4 } = {}) {
  const t = tol * PI / 180, D = ancres.map(A => A && meilleure(A.p, q, A.dirs, t));
  if (D[0] && D[1]) {
    const x = croiser(D[0], D[1]);
    if (x && Math.hypot(x[0] - q[0], x[1] - q[1]) < Math.max(0.5, 0.15 * Math.hypot(q[0] - D[0].p[0], q[1] - D[0].p[1])))
      return { p: x, guides: [[D[0].p, x], [D[1].p, x]] };
  }
  if (D[0]) {
    const r = projeter(q, D[0]), A = D[0].p, s = (r[0] - A[0]) * D[0].u[0] + (r[1] - A[1]) * D[0].u[1], l = Math.round(s / pas) * pas;
    const p = [A[0] + l * D[0].u[0], A[1] + l * D[0].u[1]];
    return { p, guides: [[A, p]] };
  }
  if (D[1]) { const p = projeter(q, D[1]); return { p, guides: [[D[1].p, p]] }; }
  // pas d'accrochage d'angle : longueur arrondie le long de la direction visée
  const A = ancres[0]?.p;
  if (A && pas > 0) {
    const l = Math.hypot(q[0] - A[0], q[1] - A[1]), k = Math.round(l / pas) * pas;
    if (l > 0.05) return { p: [A[0] + (q[0] - A[0]) * k / l, A[1] + (q[1] - A[1]) * k / l], guides: [] };
  }
  return { p: q, guides: [] };
}
