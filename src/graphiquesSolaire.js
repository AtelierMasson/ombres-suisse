// Graphiques des panneaux solaires sur les toits (onglet Soleil et PDF) : production par mois (SVG en texte, couleurs
// explicites pour svg2pdf) et vue de dessus du toit (canvas) avec la carte de chaleur des pans et les modules.
import { t, entier } from "./i18n.js";
import { couleur } from "./graphiquesPiscine.js";

const SOLEIL = "#e8a317";
const xml = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Échelle de la carte de chaleur (kWh/m² par an sur le plan du toit). */
export const ECHELLE = [400, 1400];
export const couleurIrr = v => couleur((v - ECHELLE[0]) / (ECHELLE[1] - ECHELLE[0]));
/** Même couleur, en [r, g, b] de 0 à 1 (maillages three.js). */
export function couleurIrrRvb(v) {
  const m = couleurIrr(v).match(/\d+/g).map(Number);
  return [m[0] / 255, m[1] / 255, m[2] / 255];
}

/** Production par mois (kWh) : barres de la médiane, trait P10–P90 si plusieurs années. */
export function svgProductionMois(mois, { encre = "currentColor", police = "inherit", taille = 8 } = {}) {
  const W = 320, H = 120, g = 30, d = 4, h = 8, b = 16, haut = Math.max(1, ...mois.map(m => Math.max(m.med, m.p90 || 0)));
  const pas = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000].find(p => haut / p <= 5) || 100000, max = Math.ceil(haut / pas) * pas;
  const bw = (W - g - d) / 12, Y = v => H - b - v / max * (H - h - b), im = t("piscine.initialesMois").split(",");
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="${police}" font-size="${taille}">`;
  for (let v = 0; v <= max; v += pas)
    s += `<line x1="${g}" x2="${W - d}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${encre}" stroke-opacity="0.15" stroke-width="0.5"/><text x="${g - 3}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end" fill="${encre}">${entier(v)}</text>`;
  mois.forEach((m, k) => {
    const x = g + k * bw;
    s += `<rect x="${(x + 2).toFixed(1)}" y="${Y(m.med).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${(Y(0) - Y(m.med)).toFixed(1)}" fill="${SOLEIL}"><title>${xml(t("sol.moisBulle", { kwh: entier(m.med) }))}</title></rect>`;
    if (m.p90 > m.p10 + 0.5) s += `<line x1="${(x + bw / 2).toFixed(1)}" x2="${(x + bw / 2).toFixed(1)}" y1="${Y(m.p10).toFixed(1)}" y2="${Y(m.p90).toFixed(1)}" stroke="${encre}" stroke-width="0.8"/>`;
    s += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" fill="${encre}">${xml(im[k])}</text>`;
  });
  return s + `<text x="${W - d}" y="${h - 1}" text-anchor="end" fill="${encre}">kWh</text></svg>`;
}

/**
 * Vue de dessus du toit : relief ombré, irradiation de chaque point (carte de chaleur), modules, nord et échelle.
 * @param pans [{ actif }] ; @param points [{ x, y, v (kWh/m²), pan (indice) }] ; @param modules [{ coins }]
 */
export function imageToit(G, pans, points, modules, { marge = 6, px = 10, pas = 1 } = {}) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x0 = Math.min(...xs) - marge, x1 = Math.max(...xs) + marge, y0 = Math.min(...ys) - marge, y1 = Math.max(...ys) + marge;
  const w = Math.max(1, Math.round((x1 - x0) / G.c)), h = Math.max(1, Math.round((y1 - y0) / G.c)), cv = document.createElement("canvas");
  cv.width = w * px; cv.height = h * px;
  const ctx = cv.getContext("2d"), img = ctx.createImageData(w, h), S = G.surface || G.base;
  const z = (i, j) => { const v = S[Math.max(0, Math.min(G.n - 1, j)) * G.n + Math.max(0, Math.min(G.n - 1, i))]; return Number.isFinite(v) ? v : 0; };
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = Math.floor((x0 + (c + 0.5) * G.c - G.x0) / G.c), j = Math.floor((y1 - (r + 0.5) * G.c - G.x0) / G.c), p = j * G.n + i;
    const dzx = (z(i + 1, j) - z(i - 1, j)) / (2 * G.c), dzy = (z(i, j + 1) - z(i, j - 1)) / (2 * G.c);
    const ombre = Math.max(0.35, Math.min(1, 0.8 + (-dzx * 0.6 + dzy * 0.6) * 0.35));
    let base = [226, 224, 218];
    if (G.bat && !isNaN(G.bat[p])) base = [178, 170, 160];
    else if (G.veg && !isNaN(G.veg[p])) base = [170, 196, 150];
    const o = 4 * (r * w + c);
    img.data[o] = base[0] * ombre; img.data[o + 1] = base[1] * ombre; img.data[o + 2] = base[2] * ombre; img.data[o + 3] = 255;
  }
  const tmp = document.createElement("canvas"); tmp.width = w; tmp.height = h; tmp.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, w * px, h * px);
  const X = x => (x - x0) / G.c * px, Y = y => (y1 - y) / G.c * px, cote = pas * px;
  for (const p of points) {
    ctx.globalAlpha = pans[p.pan]?.actif === false ? 0.35 : 1;
    ctx.fillStyle = couleurIrr(p.v);
    ctx.fillRect(X(p.x) - cote / 2, Y(p.y) - cote / 2, cote + 0.5, cote + 0.5);
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#13294b"; ctx.fillStyle = "rgba(19, 41, 75, 0.55)"; ctx.lineWidth = Math.max(1, px / 6);
  for (const m of modules) {
    ctx.beginPath();
    m.coins.forEach(([x, y], k) => (k ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  const f = cv.width / 300;
  ctx.fillStyle = "#13294b"; ctx.font = `${Math.round(14 * f)}px sans-serif`; ctx.textAlign = "center";
  ctx.beginPath(); ctx.moveTo(cv.width - 20 * f, 12 * f); ctx.lineTo(cv.width - 26 * f, 30 * f); ctx.lineTo(cv.width - 14 * f, 30 * f); ctx.closePath(); ctx.fill();
  ctx.fillText("N", cv.width - 20 * f, 46 * f);
  const L = 5 / G.c * px;
  ctx.fillRect(10 * f, cv.height - 14 * f, L, 4 * f);
  ctx.textAlign = "left"; ctx.fillText("5 m", 10 * f + L + 6 * f, cv.height - 9 * f);
  return cv;
}
