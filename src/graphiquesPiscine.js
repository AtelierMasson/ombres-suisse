// Graphiques de la zone piscine (onglet Soleil et PDF) : SVG en texte, couleurs explicites (svg2pdf les reprend telles
// quelles). `encre` : couleur des textes et axes ("currentColor" à l'écran, gris foncé dans le PDF).
import { t, nombre } from "./i18n.js";

const SOLEIL = "#e8a317", POSSIBLE = "#9aa3ad", EAU = "#2f6fb5", CHAUD = "#d0571f";
const xml = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const initialesMois = () => t("piscine.initialesMois").split(",");

/** 52 barres : heures de soleil par jour (moyenne de la semaine et de la zone), sur le maximum possible (relief). */
export function svgSemaines(recues, possibles, { encre = "currentColor", police = "inherit", taille = 8 } = {}) {
  const W = 320, H = 120, g = 24, d = 4, h = 8, b = 16, max = Math.max(1, Math.ceil(Math.max(...possibles) / 2) * 2);
  const X = w => g + w * (W - g - d) / 52, bw = (W - g - d) / 52, Y = v => H - b - v / max * (H - h - b);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="${police}" font-size="${taille}">`;
  for (let v = 0; v <= max; v += max > 10 ? 4 : 2)
    s += `<line x1="${g}" x2="${W - d}" y1="${Y(v)}" y2="${Y(v)}" stroke="${encre}" stroke-opacity="0.15" stroke-width="0.5"/><text x="${g - 3}" y="${Y(v) + 3}" text-anchor="end" fill="${encre}">${v} h</text>`;
  for (let w = 0; w < 52; w++) {
    s += `<rect x="${(X(w) + 0.4).toFixed(1)}" y="${Y(possibles[w]).toFixed(1)}" width="${(bw - 0.8).toFixed(1)}" height="${(Y(0) - Y(possibles[w])).toFixed(1)}" fill="${POSSIBLE}" fill-opacity="0.35"/>`;
    s += `<rect x="${(X(w) + 0.4).toFixed(1)}" y="${Y(recues[w]).toFixed(1)}" width="${(bw - 0.8).toFixed(1)}" height="${(Y(0) - Y(recues[w])).toFixed(1)}" fill="${SOLEIL}"><title>${xml(t("piscine.semaineBulle", { w: w + 1, h: nombre(recues[w], 1), max: nombre(possibles[w], 1) }))}</title></rect>`;
  }
  const im = initialesMois();
  for (let m = 0; m < 12; m++) s += `<text x="${(X(m * 52 / 12 + 2.2)).toFixed(1)}" y="${H - 4}" text-anchor="middle" fill="${encre}">${xml(im[m])}</text>`;
  return s + "</svg>";
}

/** Ensoleillement par mois : ciel clair (ombres réelles, sans nuages) contre réel (heures de soleil mesurées). */
export function svgMois(mois, { encre = "currentColor", police = "inherit", taille = 8 } = {}) {
  const W = 320, H = 120, g = 24, d = 4, h = 8, b = 16, max = Math.max(1, Math.ceil(Math.max(...mois.map(m => m.clair)) / 2) * 2);
  const bw = (W - g - d) / 12, Y = v => H - b - v / max * (H - h - b);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="${police}" font-size="${taille}">`;
  for (let v = 0; v <= max; v += max > 10 ? 4 : 2)
    s += `<line x1="${g}" x2="${W - d}" y1="${Y(v)}" y2="${Y(v)}" stroke="${encre}" stroke-opacity="0.15" stroke-width="0.5"/><text x="${g - 3}" y="${Y(v) + 3}" text-anchor="end" fill="${encre}">${v} h</text>`;
  const im = initialesMois();
  mois.forEach((m, k) => {
    const x = g + k * bw;
    s += `<rect x="${(x + 2).toFixed(1)}" y="${Y(m.clair).toFixed(1)}" width="${(bw / 2 - 2).toFixed(1)}" height="${(Y(0) - Y(m.clair)).toFixed(1)}" fill="${POSSIBLE}" fill-opacity="0.55"/>`;
    s += `<rect x="${(x + bw / 2).toFixed(1)}" y="${Y(m.med).toFixed(1)}" width="${(bw / 2 - 2).toFixed(1)}" height="${(Y(0) - Y(m.med)).toFixed(1)}" fill="${SOLEIL}"/>`;
    if (Number.isFinite(m.p10)) s += `<line x1="${(x + bw * 0.75 - 1).toFixed(1)}" x2="${(x + bw * 0.75 - 1).toFixed(1)}" y1="${Y(m.p10).toFixed(1)}" y2="${Y(m.p90).toFixed(1)}" stroke="${encre}" stroke-width="0.8"/>`;
    s += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" fill="${encre}">${xml(im[k])}</text>`;
  });
  s += `<rect x="${g + 4}" y="${h}" width="7" height="6" fill="${POSSIBLE}" fill-opacity="0.55"/><text x="${g + 14}" y="${h + 5.5}" fill="${encre}">${xml(t("piscine.cielClair"))}</text>`;
  s += `<rect x="${g + 110}" y="${h}" width="7" height="6" fill="${SOLEIL}"/><text x="${g + 120}" y="${h + 5.5}" fill="${encre}">${xml(t("piscine.reelNuages"))}</text>`;
  return s + "</svg>";
}

/** Température de l'eau par semaine : médiane, fourchette P10–P90, sans ombre (pointillé) et seuil. */
export function svgTemperature(semaines, seuil, { encre = "currentColor", police = "inherit", taille = 8 } = {}) {
  const W = 320, H = 140, g = 26, d = 6, h = 8, b = 16;
  const vals = semaines.flatMap(s => [s.p10, s.p90, s.sansOmbre]).filter(Number.isFinite);
  const t0 = Math.floor(Math.min(14, ...vals) / 2) * 2, t1 = Math.ceil(Math.max(30, ...vals) / 2) * 2, n = semaines.length;
  const X = k => g + (k + 0.5) * (W - g - d) / n, Y = v => H - b - (v - t0) / (t1 - t0) * (H - h - b);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="${police}" font-size="${taille}">`;
  for (let v = t0; v <= t1; v += 4)
    s += `<line x1="${g}" x2="${W - d}" y1="${Y(v)}" y2="${Y(v)}" stroke="${encre}" stroke-opacity="0.15" stroke-width="0.5"/><text x="${g - 3}" y="${Y(v) + 3}" text-anchor="end" fill="${encre}">${v}°</text>`;
  s += `<line x1="${g}" x2="${W - d}" y1="${Y(seuil)}" y2="${Y(seuil)}" stroke="${CHAUD}" stroke-width="0.8" stroke-dasharray="3 2"/><text x="${W - d}" y="${Y(seuil) - 2}" text-anchor="end" fill="${CHAUD}">${seuil} °C</text>`;
  const ligne = f => semaines.map((x, k) => `${k ? "L" : "M"}${X(k).toFixed(1)},${Y(f(x)).toFixed(1)}`).join("");
  const bande = semaines.map((x, k) => `${k ? "L" : "M"}${X(k).toFixed(1)},${Y(x.p90).toFixed(1)}`).join("") + [...semaines].reverse().map((x, k) => `L${X(n - 1 - k).toFixed(1)},${Y(x.p10).toFixed(1)}`).join("") + "Z";
  s += `<path d="${bande}" fill="${EAU}" fill-opacity="0.18"/>`;
  if (semaines.every(x => Number.isFinite(x.sansOmbre))) s += `<path d="${ligne(x => x.sansOmbre)}" fill="none" stroke="${encre}" stroke-opacity="0.55" stroke-width="1" stroke-dasharray="2 2"/>`;
  s += `<path d="${ligne(x => x.med)}" fill="none" stroke="${EAU}" stroke-width="1.6"/>`;
  // axe : initiale du mois à la première semaine de chaque mois
  const im = initialesMois();
  let mAvant = -1;
  semaines.forEach((x, k) => { const m = new Date(Date.UTC(2025, 0, 1 + x.w * 7 + 3)).getUTCMonth(); if (m !== mAvant) { s += `<text x="${X(k).toFixed(1)}" y="${H - 4}" fill="${encre}">${xml(im[m])}</text>`; mAvant = m; } });
  s += `<line x1="${g + 4}" x2="${g + 14}" y1="${h + 3}" y2="${h + 3}" stroke="${EAU}" stroke-width="1.6"/><text x="${g + 17}" y="${h + 6}" fill="${encre}">${xml(t("piscine.legMediane"))}</text>`;
  s += `<line x1="${g + 120}" x2="${g + 130}" y1="${h + 3}" y2="${h + 3}" stroke="${encre}" stroke-opacity="0.55" stroke-dasharray="2 2"/><text x="${g + 133}" y="${h + 6}" fill="${encre}">${xml(t("piscine.legSansOmbre"))}</text>`;
  return s + "</svg>";
}

/**
 * Vue de dessus de la zone (canvas) : relief ombré de la surface (terrain, bâtiments, arbres) autour de la piscine, et
 * heures de soleil de chaque point (moyenne mai–septembre) en couleurs, contour, nord et barre d'échelle.
 * @returns {HTMLCanvasElement}
 */
export function imageZone(G, anneaux, xy, valeurs, max, { marge = 10, px = 10 } = {}) {
  const pts = anneaux[0], xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs) - marge, x1 = Math.max(...xs) + marge, y0 = Math.min(...ys) - marge, y1 = Math.max(...ys) + marge;
  const w = Math.round((x1 - x0) / G.c), h = Math.round((y1 - y0) / G.c), cv = document.createElement("canvas");
  cv.width = w * px; cv.height = h * px;
  const ctx = cv.getContext("2d"), img = ctx.createImageData(w, h);
  const z = (i, j) => { const gi = Math.max(0, Math.min(G.n - 1, i)), gj = Math.max(0, Math.min(G.n - 1, j)), v = G.surface[gj * G.n + gi]; return Number.isFinite(v) ? v : 0; };
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = Math.floor((x0 + (c + 0.5) * G.c - G.x0) / G.c), j = Math.floor((y1 - (r + 0.5) * G.c - G.x0) / G.c), p = j * G.n + i;
    // relief ombré (lumière du nord-ouest)
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
  const X = x => (x - x0) / G.c * px, Y = y => (y1 - y) / G.c * px;
  // heures de soleil des points (cellules de 0,5 m)
  xy.forEach(([x, y], q) => { ctx.fillStyle = couleur(valeurs[q] / max); ctx.fillRect(X(x - G.c / 2), Y(y + G.c / 2), px + 0.5, px + 0.5); });
  ctx.strokeStyle = "#13294b"; ctx.lineWidth = Math.max(2, px / 4); ctx.beginPath();
  for (const a of anneaux) a.forEach(([x, y], k) => (k ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  ctx.closePath(); ctx.stroke();
  // nord et échelle (5 m)
  const f = cv.width / 300;
  ctx.fillStyle = "#13294b"; ctx.font = `${Math.round(14 * f)}px sans-serif`; ctx.textAlign = "center";
  ctx.beginPath(); ctx.moveTo(cv.width - 20 * f, 12 * f); ctx.lineTo(cv.width - 26 * f, 30 * f); ctx.lineTo(cv.width - 14 * f, 30 * f); ctx.closePath(); ctx.fill();
  ctx.fillText("N", cv.width - 20 * f, 46 * f);
  const L = 5 / G.c * px;
  ctx.fillRect(10 * f, cv.height - 14 * f, L, 4 * f);
  ctx.textAlign = "left"; ctx.fillText("5 m", 10 * f + L + 6 * f, cv.height - 9 * f);
  return cv;
}

/** Couleur de l'échelle : bleu (ombre) → jaune → orange (plein soleil), v entre 0 et 1. */
export function couleur(v) {
  const E = [[38, 77, 191], [120, 160, 200], [242, 229, 51], [242, 120, 26]];
  const x = Math.max(0, Math.min(1, v)) * (E.length - 1), i = Math.min(E.length - 2, Math.floor(x)), u = x - i;
  return `rgb(${E[i].map((c, k) => Math.round(c + (E[i + 1][k] - c) * u)).join(",")})`;
}
export const DEGRADE = "linear-gradient(90deg, rgb(38,77,191), rgb(120,160,200), rgb(242,229,51), rgb(242,120,26))";
