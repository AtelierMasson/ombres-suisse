// Diagramme solaire : silhouette de l'horizon (montagnes) et course du soleil, azimut en abscisse (sud au centre).
import { positionSoleil, dateA } from "./soleil.js";
import { horizonA } from "./horizon.js";

const W = 420, H = 170, m = { g: 28, d: 8, h: 10, b: 22 }, AZ0 = 40, AZ1 = 320, HMAX = 72;
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
  for (const [az, t] of [[90, "E"], [135, "SE"], [180, "S"], [225, "SO"], [270, "O"]])
    s += `<line x1="${X(az)}" x2="${X(az)}" y1="${m.h}" y2="${H - m.b}" class="grille"/><text x="${X(az)}" y="${H - 6}" text-anchor="middle">${t}</text>`;
  if (horizon) {
    let p = `M${X(AZ0)},${Y(-2)}`;
    for (let az = AZ0; az <= AZ1; az += 1) p += `L${X(az).toFixed(1)},${Y(horizonA(horizon, az)).toFixed(1)}`;
    s += `<path d="${p}L${X(AZ1)},${Y(-2)}Z" class="relief"/>`;
  }
  const an = jour.slice(0, 4);
  s += `<path d="${ligne(course(`${an}-06-21`, lat, lon))}" class="saison"/><path d="${ligne(course(`${an}-12-21`, lat, lon))}" class="saison"/>`;
  s += `<path d="${ligne(course(jour, lat, lon))}" class="course"/>`;
  const p = positionSoleil(dateA(jour, minutes), lat, lon);
  if (p.hauteur > -2 && p.azimut > AZ0 && p.azimut < AZ1) s += `<circle cx="${X(p.azimut)}" cy="${Y(p.hauteur)}" r="6" class="astre"/>`;
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
