// Diagramme solaire : silhouette de l'horizon (montagnes) et course du soleil, azimut en abscisse (sud au centre).
import { positionSoleil, dateA } from "./soleil.js";
import { horizonA } from "./horizon.js";
import { t } from "./i18n.js";

const W = 300, H = 140, m = { g: 26, d: 6, h: 8, b: 20 }, AZ0 = 40, AZ1 = 320, HMAX = 72;
const X = az => m.g + (az - AZ0) / (AZ1 - AZ0) * (W - m.g - m.d);
const Y = h => H - m.b - (Math.max(-2, h) + 2) / (HMAX + 2) * (H - m.h - m.b);

function course(jour, lat, lon) {
  const pts = [];
  for (let t = 0; t <= 1440; t += 10) pts.push(positionSoleil(dateA(jour, t), lat, lon));
  return pts.filter(p => p.hauteur > -2 && p.azimut > AZ0 && p.azimut < AZ1);
}
const ligne = pts => pts.map((p, k) => `${k ? "L" : "M"}${X(p.azimut).toFixed(1)},${Y(p.hauteur).toFixed(1)}`).join("");

export function dessinerDiagramme(svg, { horizon, jour, minutes, lat, lon }) {
  let s = "";
  for (const h of [0, 20, 40, 60]) s += `<line x1="${m.g}" x2="${W - m.d}" y1="${Y(h)}" y2="${Y(h)}" class="grille"/><text x="${m.g - 4}" y="${Y(h) + 3}" text-anchor="end">${h}°</text>`;
  for (const [az, d] of [[90, "E"], [135, "SE"], [180, "S"], [225, "SO"], [270, "O"]])
    s += `<line x1="${X(az)}" x2="${X(az)}" y1="${m.h}" y2="${H - m.b}" class="grille"/><text x="${X(az)}" y="${H - 6}" text-anchor="middle">${t(`dir.${d}`)}</text>`;
  if (horizon) {
    let p = `M${X(AZ0)},${Y(-2)}`;
    for (let az = AZ0; az <= AZ1; az += 1) p += `L${X(az).toFixed(1)},${Y(horizonA(horizon, az)).toFixed(1)}`;
    s += `<path d="${p}L${X(AZ1)},${Y(-2)}Z" class="relief"/>`;
  }
  const an = jour.slice(0, 4);
  s += `<path d="${ligne(course(`${an}-06-21`, lat, lon))}" class="saison"/><path d="${ligne(course(`${an}-12-21`, lat, lon))}" class="saison"/>`;
  s += `<path d="${ligne(course(jour, lat, lon))}" class="course"/>`;
  const p = positionSoleil(dateA(jour, minutes), lat, lon);
  const hh = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  if (p.hauteur > -2 && p.azimut > AZ0 && p.azimut < AZ1) {
    const x = X(p.azimut), y = Y(p.hauteur), dx = x > W - 50 ? -10 : 10;
    s += `<circle cx="${x}" cy="${y}" r="6" class="astre"/>`
      + `<text x="${x + dx}" y="${Math.max(m.h + 10, y - 8)}" text-anchor="${dx < 0 ? "end" : "start"}" class="heure-astre">${hh}</text>`;
  } else s += `<text x="${W - m.d - 2}" y="${m.h + 10}" text-anchor="end" class="heure-astre">${t("soleil.diagCouche", { h: hh })}</text>`;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = s;
}

/** Heures de lever et de coucher derrière le relief (et durée), pour un jour. */
export function soleilVisible(jour, lat, lon, horizon) {
  let debut = null, fin = null, minutes = 0;
  for (let t = 0; t < 1440; t += 2) {
    const p = positionSoleil(dateA(jour, t), lat, lon);
    if (p.hauteur > 0 && p.hauteur > horizonA(horizon, p.azimut)) { debut ??= t; fin = t; minutes += 2; }
  }
  return { debut, fin, minutes };
}

/** Heure (minutes) du point de la course du jour le plus proche du pointeur, ou null hors de la course. */
export function heureSousPointeur(svg, e, { jour, lat, lon }) {
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  let meilleur = null, dmin = Infinity;
  for (let t = 0; t < 1440; t += 5) {
    const p = positionSoleil(dateA(jour, t), lat, lon);
    if (p.hauteur < -2 || p.azimut <= AZ0 || p.azimut >= AZ1) continue;
    const d = Math.hypot(X(p.azimut) - pt.x, Y(p.hauteur) - pt.y);
    if (d < dmin) { dmin = d; meilleur = t; }
  }
  return meilleur;
}
