// Tableau du volume sélectionné (onglet Projet) : dimensions (emprise libre : aire et périmètre), position MN95, rotation, étages, toit (pente, faîtage),
// opacité ; altitudes, hauteurs au-dessus du terrain à chaque coin, distances aux bâtiments et à la limite de parcelle.
// Les champs mettent la maquette à jour aussitôt ; la souris (déplacer, tourner, tirer une face) les met à jour en retour.
import { t, nombre } from "./i18n.js";
import { solEn } from "./grille.js";
import { cadre, coinsDe, corniche, hauteurToit, reglerCorniche, reglerEtages, reglerFaite, distanceSegments, dansPolygone, reglerEtage, etageCourant, aire, perimetre, centroide, pansPossibles } from "./projet.js";

const fr = (v, d = 1) => nombre(v, d);
const deg = r => ((r * 180 / Math.PI) % 360 + 360) % 360;

/**
 * Mesures d'un volume (en plan, entre emprises, pas entre centres) :
 * batiment { d, p, q } le plus proche, voisins (bâtiments à moins de 50 m : nombre et distance moyenne),
 * limite { d, p, q } la plus proche et moyenne des quatre façades, altitudes et hauteurs au-dessus du terrain aux coins.
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
  const hc = corniche(v), ht = hauteurToit(v), zc = v.base + hc, zf = zc + ht;
  const coins = v.coins.map(([x, y]) => { const sol = solEn(G, x, y); return { sol, corniche: zc - sol, faite: zf - sol }; });
  return { batiment, voisins, limite, moyenneLimite, parcelle: q?.numero, base: v.base, zc, zf, coins };
}

/** Cotes à dessiner en 3D (editionVolumes) : vers le bâtiment et la limite les plus proches. */
export function cotesVolume(v, M, scene) {
  const G = scene.G, out = [];
  const z = (p, q) => Math.max(solEn(G, ...p), solEn(G, ...q), v.base) - scene.zRef + 0.3;
  if (M.batiment && M.batiment.d > 0.05 && M.batiment.d < 80) out.push({ p: M.batiment.p, q: M.batiment.q, z: z(M.batiment.p, M.batiment.q), texte: `${fr(M.batiment.d)} m`, couleur: "#3a332c" });
  if (M.limite && M.limite.d > 0.05) out.push({ p: M.limite.p, q: M.limite.q, z: z(M.limite.p, M.limite.q), texte: `${fr(M.limite.d)} m`, couleur: scene.T?.parcelle || "#e0262b" });
  return out;
}

/**
 * Tableau du volume dans `conteneur`. `o` = { S, mesures(v), changer(v, final) } : `changer` applique (final = false
 * pendant la saisie, true à la validation, pour les calculs lourds : coupe, heures de soleil).
 */
export function ficheVolume(conteneur, o) {
  let v = null, numero = 0;
  const champ = (cle, titre, attrs = "") => `<label class="fv-champ" title="${titre}"><span>${t(cle)}</span><input type="number" class="form-control form-control-sm" data-k="${cle}" ${attrs}></label>`;
  function construire() {
    if (!v) { conteneur.hidden = true; conteneur.innerHTML = ""; return; }
    conteneur.hidden = false;
    const E = v.etages;
    conteneur.innerHTML = `
      <div class="fv-tete"><b>${t("volume.titre", { n: numero })}</b><span class="text-secondary">${t(v.libre ? "volume.aideLibre" : "volume.aideSouris")}</span></div>
      <div class="fv-groupe">${t("volume.dimensions")}</div>
      <div class="fv-grille">
        ${v.libre ? champ("volume.aire", t("volume.aireTitre"), "readonly") + champ("volume.perimetre", t("volume.perimetreTitre"), "readonly")
          : champ("volume.largeur", t("volume.largeurTitre"), 'min="1" max="500" step="0.1"') + champ("volume.profondeur", t("volume.profondeurTitre"), 'min="1" max="500" step="0.1"')}
        ${champ("volume.rotation", t("volume.rotationTitre"), 'step="0.5"')}
      </div>
      <div class="fv-groupe">${t("volume.position")}</div>
      <div class="fv-grille fv-position">
        ${champ("volume.est", t("volume.centreTitre"), 'step="0.1"')}
        ${champ("volume.nord", t("volume.centreTitre"), 'step="0.1"')}
        ${champ("volume.base", t("volume.baseTitre"), 'step="0.1"')}
      </div>
      <div class="fv-groupe">${t("volume.hauteurs")}</div>
      <div class="fv-grille">
        ${champ("volume.etages", t("volume.etagesTitre"), 'min="1" max="80" step="1"')}
        ${champ("volume.corniche", t("volume.cornicheTitre"), 'min="1" max="300" step="0.1"')}
        ${champ("volume.faite", t("volume.faiteTitre"), 'min="1" max="400" step="0.1"')}
      </div>
      <div class="fv-etages">
        <label title="${t("volume.rezTitre")}"><span>${t("volume.rez")}</span><input type="number" class="form-control form-control-sm" data-etage="rez" min="1" max="20" step="0.1"></label>
        ${E.length > 2 ? `<label title="${t("volume.courantTitre")}"><span>${t("volume.courant")}</span><input type="number" class="form-control form-control-sm" data-etage="courant" min="1" max="20" step="0.1"></label>` : ""}
        ${E.length > 1 ? `<label title="${t("volume.dernierTitre")}"><span>${t("volume.dernier")}</span><input type="number" class="form-control form-control-sm" data-etage="dernier" min="1" max="20" step="0.1"></label>` : ""}
      </div>
      <div class="fv-grille fv-toit">
        <label class="fv-champ"><span>${t("volume.toit")}</span><select class="form-select form-select-sm" data-k="toit">
          <option value="plat">${t("projet.plat")}</option><option value="deux" data-pans>${t("projet.deuxPans")}</option><option value="quatre" data-pans>${t("volume.quatrePans")}</option></select></label>
        <label class="fv-champ" title="${t("volume.sensTitre")}"><span>${t("volume.sens")}</span><select class="form-select form-select-sm" data-k="sensFaite">
          <option value="long">${t("volume.sensLong")}</option><option value="court">${t("volume.sensCourt")}</option></select></label>
        <label class="fv-champ" title="${t("volume.penteTitre")}"><span>${t("volume.pente")}</span><input type="number" class="form-control form-control-sm" data-k="pente" min="1" step="1"></label>
        <label class="fv-champ" title="${t("volume.penteTitre")}"><span>${t("volume.unite")}</span><select class="form-select form-select-sm" data-k="unitePente"><option value="deg">${t("volume.degres")}</option><option value="pct">${t("volume.pourcent")}</option></select></label>
      </div>
      <label class="fv-opacite"><span>${t("volume.opacite")}</span><input type="range" class="form-range" data-k="opacite" min="10" max="100" step="5"><output></output></label>
      <div class="fv-groupe">${t("volume.altitudes")}</div>
      <div class="fv-mesures" data-mesures></div>`;
    for (const i of conteneur.querySelectorAll("input, select")) {
      i.addEventListener("input", () => appliquer(i, false));
      i.addEventListener("change", () => appliquer(i, true));
    }
    rafraichir();
  }

  /** Valeurs du volume dans les champs (sauf celui qu'on est en train de saisir), mesures et distances. */
  function rafraichir() {
    if (!v) return;
    if (conteneur.querySelectorAll("[data-etage]").length !== Math.min(3, v.etages.length) || !!conteneur.querySelector('[data-k="volume.aire"]') !== !!v.libre) return construire();
    const F = cadre(v), actif = document.activeElement, hc = corniche(v), ht = hauteurToit(v), [gx, gy] = v.libre ? centroide(v.coins) : [F.cx, F.cy];
    const pans = pansPossibles(v);
    const val = {
      "volume.largeur": F.L, "volume.profondeur": F.P, "volume.rotation": deg(F.angle), "volume.est": o.S.E0 + gx, "volume.nord": o.S.N0 + gy,
      "volume.aire": aire(v.coins), "volume.perimetre": perimetre(v.coins),
      "volume.base": v.base, "volume.etages": v.etages.length, "volume.corniche": hc, "volume.faite": hc + ht,
      toit: pans ? v.toit : "plat", sensFaite: v.sensFaite, unitePente: v.unitePente, opacite: Math.round((v.opacite ?? 1) * 100),
      pente: v.unitePente === "pct" ? Math.round(Math.tan(v.pente * Math.PI / 180) * 1000) / 10 : v.pente,
    };
    for (const i of conteneur.querySelectorAll("[data-k]")) {
      if (i === actif && i.type !== "range") continue;
      const x = val[i.dataset.k];
      if (x == null) continue;
      i.value = typeof x === "number" ? (i.step === "1" || i.dataset.k === "opacite" ? Math.round(x * 10) / 10 : (Math.round(x * 10) / 10).toFixed(1)) : x;
    }
    const valEtage = { rez: v.etages[0], courant: etageCourant(v), dernier: v.etages[v.etages.length - 1] };
    for (const i of conteneur.querySelectorAll("[data-etage]")) if (i !== actif) i.value = (+valEtage[i.dataset.etage]).toFixed(1);
    conteneur.querySelector(".fv-opacite output").textContent = `${val.opacite} %`;
    const plat = v.toit === "plat" || !pans;
    // toits à pans : seulement sur un rectangle
    for (const op of conteneur.querySelectorAll("[data-pans]")) op.disabled = !pans;
    conteneur.querySelector('[data-k="toit"]').title = pans ? "" : t("volume.pansRectangle");
    conteneur.querySelector('[data-k="volume.faite"]').disabled = plat;
    conteneur.querySelector('[data-k="pente"]').disabled = conteneur.querySelector('[data-k="unitePente"]').disabled = plat;
    conteneur.querySelector('[data-k="sensFaite"]').disabled = plat || v.toit !== "deux";
    // altitudes, coins, distances
    const M = o.mesures(v), m = (x, d = 1) => x == null ? "—" : `${fr(x, d)} m`;
    const hcs = M.coins.map(c => c.corniche), hfs = M.coins.map(c => c.faite);
    const marque = (x, liste) => x === Math.min(...liste) ? ` class="fv-min" title="${t("volume.min")}"` : x === Math.max(...liste) ? ` class="fv-max" title="${t("volume.max")}"` : "";
    conteneur.querySelector("[data-mesures]").innerHTML = `
      <table class="fv-table"><tbody>
        <tr><th>${t("volume.altBase")}</th><td>${m(M.base, 2)}</td></tr>
        <tr><th>${t("volume.altCorniche")}</th><td>${m(M.zc, 2)}</td></tr>
        ${plat ? "" : `<tr><th>${t("volume.altFaite")}</th><td>${m(M.zf, 2)}</td></tr>`}
      </tbody></table>
      <div class="fv-groupe">${t("volume.coins")}</div>
      <table class="fv-table fv-coins"><thead><tr><th>${t("volume.coin")}</th><th>${t("volume.terrain")}</th><th>${t("volume.hCorniche")}</th>${plat ? "" : `<th>${t("volume.hFaite")}</th>`}</tr></thead><tbody>
        ${M.coins.map((c, k) => `<tr><th>${k + 1}</th><td>${fr(c.sol, 2)}</td><td${marque(c.corniche, hcs)}>${fr(c.corniche)}</td>${plat ? "" : `<td${marque(c.faite, hfs)}>${fr(c.faite)}</td>`}</tr>`).join("")}
      </tbody></table>
      <div class="fv-groupe">${t("volume.distances")}</div>
      <table class="fv-table"><tbody>
        <tr><th>${t("volume.batProche")}</th><td>${M.batiment ? m(M.batiment.d) : t("volume.aucun")}</td></tr>
        <tr><th>${t("volume.batMoyenne", { n: M.voisins.n })}</th><td>${m(M.voisins.moyenne)}</td></tr>
        <tr><th>${t("volume.limiteMin", { n: M.parcelle ?? "—" })}</th><td>${M.limite ? m(M.limite.d) : "—"}</td></tr>
        <tr><th>${t("volume.limiteMoyenne")}</th><td>${m(M.moyenneLimite)}</td></tr>
      </tbody></table>`;
  }

  function appliquer(i, final) {
    if (!v) return;
    const k = i.dataset.k, x = +i.value;
    if (i.dataset.etage != null) { if (x >= 1) reglerEtage(v, i.dataset.etage, x); }
    else if (k === "toit" || k === "sensFaite" || k === "unitePente") v[k] = i.value;
    else if (i.value === "" || !isFinite(x)) return;
    else if (k === "opacite") v.opacite = Math.max(0.1, Math.min(1, x / 100));
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
    /** Volume affiché (null : tableau caché) et son numéro dans la liste. */
    montrer(vol, n) { v = vol; numero = n; construire(); },
    rafraichir() { if (v) rafraichir(); },
    get volume() { return v; },
  };
}
