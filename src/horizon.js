// Horizon lointain (montagnes, collines) jusqu'à ~50 km, y compris en France et en Italie.
// Relief : tuiles d'élévation libres « Terrarium » (AWS Open Data, ~30–100 m), lues dans le navigateur.
import { versWgs } from "./geo.js";
import { t } from "./i18n.js";

const TUILE = (z, x, y) => `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
// tuiles décodées (~330 Ko chacune : altitudes et masque des lacs), gardées d'un lieu à l'autre ; bornées (D10)
const cache = new Map(), CACHE_MAX = (globalThis.navigator?.deviceMemory || 8) <= 4 ? 120 : 300;

export function tuile(z, x, y) {
  const k = `${z}/${x}/${y}`;
  if (cache.has(k)) { const p = cache.get(k); cache.delete(k); cache.set(k, p); return p; } // la plus récente à la fin
  while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(k, new Promise((ok, ko) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const cv = new OffscreenCanvas(256, 256), ctx = cv.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, 256, 256).data, h = new Float32Array(256 * 256);
      for (let p = 0; p < h.length; p++) h[p] = d[4 * p] * 256 + d[4 * p + 1] + d[4 * p + 2] / 256 - 32768;
      // lacs : surfaces parfaitement plates (le relief y porte la cote du plan d'eau), au moins 5 × 5 pixels égaux
      const eau = new Uint8Array(256 * 256);
      for (let y = 2; y < 254; y++) for (let x = 2; x < 254; x++) {
        const p = y * 256 + x, v = h[p];
        let plat = true;
        for (let b = -2; b <= 2 && plat; b++) for (let a = -2; a <= 2; a++) if (Math.abs(h[p + b * 256 + a] - v) > 0.02) { plat = false; break; }
        if (plat) for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) eau[p + b * 256 + a] = 1;
      }
      h.eau = eau;
      ok(h);
    };
    img.onerror = () => ko(new Error(t("erreur.tuileRelief", { k })));
    img.src = TUILE(z, x, y);
  }));
  return cache.get(k);
}

export const versTuile = (lon, lat, z) => {
  const s = 2 ** z, r = lat * Math.PI / 180;
  return [(lon + 180) / 360 * s, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * s];
};

/**
 * Profil d'horizon vu depuis (E, N, altitude) : hauteur angulaire (degrés) tous les `pas` degrés d'azimut.
 * Le relief à moins de `rayonProche` m est ignoré (il vient du nuage de points).
 * `alt` peut être une promesse : les tuiles sont alors téléchargées sans attendre l'altitude de l'observateur
 * (elle n'est connue qu'une fois le terrain reconstruit), qui ne sert qu'au calcul final.
 */
export async function profilHorizon(E, N, alt, { pas = 1, rayonProche = 150, rayonMax = 50000, onProgres = () => {} } = {}) {
  const za = 10, zp = 12; // tuile grossière au loin, plus fine jusqu'à 6 km
  const distances = [];
  for (let d = rayonProche; d < rayonMax; d += Math.max(15, d * 0.008)) distances.push(d);
  // échantillons : azimut × distance -> (z, tuile, pixel)
  const nA = Math.round(360 / pas), echant = [];
  const besoin = new Set();
  for (let a = 0; a < nA; a++) {
    const az = a * pas * Math.PI / 180, sx = Math.sin(az), sy = Math.cos(az);
    for (const d of distances) {
      const [lon, lat] = versWgs(E + sx * d, N + sy * d), z = d < 6000 ? zp : za;
      const [tx, ty] = versTuile(lon, lat, z), x = Math.floor(tx), y = Math.floor(ty);
      const k = `${z}/${x}/${y}`;
      besoin.add(k);
      echant.push(a, d, k, Math.min(255, Math.floor((tx - x) * 256)), Math.min(255, Math.floor((ty - y) * 256)));
    }
  }
  const tuiles = new Map(), liste = [...besoin];
  let faits = 0;
  await Promise.all(liste.map(async k => {
    const [z, x, y] = k.split("/").map(Number);
    try { tuiles.set(k, await tuile(z, x, y)); } catch { /* hors couverture : ignoré */ }
    onProgres(++faits / liste.length, t("etat.reliefTuiles", { faits, total: liste.length }));
  }));
  alt = await alt;
  const R = 6371000, k = 0.13; // courbure de la Terre et réfraction
  const profil = new Float32Array(nA).fill(-5);
  for (let q = 0; q < echant.length; q += 5) {
    const h = tuiles.get(echant[q + 2]);
    if (!h) continue;
    const d = echant[q + 1], alt2 = h[echant[q + 4] * 256 + echant[q + 3]] - d * d / (2 * R) * (1 - k);
    const ang = Math.atan2(alt2 - alt, d) * 180 / Math.PI;
    if (ang > profil[echant[q]]) profil[echant[q]] = ang;
  }
  return { pas, profil };
}

/** Hauteur de l'horizon dans la direction `azimut` (interpolée). */
export function horizonA({ pas, profil }, azimut) {
  const f = ((azimut % 360) + 360) % 360 / pas, i = Math.floor(f) % profil.length, j = (i + 1) % profil.length, u = f - Math.floor(f);
  return profil[i] * (1 - u) + profil[j] * u;
}
