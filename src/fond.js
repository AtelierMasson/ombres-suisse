// Fond de plan posé sur le terrain : plan cadastral (mensuration officielle) reteinté aux couleurs du thème,
// ou orthophoto SWISSIMAGE telle quelle. Les images viennent du service WMS de geo.admin.ch (accès libre, CORS ouvert).

import { t } from "./i18n.js";

const WMS = "https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&STYLES=&CRS=EPSG:2056";

/** Adresse de l'image d'une couche pour la boîte MN95 [e0, n0, e1, n1]. */
export function urlFond(couche, [e0, n0, e1, n1], px = 2048) {
  const format = couche === "ch.swisstopo.swissimage" ? "image/jpeg" : "image/png";
  return `${WMS}&LAYERS=${couche}&BBOX=${e0},${n0},${e1},${n1}&WIDTH=${px}&HEIGHT=${px}&FORMAT=${format}${format === "image/png" ? "&TRANSPARENT=true" : ""}`;
}
export const COUCHES = { cadastre: "ch.kantone.cadastralwebmap-farbe", ortho: "ch.swisstopo.swissimage",
  // bruit du trafic routier et ferroviaire, le jour (OFEV, sonBASE) : bandes de couleur par niveau en dB(A)
  bruit: "ch.bafu.laerm-strassenlaerm_tag,ch.bafu.laerm-bahnlaerm_tag" };

/** Image du service WMS, avec deux nouvelles tentatives (la dernière hors cache) : un échec ponctuel du réseau
 * ou du service laissait sinon le terrain uni. */
export function chargerImage(url, essais = 3) {
  // même adresse déjà demandée (préchargement au début du chargement) : on reprend la même attente
  if (dejaDemandees.has(url)) return dejaDemandees.get(url);
  const p = telecharger(url, essais);
  dejaDemandees.set(url, p);
  p.catch(() => dejaDemandees.delete(url)); // un échec ne reste pas en mémoire : la prochaine demande réessaie
  while (dejaDemandees.size > 12) dejaDemandees.delete(dejaDemandees.keys().next().value);
  return p;
}
const dejaDemandees = new Map();

/**
 * Lance tout de suite le téléchargement des fonds de plan d'une zone, pendant que le relevé se charge : l'image
 * est prête quand la maquette s'affiche, au lieu d'attendre encore le service WMS (≈ 1 à 2 s par image).
 */
export function prechargerFonds(urls) {
  for (const u of urls) chargerImage(u).catch(() => {});
}

async function telecharger(url, essais) {
  for (let k = 1; ; k++) {
    try {
      return await new Promise((ok, ko) => {
        const img = new Image();
        img.crossOrigin = "anonymous"; // nécessaire pour relire les pixels (reteinte) et pour WebGL
        img.onload = () => ok(img);
        img.onerror = () => ko(new Error(t("erreur.fondIndisponible")));
        img.src = k < essais ? url : `${url}&essai=${Date.now()}`;
      });
    } catch (e) {
      if (k >= essais) throw e;
      await new Promise(r => setTimeout(r, 600 * k));
    }
  }
}

const rvb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * Reteinte du plan cadastral : le blanc devient la teinte du sol, les routes (gris), les bâtiments (rose),
 * la forêt (vert) et l'eau (bleu) prennent des tons voisins, les traits noirs un ton plus soutenu.
 * `plan` = { sol, route, bati, foret, eau, trait, force }.
 */
export function teinterCadastre(img, plan, canvas = document.createElement("canvas")) {
  const w = canvas.width = img.naturalWidth || img.width, h = canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, w, h), d = image.data;
  const sol = rvb(plan.sol), route = rvb(plan.route), bati = rvb(plan.bati), foret = rvb(plan.foret), eau = rvb(plan.eau);
  const trait = rvb(plan.trait).map((v, k) => v * plan.force + sol[k] * (1 - plan.force));
  for (let p = 0; p < d.length; p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const v = mx / 255, sat = Math.min(1, (mx - mn) / 50);
    // gris : blanc -> sol, gris clair (routes, ~0,86) -> route, noir -> trait
    const u = v > 0.86 ? (v - 0.86) / 0.14 : v / 0.86, c0 = v > 0.86 ? route : trait, c1 = v > 0.86 ? sol : route;
    // couleur : la composante dominante dit l'objet
    const obj = r >= g && r >= b ? bati : g >= b ? foret : eau;
    // transparence (zones sans plan, en montagne surtout ; traits adoucis) : mêlée à la teinte du sol, pas au noir
    const a = d[p + 3] / 255;
    for (let k = 0; k < 3; k++) {
      const gris = c0[k] + (c1[k] - c0[k]) * u, coul = trait[k] + (obj[k] - trait[k]) * v;
      d[p + k] = sol[k] + (gris + (coul - gris) * sat - sol[k]) * a;
    }
    d[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Photo aérienne estompée : plus claire, un peu moins saturée, fondue (~40 %) dans la teinte du sol de la maquette. */
export function adoucirPhoto(img, sol, cv = document.createElement("canvas")) {
  cv.width = img.naturalWidth || img.width; cv.height = img.naturalHeight || img.height;
  const ctx = cv.getContext("2d");
  ctx.filter = "brightness(1.15) saturate(0.95) contrast(0.95)";
  ctx.drawImage(img, 0, 0);
  ctx.filter = "none";
  ctx.globalAlpha = 0.38; ctx.fillStyle = sol; ctx.fillRect(0, 0, cv.width, cv.height); ctx.globalAlpha = 1;
  return cv;
}

/** Bruit : bandes de niveau (dB) posées, un peu transparentes, sur le plan cadastral reteinté (`cadastre` : image). */
export function bruitSurPlan(img, cadastre, plan) {
  const cv = teinterCadastre(cadastre, plan), ctx = cv.getContext("2d");
  ctx.globalAlpha = 0.72;
  ctx.drawImage(img, 0, 0, cv.width, cv.height);
  ctx.globalAlpha = 1;
  return cv;
}
