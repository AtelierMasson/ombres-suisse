// Fiche du lieu sélectionné (bas à droite) : parcelle (mensuration officielle) et bâtiment (registre fédéral des
// bâtiments et des logements, RegBL), tirés de geo.admin.ch au point cliqué, avec les liens utiles.
const IDENT = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify";

const GKAT = { 1010: "fiche.kat1010", 1020: "fiche.kat1020", 1030: "fiche.kat1030", 1040: "fiche.kat1040", 1060: "fiche.kat1060", 1080: "fiche.kat1080" };
const ENERGIE = { 7500: "fiche.e7500", 7501: "fiche.e7501", 7510: "fiche.e7510", 7511: "fiche.e7510", 7512: "fiche.e7510", 7513: "fiche.e7510",
  7520: "fiche.e7520", 7530: "fiche.e7530", 7540: "fiche.e7540", 7541: "fiche.e7540", 7542: "fiche.e7540", 7543: "fiche.e7540",
  7550: "fiche.e7550", 7560: "fiche.e7560", 7570: "fiche.e7570", 7580: "fiche.e7580" };

// réponses gardées (même parcelle, même bâtiment : la fiche revient aussitôt)
const MEMOIRE = new Map();
async function identifier(couche, geom, type, tol = 0) {
  const cle = `${couche}|${geom.map(v => Math.round(v)).join(",")}`;
  if (!MEMOIRE.has(cle)) { const p = identifierReseau(couche, geom, type, tol); MEMOIRE.set(cle, p); p.catch(() => MEMOIRE.delete(cle)); }
  return MEMOIRE.get(cle);
}
async function identifierReseau(couche, geom, type, tol = 0) {
  // coordonnées entières : le service ne rend rien avec des décimales
  geom = geom.map(v => Math.round(v));
  const [e0, n0] = geom;
  const g = geom.join(","), ext = `${e0 - 60},${n0 - 60},${e0 + 120},${n0 + 120}`;
  const u = `${IDENT}?geometryType=${type}&geometry=${g}&imageDisplay=500,500,96&mapExtent=${ext}&tolerance=${tol}&layers=all:${couche}&sr=2056&returnGeometry=false&lang=${document.documentElement.lang || "fr"}`;
  const r = await fetch(u);
  return r.ok ? (await r.json()).results || [] : [];
}

/** Bâtiments du registre (RegBL) sur une parcelle, par son EGRID. */
function batimentsParcelle(egrid) {
  const cle = `egrid|${egrid}`;
  if (!MEMOIRE.has(cle)) {
    const u = `https://api3.geo.admin.ch/rest/services/api/MapServer/find?layer=ch.bfs.gebaeude_wohnungs_register&searchText=${encodeURIComponent(egrid)}&searchField=egrid&contains=false&returnGeometry=false`;
    const p = fetch(u).then(r => r.ok ? r.json() : { results: [] }).then(d => (d.results || []).map(r => r.attributes).filter(a => a?.egid));
    MEMOIRE.set(cle, p); p.catch(() => MEMOIRE.delete(cle));
  }
  return MEMOIRE.get(cle);
}

/** `conteneur` : élément où poser la fiche ; `t` : traductions. */
export function brancherFiche(conteneur, t) {
  const boite = document.createElement("aside");
  boite.id = "fiche";
  boite.className = "card shadow";
  boite.hidden = true;
  conteneur.append(boite);
  let demande = 0;

  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const ligne = (cle, v) => v == null || v === "" ? "" : `<dt>${esc(t(cle))}</dt><dd>${esc(v)}</dd>`;
  // liens : https seulement (une adresse fournie par un service externe pourrait être « javascript: »)
  const lien = (url, cle) => /^https:\/\//i.test(String(url)) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(t(cle))} ↗</a>` : "";

  function fermer() { demande++; boite.hidden = true; }

  /**
   * Montre la fiche du point (E, N) en MN95. `batiment` : true si un bâtiment a été cliqué (le plus proche du point
   * dans le RegBL est retenu) ; `mesures` : { hauteur, emprise } tirées de la maquette (facultatif) ; `surface` : m²
   * de la parcelle calculée sur son contour (facultatif).
   */
  async function montrer(E, N, { batiment = false, mesures = null, surface = null, numero = null } = {}) {
    const id = ++demande;
    // pas d'état « recherche… » qui fait sauter la fiche : l'ancienne reste (estompée) jusqu'à la nouvelle ; une fiche
    // encore fermée n'apparaît qu'avec ses informations (ou, si le service tarde plus d'une seconde, avec l'attente)
    clearTimeout(boite._attente);
    if (!boite.hidden) boite.classList.add("fiche-maj");
    else boite._attente = setTimeout(() => {
      if (id !== demande) return;
      boite.innerHTML = `<button type="button" class="btn-close btn-sm" data-fermer aria-label="${esc(t("fiche.fermer"))}"></button><div class="card-body">`
        + (numero ? `<div class="fiche-titre">${esc(t("fiche.parcelle", { n: numero }))}</div>` : "")
        + `<div class="small text-secondary mt-1">${esc(t("fiche.chargement"))}</div></div>`;
      boite.hidden = false;
    }, 1000);
    let parc = null, bat = null, liste = [];
    try {
      const [p, b] = await Promise.all([
        identifier("ch.kantone.cadastralwebmap-farbe", [E, N], "esriGeometryPoint"),
        // le registre situe un bâtiment à son entrée (adresse), parfois à 15–20 m du point cliqué : recherche sur ±30 m
        batiment ? identifier("ch.bfs.gebaeude_wohnungs_register", [E - 30, N - 30, E + 30, N + 30], "esriGeometryEnvelope") : Promise.resolve([]),
      ]);
      parc = p.find(r => r.attributes?.number)?.attributes || null;
      // bâtiment : l'entrée du RegBL la plus proche du point cliqué
      // bâtiments de la parcelle (aucun, un ou plusieurs) ; un bâtiment cliqué : celui de la parcelle le plus proche
      liste = parc?.egris_egrid ? await batimentsParcelle(parc.egris_egrid) : [];
      const proche = l => [...l].sort((a, c) => Math.hypot(a.gkode - E, a.gkodn - N) - Math.hypot(c.gkode - E, c.gkodn - N))[0] || null;
      if (batiment) bat = proche(liste.length ? liste : b.map(r => r.attributes).filter(a => a?.egid));
      else if (liste.length === 1) bat = liste[0];
    } catch { /* réseau : la fiche dit ce qu'elle a */ }
    if (id !== demande) return;
    clearTimeout(boite._attente);
    boite.classList.remove("fiche-maj");
    boite.hidden = false;
    let h = `<button type="button" class="btn-close btn-sm" data-fermer aria-label="${esc(t("fiche.fermer"))}"></button><div class="card-body">`;
    if (bat) {
      const adresse = [bat.strname_deinr, [bat.dplz4, bat.dplzname || bat.ggdename].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      h += `<div class="fiche-titre">${esc(adresse || t("fiche.batiment"))}</div><dl>`
        + ligne("fiche.categorie", GKAT[bat.gkat] ? t(GKAT[bat.gkat]) : null)
        + ligne("fiche.annee", bat.gbauj || null)
        + ligne("fiche.niveaux", bat.gastw || null)
        + ligne("fiche.logements", bat.ganzwhg || null)
        + ligne("fiche.empriseRegbl", bat.garea ? `${bat.garea} m²` : null)
        + ligne("fiche.sre", bat.gebf ? `${bat.gebf} m²` : null)
        + ligne("fiche.chauffage", ENERGIE[bat.genh1] ? t(ENERGIE[bat.genh1]) : null)
        + ligne("fiche.hauteur", mesures?.hauteur ? `${mesures.hauteur} m` : null)
        + ligne("fiche.egid", bat.egid) + "</dl>";
    } else if (batiment) h += `<div class="small text-secondary">${esc(t("fiche.pasDeRegbl"))}</div>`;
    if (!batiment && liste.length > 1) {
      h += `<div class="fiche-titre">${esc(t("fiche.nBatiments", { n: liste.length }))}</div><ul class="fiche-bats">`
        + liste.slice(0, 12).map(a => `<li><span>${esc(a.strname_deinr || "—")}</span><span class="text-secondary">${esc([a.gbauj, a.gastw ? t("fiche.nNiveaux", { n: a.gastw }) : ""].filter(Boolean).join(" · "))}</span></li>`).join("")
        + `</ul>`;
    } else if (!batiment && parc && !liste.length) h += `<div class="small text-secondary mb-1">${esc(t("fiche.aucunBatiment"))}</div>`;
    if (parc) {
      h += `<div class="fiche-titre${bat || liste.length ? " mt-2" : ""}">${esc(t("fiche.parcelle", { n: parc.number }))} · ${esc(parc.ak || "")}</div><dl>`
        + ligne("fiche.commune", bat?.ggdename || null)
        + ligne("fiche.surface", surface ? `${Math.round(surface).toLocaleString("fr-CH")} m²` : null)
        + ligne("fiche.egrid", parc.egris_egrid) + "</dl>";
    }
    if (!bat && !parc) h += `<div class="small text-secondary">${esc(t("fiche.rien"))}</div>`;
    const liens = [];
    if (parc?.geoportal_url) liens.push(lien(parc.geoportal_url, "fiche.geoportail"));
    if (parc?.egris_egrid) liens.push(lien(`https://map.geo.admin.ch/?swisssearch=${encodeURIComponent(parc.egris_egrid)}&lang=${document.documentElement.lang || "fr"}`, "fiche.mapGeoAdmin"));
    if (bat?.egid) liens.push(lien(`https://www.housing-stat.ch/fr/query/egid.html?egid=${encodeURIComponent(bat.egid)}`, "fiche.regbl"));
    else if (liste[0]?.egid) liens.push(lien(`https://www.housing-stat.ch/fr/query/egid.html?egid=${encodeURIComponent(liste[0].egid)}`, "fiche.regbl"));
    if (liens.length) h += `<div class="fiche-liens">${liens.join("")}</div>`;
    h += `<div class="fiche-source">${esc(t("fiche.source"))}</div></div>`;
    boite.innerHTML = h;
  }

  boite.addEventListener("click", e => { if (e.target.closest("[data-fermer]")) fermer(); });
  return { montrer, fermer };
}
