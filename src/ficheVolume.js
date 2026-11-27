// Fenêtre des paramètres du volume sélectionné (onglet Projet), en quatre sections : identité (nom, apparence, traits
// d'étage), implantation (emprise, rotation, centre MN95, base), gabarit (étages, corniche, toit) et résultats (surfaces,
// volume bâti, altitudes, hauteurs au-dessus du terrain à chaque coin, distances aux limites et aux bâtiments).
// Les champs mettent la maquette à jour aussitôt ; la souris (déplacer, tourner, tirer une face) les met à jour en retour.
import { t, nombre } from "./i18n.js";
import { solEn } from "./grille.js";
import { cadre, coinsDe, corniche, hauteurToit, reglerCorniche, reglerEtages, reglerFaite, distanceSegments, dansPolygone, reglerEtage, etageCourant, aire, perimetre, centroide, pansPossibles, limitesParVoisin, distancesLimites, depassementLimite, surfacePlancher, volumeBati } from "./projet.js";
import { ouvrirApparence, fermerApparence, COULEUR_DEFAUT } from "./couleurVolume.js";

const fr = (v, d = 1) => nombre(v, d);
const esc = x => String(x ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const deg = r => ((r * 180 / Math.PI) % 360 + 360) % 360;

/**
 * Mesures d'un volume (en plan, entre emprises, pas entre centres) :
 * batiment { d, p, q } le plus proche, voisins (bâtiments à moins de 50 m : nombre et distance moyenne),
 * limite { d, p, q } la plus proche et moyenne des façades, altitudes et hauteurs au-dessus du terrain aux coins ;
 * batiments (les trois plus proches), limites (une par parcelle voisine : { numero, d, p, q }), depasse ({ d, p, q } :
 * coin le plus loin hors de la parcelle, ou null). Emprise polygonale quelconque.
 * `o` = { scene, S, parcelleEn, autres (autres volumes du projet) }.
 */
export function mesurer(v, { scene, S, parcelleEn, autres = [] }) {
  const G = S.G, segs = v.coins.map((p, k) => [p, v.coins[(k + 1) % v.coins.length]]);
  const xs = v.coins.map(p => p[0]), ys = v.coins.map(p => p[1]);
  const boite = [Math.min(...xs) - 50, Math.min(...ys) - 50, Math.max(...xs) + 50, Math.max(...ys) + 50];
  // bâtiments tels qu'affichés (sans les masqués), regroupés par bâtiment entier ; et les autres volumes du projet
  const parBat = new Map(), C = scene.contours, V = C && scene.indexer?.();
  const mesurerPoly = (cle, poly) => {
    let r = distanceSegments(segs, poly);
    if (!r) return;
    // emprises qui se chevauchent sans croiser leurs côtés (l'une dans l'autre)
    if (r.d > 0 && (dansPolygone(poly, v.coins[0][0], v.coins[0][1]) || dansPolygone(v.coins, poly[0][0], poly[0][1]))) r = { ...r, d: 0 };
    const avant = parBat.get(cle);
    if (!avant || r.d < avant.d) parBat.set(cle, r);
  };
  if (C) for (const B of C.boucles) {
    const poly = B.sommets.map(s => [C.px[B.coins[s]], C.py[B.coins[s]]]);
    if (poly.length < 3 || poly.every(([x, y]) => x < boite[0] || x > boite[2] || y < boite[1] || y > boite[3])) continue;
    mesurerPoly(V ? `b${V.bati[B.seg]}` : `s${B.seg}`, poly);
  }
  for (const w of autres) if (w !== v && w.visible !== false) mesurerPoly(`v${w.id}`, w.coins);
  const liste = [...parBat.values()].sort((a, b) => a.d - b.d), proches = liste.filter(r => r.d < 50);
  const batiment = liste[0] || null;
  const voisins = { n: proches.length, moyenne: proches.length ? proches.reduce((s, r) => s + r.d, 0) / proches.length : null };
  // limite de la parcelle sous le volume (à défaut, celle de l'adresse)
  const { cx, cy } = cadre(v), q = parcelleEn?.(cx, cy) || S.parcelle;
  let limite = null, moyenneLimite = null;
  const anneaux = q?.anneauxRel?.filter(a => a.length > 2) || [];
  if (anneaux.length) {
    const parFacade = segs.map(s => anneaux.map(a => distanceSegments([s], a)).reduce((m, r) => !m || r.d < m.d ? r : m, null));
    limite = parFacade.reduce((m, r) => !m || r.d < m.d ? r : m, null);
    moyenneLimite = parFacade.reduce((s, r) => s + r.d, 0) / parFacade.length;
  }
  // limites par voisin (calculées une fois par parcelle et par liste de voisines)
  if (q && (limitesCache.q !== q || limitesCache.n !== (S.toutes?.length || 0))) {
    limitesCache = { q, n: S.toutes?.length || 0, l: limitesParVoisin(anneaux, (S.toutes || []).filter(w => w.numero !== q.numero)) };
  }
  const limites = anneaux.length ? distancesLimites(v.coins, limitesCache.l) : [];
  const depasse = depassementLimite(v.coins, anneaux) || (limite && limite.d < 0.005 ? { d: 0, p: limite.p, q: limite.q } : null);
  const hc = corniche(v), ht = hauteurToit(v), zc = v.base + hc, zf = zc + ht;
  const coins = v.coins.map(([x, y]) => { const sol = solEn(G, x, y); return { sol, corniche: zc - sol, faite: zf - sol }; });
  return { batiment, batiments: liste.slice(0, 3), voisins, limite, moyenneLimite, limites, depasse, parcelle: q?.numero, base: v.base, zc, zf, coins };
}
let limitesCache = {};

/**
 * Cotes à dessiner en 3D (editionVolumes), au centimètre : vers les trois limites de la parcelle les plus proches (une par
 * voisin) et vers les deux bâtiments les plus proches ; dépassement de la limite en rouge vif (coin hors parcelle → limite).
 */
export function cotesVolume(v, M, scene) {
  const G = scene.G, out = [];
  const z = (p, q) => Math.max(solEn(G, ...p), solEn(G, ...q), v.base) - scene.zRef + 0.3;
  const cote = (r, texte, couleur, alerte = false) => out.push({ p: r.p, q: r.q, z: z(r.p, r.q), texte, couleur, alerte });
  for (const b of (M.batiments || (M.batiment ? [M.batiment] : [])).slice(0, 2)) if (b.d > 0.05 && b.d < 80) cote(b, `${fr(b.d, 2)} m`, "#3a332c");
  const limites = M.limites?.length ? M.limites : M.limite ? [M.limite] : [];
  for (const l of limites.slice(0, 3)) if (l.d > 0.05 && l.d < 80) cote(l, `${fr(l.d, 2)} m`, scene.T?.parcelle || "#e0262b");
  if (M.depasse && M.depasse.d > 0.005) cote(M.depasse, t("carte.depasseCote", { d: fr(M.depasse.d, 2) }), "#c4001a", true);
  return out;
}

/**
 * Fenêtre des paramètres du volume dans `conteneur`, en quatre sections, une information par ligne (étiquette à gauche,
 * valeur et unité alignées à droite) :
 * - Identité : nom, apparence (pastille qui ouvre la fenêtre de couleur : couleurs de base, TSL, transparence), traits d'étage ;
 * - Implantation : dimensions de l'emprise (rectangle : largeur et profondeur ; emprise libre : coins et cotes des côtés),
 *   emprise au sol, périmètre, rotation, centre MN95, altitude de la base, terrain sous l'emprise ;
 * - Gabarit : étages (rez, courants, dernier), hauteur à la corniche, toit (pans seulement sur un rectangle), pente, faîte ;
 * - Résultats (lecture seule) : surface de plancher brute, volume bâti, altitudes, hauteurs sur le terrain par coin,
 *   distances aux limites (une par voisin) et aux bâtiments.
 * `o` = { S, mesures(v), changer(v, final) } : `changer` applique (final = false pendant la saisie, true à la
 * validation, pour les calculs lourds : coupe, heures de soleil).
 */
export function ficheVolume(conteneur, o) {
  let v = null, numero = 0;
  const attr = s => String(s).replace(/"/g, "&quot;");
  /** Ligne : étiquette à gauche, `corps` (valeur et unité) à droite. */
  const ligne = (cle, corps, { titre = "", sous = false, id = "", balise = "label" } = {}) =>
    `<${balise} class="fv-ligne${sous ? " fv-sous" : ""}"${id ? ` data-ligne="${id}"` : ""}${titre ? ` title="${attr(t(titre))}"` : ""}><span class="fv-nom">${t(cle)}</span><span class="fv-val">${corps}</span></${balise}>`;
  const saisie = (k, unite, attrs = "") => `<input type="number" class="form-control form-control-sm" data-k="${k}" ${attrs}><span class="fv-unite">${unite}</span>`;
  const etage = (quoi, cle, titre) => ligne(cle, `<input type="number" class="form-control form-control-sm" data-etage="${quoi}" min="1" max="20" step="0.1"><span class="fv-unite">m</span>`, { titre, sous: true, id: quoi });
  const lu = (cle, valeur, unite, { titre = "", classe = "", params = {} } = {}) =>
    `<div class="fv-ligne${classe ? " " + classe : ""}"${titre ? ` title="${attr(t(titre))}"` : ""}><span class="fv-nom">${t(cle, params)}</span><span class="fv-val"><output>${valeur}</output><span class="fv-unite">${unite}</span></span></div>`;
  const section = cle => `<h3 class="fv-section">${t(cle)}</h3>`;
  const groupe = cle => `<h4 class="fv-groupe">${t(cle)}</h4>`;

  function construire() {
    fermerApparence();
    if (!v) { conteneur.hidden = true; conteneur.innerHTML = ""; return; }
    conteneur.hidden = false;
    conteneur.innerHTML = `
      ${section("fv.identite")}
      ${ligne("fv.nom", `<input type="text" class="form-control form-control-sm fv-plein" data-k="nom" maxlength="40" autocomplete="off" placeholder="${attr(t("carte.volume", { n: numero }))}">`, { id: "nom" })}
      ${ligne("fv.apparence", `<button type="button" class="fv-apparence fv-plein" data-apparence aria-haspopup="dialog" aria-expanded="false"><span class="fv-pastille"><i></i></span><span data-r="apparence"></span></button>`, { titre: "fv.apparenceTitre", balise: "div", id: "apparence" })}
      ${ligne("fv.traits", `<span class="form-check form-switch fv-plein"><input type="checkbox" role="switch" class="form-check-input" data-k="traits"></span>`, { titre: "fv.traitsTitre" })}

      ${section("fv.implantation")}
      ${v.libre
        ? ligne("fv.coins", `<output data-r="coins"></output><span class="fv-unite"></span>`, { balise: "div" })
          + `<details class="fv-cotes"><summary>${t("fv.cotes")}</summary><div data-r="cotes"></div></details>`
        : ligne("volume.largeur", saisie("volume.largeur", "m", 'min="1" max="500" step="0.1"'), { titre: "volume.largeurTitre" })
          + ligne("volume.profondeur", saisie("volume.profondeur", "m", 'min="1" max="500" step="0.1"'), { titre: "volume.profondeurTitre" })}
      ${ligne("fv.emprise", `<output data-r="aire"></output><span class="fv-unite">m²</span>`, { titre: "volume.aireTitre", balise: "div" })}
      ${ligne("volume.perimetre", `<output data-r="perimetre"></output><span class="fv-unite">m</span>`, { titre: "volume.perimetreTitre", balise: "div" })}
      ${ligne("fv.rotation", saisie("volume.rotation", "°", 'step="0.5"'), { titre: "volume.rotationTitre" })}
      ${ligne("fv.est", saisie("volume.est", "m", 'step="0.1"'), { titre: "volume.centreTitre" })}
      ${ligne("fv.nord", saisie("volume.nord", "m", 'step="0.1"'), { titre: "volume.centreTitre" })}
      ${ligne("fv.base", saisie("volume.base", "m", 'step="0.1"'), { titre: "volume.baseTitre" })}
      ${ligne("fv.terrain", `<output data-r="terrain"></output><span class="fv-unite">m</span>`, { titre: "fv.terrainTitre", balise: "div" })}

      ${section("fv.gabarit")}
      ${ligne("fv.etages", saisie("volume.etages", "", 'min="1" max="80" step="1"'), { titre: "volume.etagesTitre" })}
      ${etage("rez", "fv.rez", "volume.rezTitre")}
      ${etage("courant", "fv.courant", "volume.courantTitre")}
      ${etage("dernier", "fv.dernier", "volume.dernierTitre")}
      ${ligne("fv.corniche", saisie("volume.corniche", "m", 'min="1" max="300" step="0.1"'), { titre: "volume.cornicheTitre" })}
      ${ligne("volume.toit", `<select class="form-select form-select-sm fv-plein" data-k="toit">
          <option value="plat">${t("projet.plat")}</option><option value="deux" data-pans>${t("projet.deuxPans")}</option><option value="quatre" data-pans>${t("volume.quatrePans")}</option></select>`)}
      <p class="fv-note" data-ligne="sansPans">${t("volume.pansRectangle")}</p>
      ${ligne("volume.sens", `<select class="form-select form-select-sm fv-plein" data-k="sensFaite">
          <option value="long">${t("volume.sensLong")}</option><option value="court">${t("volume.sensCourt")}</option></select>`, { titre: "volume.sensTitre", sous: true, id: "sens" })}
      ${ligne("volume.pente", `<input type="number" class="form-control form-control-sm" data-k="pente" min="1" step="1">
          <button type="button" class="fv-unite fv-bascule" data-unite title="${attr(t("fv.uniteTitre"))}" aria-label="${attr(t("fv.uniteTitre"))}"></button>`, { titre: "volume.penteTitre", sous: true, id: "pente" })}
      ${ligne("fv.faite", saisie("volume.faite", "m", 'min="1" max="400" step="0.1"'), { titre: "volume.faiteTitre", sous: true, id: "faite" })}

      ${section("fv.resultats")}
      <div data-mesures></div>
      <p class="fv-note fv-aide">${t(v.libre ? "volume.aideLibre" : "volume.aideSouris")}</p>`;
    for (const i of conteneur.querySelectorAll("input, select")) {
      i.addEventListener("input", () => appliquer(i, false));
      i.addEventListener("change", () => appliquer(i, true));
    }
    conteneur.querySelector("[data-unite]").onclick = () => { v.unitePente = v.unitePente === "pct" ? "deg" : "pct"; o.changer(v, true); rafraichir(); };
    const pastille = conteneur.querySelector("[data-apparence]");
    pastille.onclick = () => {
      const id = v.id;
      ouvrirApparence(pastille, {
        lire: () => v && v.id === id ? { couleur: v.couleur, opacite: v.opacite } : null,
        changer: (a, final) => { v.couleur = a.couleur; v.opacite = a.opacite; o.changer(v, final); rafraichir(); },
      });
    };
    rafraichir();
  }

  // décimales des champs : centimètre partout, sauf les comptes et les angles
  const DEC = { "volume.etages": 0, "volume.rotation": 1, pente: 1 };
  /** Valeurs du volume dans les champs (sauf celui qu'on est en train de saisir), lignes utiles, mesures et distances. */
  function rafraichir() {
    if (!v) return;
    const $ = q => conteneur.querySelector(q), F = cadre(v), actif = document.activeElement, hc = corniche(v), ht = hauteurToit(v), [gx, gy] = v.libre ? centroide(v.coins) : [F.cx, F.cy];
    const pans = pansPossibles(v), plat = v.toit === "plat" || !pans, n = v.coins.length, E = v.etages.length;
    const val = {
      "volume.largeur": F.L, "volume.profondeur": F.P, "volume.rotation": deg(F.angle), "volume.est": o.S.E0 + gx, "volume.nord": o.S.N0 + gy,
      "volume.base": v.base, "volume.etages": E, "volume.corniche": hc, "volume.faite": hc + ht,
      toit: pans ? v.toit : "plat", sensFaite: v.sensFaite, nom: v.nom || "",
      pente: v.unitePente === "pct" ? Math.tan(v.pente * Math.PI / 180) * 100 : v.pente,
    };
    for (const i of conteneur.querySelectorAll("[data-k]")) {
      if (i.dataset.k === "traits") { i.checked = v.traits !== false; continue; }
      if (i === actif) continue;
      const x = val[i.dataset.k];
      if (x != null) i.value = typeof x === "number" ? x.toFixed(DEC[i.dataset.k] ?? 2) : x;
    }
    const valEtage = { rez: v.etages[0], courant: etageCourant(v), dernier: v.etages[E - 1] };
    for (const i of conteneur.querySelectorAll("[data-etage]")) if (i !== actif) i.value = (+valEtage[i.dataset.etage]).toFixed(2);
    // apparence : pastille (couleur et opacité sur damier) et rappel chiffré
    const couleur = v.couleur || COULEUR_DEFAUT, op = Math.round((v.opacite ?? 1) * 100);
    $(".fv-pastille i").style.cssText = `background:${couleur};opacity:${op / 100}`;
    $('[data-r="apparence"]').textContent = `${couleur.toUpperCase()} · ${op} %`;
    // emprise
    $('[data-r="aire"]').textContent = fr(aire(v.coins), 2);
    $('[data-r="perimetre"]').textContent = fr(perimetre(v.coins), 2);
    if (v.libre) {
      $('[data-r="coins"]').textContent = n;
      $(".fv-cotes summary").textContent = `${t("fv.cotes")} (${n})`;
      $('[data-r="cotes"]').innerHTML = v.coins.map((p, k) => { const q = v.coins[(k + 1) % n]; return lu("fv.cote", fr(Math.hypot(q[0] - p[0], q[1] - p[1]), 2), "m", { classe: "fv-sous", params: { a: k + 1, b: (k + 1) % n + 1 } }); }).join("");
    }
    // lignes utiles seulement : étages courants et dernier s'il y en a, réglages du toit à pans s'il en porte un
    const montrer = (id, oui) => { const l = $(`[data-ligne="${id}"]`); if (l) l.hidden = !oui; };
    montrer("courant", E > 2); montrer("dernier", E > 1);
    montrer("sansPans", !pans); montrer("sens", !plat && v.toit === "deux"); montrer("pente", !plat); montrer("faite", !plat);
    for (const op2 of conteneur.querySelectorAll("[data-pans]")) op2.disabled = !pans;
    $("[data-unite]").textContent = v.unitePente === "pct" ? "%" : "°";

    // résultats : surfaces et volume, altitudes, hauteurs sur le terrain par coin, distances
    const M = o.mesures(v), m = (x, d = 2) => x == null ? "—" : fr(x, d);
    const sols = M.coins.map(c => c.sol), hcs = M.coins.map(c => c.corniche), hfs = M.coins.map(c => c.faite);
    $('[data-r="terrain"]').textContent = `${fr(Math.min(...sols), 2)} – ${fr(Math.max(...sols), 2)}`;
    const marque = (x, liste) => x === Math.min(...liste) ? ` class="fv-min" title="${t("volume.min")}"` : x === Math.max(...liste) ? ` class="fv-max" title="${t("volume.max")}"` : "";
    const limites = (M.limites?.length ? M.limites : M.limite ? [{ ...M.limite, numero: M.parcelle }] : []).slice(0, 4);
    const bats = (M.batiments || []).filter(b => b.d < 80);
    $("[data-mesures]").innerHTML = `
      ${groupe("fv.surfaces")}
      ${lu("fv.plancher", fr(surfacePlancher(v), 2), "m²", { titre: "fv.plancherTitre" })}
      ${lu("fv.volume", fr(volumeBati(v), 1), "m³", { titre: "fv.volumeTitre" })}
      ${groupe("fv.altitudes")}
      ${lu("volume.altCorniche", m(M.zc), "m")}
      ${plat ? "" : lu("volume.altFaite", m(M.zf), "m")}
      ${groupe("fv.hauteurs")}
      <table class="fv-table fv-coins"><thead><tr><th>${t("volume.coin")}</th><th>${t("volume.terrain")}</th><th>${t("volume.hCorniche")}</th>${plat ? "" : `<th>${t("volume.hFaite")}</th>`}</tr></thead><tbody>
        ${M.coins.map((c, k) => `<tr><th>${k + 1}</th><td>${fr(c.sol, 2)}</td><td${marque(c.corniche, hcs)}>${fr(c.corniche, 2)}</td>${plat ? "" : `<td${marque(c.faite, hfs)}>${fr(c.faite, 2)}</td>`}</tr>`).join("")}
      </tbody></table>
      ${groupe("fv.limites")}
      ${limites.length ? limites.map(l => lu(l.numero != null ? "carte.limite" : "carte.limiteSans", m(l.d), "m", { classe: l.d < 0.005 ? "fv-alerte" : "", params: { n: esc(l.numero) } })).join("")
          + lu("fv.limiteMoyenne", m(M.moyenneLimite), "m")
        : `<p class="fv-note">${t("carte.sansMesure")}</p>`}
      ${groupe("fv.batiments")}
      ${bats.length ? bats.map((b, k) => lu("fv.batiment", m(b.d), "m", { classe: b.d < 0.005 ? "fv-alerte" : "", params: { n: k + 1 } })).join("")
          + lu("fv.batMoyenne", m(M.voisins.moyenne), "m", { params: { n: M.voisins.n } })
        : `<p class="fv-note">${t("fv.aucunBatiment")}</p>`}`;
  }

  function appliquer(i, final) {
    if (!v) return;
    const k = i.dataset.k, x = +i.value;
    if (i.dataset.etage != null) { if (x >= 1) reglerEtage(v, i.dataset.etage, x); }
    else if (k === "nom") { const nom = i.value.trim(); if (nom) v.nom = nom; else delete v.nom; }
    else if (k === "traits") { if (i.checked) delete v.traits; else v.traits = false; }
    else if (k === "toit" || k === "sensFaite") v[k] = i.value;
    else if (i.value === "" || !isFinite(x)) return;
    else if (k === "pente") v.pente = Math.max(1, Math.min(80, v.unitePente === "pct" ? Math.atan(x / 100) * 180 / Math.PI : x));
    else if (k === "volume.etages") reglerEtages(v, x);
    else if (k === "volume.corniche") reglerCorniche(v, x);
    else if (k === "volume.faite") reglerFaite(v, x - corniche(v));
    else if (k === "volume.base") v.base = Math.round(x * 100) / 100;
    else if (v.libre) {
      // emprise libre : rotation autour du centre de gravité (angle du côté 1–2), position du centre de gravité
      const [gx, gy] = centroide(v.coins);
      if (k === "volume.rotation") {
        const a = x * Math.PI / 180 - cadre(v).angle, co = Math.cos(a), si = Math.sin(a);
        v.coins = v.coins.map(([px, py]) => [gx + (px - gx) * co - (py - gy) * si, gy + (px - gx) * si + (py - gy) * co]);
      } else if (k === "volume.est" || k === "volume.nord") {
        const dx = k === "volume.est" ? x - o.S.E0 - gx : 0, dy = k === "volume.nord" ? x - o.S.N0 - gy : 0;
        v.coins = v.coins.map(([px, py]) => [px + dx, py + dy]);
      } else return;
    }
    else {
      const F = cadre(v);
      if (k === "volume.largeur" && x >= 1) F.L = x;
      else if (k === "volume.profondeur" && x >= 1) F.P = x;
      else if (k === "volume.rotation") F.angle = x * Math.PI / 180;
      else if (k === "volume.est") F.cx = x - o.S.E0;
      else if (k === "volume.nord") F.cy = x - o.S.N0;
      else return;
      v.coins = coinsDe(F);
    }
    o.changer(v, final);
    rafraichir(); // les autres champs et les mesures suivent, sans toucher au champ en cours de saisie
  }

  return {
    /** Volume affiché (null : fenêtre cachée) et son numéro dans la liste. */
    montrer(vol, n) { const autre = vol !== v || n !== numero || !conteneur.firstChild; v = vol; numero = n; if (autre) construire(); else rafraichir(); },
    rafraichir() { if (v) rafraichir(); },
    get volume() { return v; },
  };
}
