// Mode pro : sélection et masquage de bâtiments (retirés aussi des calculs), taille de la maquette, exports.
// Les outils n'apparaissent que lorsque l'interrupteur « Mode pro » est activé.
import { ficheVolumes, volumesParcelle } from "./volumes.js";
import { FORMATS, exporterSite, estimer, sansAccent } from "./export.js";
import { dessinCoupe, coupeDxf, coupeSvg } from "./exportCoupe.js";
import { t, nombre, entier, date } from "./i18n.js";
import { rectangle, dimensions, listerProjets, enregistrerProjet, supprimerProjet } from "./projet.js";
import { importerModele } from "./importer.js";
import { dxfReference } from "./referenceParcelle.js";
import { solEn } from "./grille.js";

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const memoire = (cle, valeur) => {
  try { if (valeur === undefined) return localStorage.getItem(cle); localStorage.setItem(cle, valeur); } catch { /* stockage indisponible */ }
  return null;
};
const fr = (v, d = 1) => nombre(v, d); // nombre décimal dans la langue choisie (virgule en français)
const mo = o => o < 1e6 ? t("unite.ko", { n: Math.max(1, Math.round(o / 1e3)) }) : t("unite.mo", { n: fr(o / 1e6) });

function telecharger(blob, nom) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

/**
 * Branche le mode pro. `o` = { scene, S, message, etat, recharger, calculerHeures, annulerCalcul, majCoupe, soleilActuel }
 * (état et fonctions de main.js). Retourne { rayon(), reinitialiser() }.
 */
export function brancherPro(o) {
  const { scene, S } = o;
  const P = { selection: new Set(), masques: new Set(), historique: [], volumes: [], imports: [], projet: null };
  const actif = () => $("#vPro").checked;
  const jeu = () => $("input[name=batiments]:checked")?.value || "releve";
  const pret = () => !!S.G && S.lat != null && !!scene.contoursTous;

  /* ---------------------------------------------------------------- sélection et masquage */
  function maj() {
    const releve = jeu() === "releve", V = pret() ? scene.indexer() : null;
    if (!actif() || !releve) P.selection.clear();
    if (pret()) scene.surbrillance(actif() ? P.selection : null);
    $("#btnSelection").disabled = $("#btnSelParcelle").disabled = !releve;
    $("#btnMasquer").disabled = !P.selection.size;
    $("#btnReafficher").disabled = !P.masques.size;
    $("#btnAnnuler").disabled = !P.historique.length;
    const nbMasques = V ? new Set([...P.masques].map(s => V.bati[s])).size : 0;
    $("#etatPro").textContent = P.masques.size ? t("pro.etat", { n: nbMasques, v: P.masques.size }) : "";
    const F = V && P.selection.size ? ficheVolumes(S.G, scene.contoursTous, V, P.selection) : null;
    $("#fichePro").innerHTML = F
      ? `<b>${F.batiments > 1 ? t("pro.ficheN", { n: F.batiments }) : F.volumes > 1 ? t("pro.ficheVolumes", { n: F.volumes }) : t($("#vParVolume").checked ? "pro.ficheVolume" : "pro.ficheBatiment")}</b><br>`
        + t("pro.ficheHauteur", { haut: fr(F.haut), moyenne: fr(F.moyenne) })
        + t("pro.ficheEmprise", { emprise: entier(F.emprise), n: F.niveaux })
        + `<span class="text-secondary">${t("pro.ficheSommet", { z: fr(F.sommet) })}</span>`
      : `<span class="text-secondary">${!releve ? t("pro.aideReleve")
        : $("#btnSelection").classList.contains("active") ? t("pro.aideClic") : ""}</span>`;
    majExport();
  }

  scene.surClic = e => {
    if (dessin) return clicDessin(e);
    if (!actif() || !pret() || jeu() !== "releve" || !$("#btnSelection").classList.contains("active")) return;
    const V = scene.indexer(), s = scene.designer(e);
    const ids = s < 0 ? [] : $("#vParVolume").checked ? [s] : V.parBati[V.bati[s]].filter(v => !P.masques.has(v));
    if (!e.shiftKey) P.selection = new Set(ids);
    else if (ids.length && ids.every(v => P.selection.has(v))) ids.forEach(v => P.selection.delete(v));
    else ids.forEach(v => P.selection.add(v));
    maj();
  };
  $("#btnSelection").onclick = () => { $("#btnSelection").classList.toggle("active"); maj(); };
  $("#btnSelParcelle").onclick = () => {
    if (!pret()) return;
    const ids = volumesParcelle(S.G, scene.indexer(), S.parcelle?.anneauxRel || []);
    P.selection = new Set([...ids].filter(s => !P.masques.has(s)));
    if (!P.selection.size) o.message(t(ids.size ? "pro.dejaMasques" : "pro.aucunBatiment"));
    maj();
  };

  /** Applique l'ensemble des volumes masqués à la scène et à tout ce qui en dépend (ombres, heures, coupe). */
  function appliquer() {
    scene.masquer(P.masques);
    S.facades = null; // les carreaux de façade sont à refaire
    if (S.heuresDemandees) {
      scene.afficherHeures(null);
      S.resultat = null;
      if ($("#vHeures").checked) o.calculerHeures();
      else { o.annulerCalcul(); S.heuresDemandees = false; $("#heures").hidden = true; $("#btnHeures").textContent = t("heures.calculer"); }
    }
    if (S.coupe) o.majCoupe(S.coupe.A, S.coupe.B);
    maj();
  }
  const changer = masques => { P.historique.push(P.masques); P.masques = masques; P.selection.clear(); appliquer(); };
  $("#btnMasquer").onclick = () => { if (P.selection.size) changer(new Set([...P.masques, ...P.selection])); };
  $("#btnReafficher").onclick = () => { if (P.masques.size) changer(new Set()); };
  $("#btnAnnuler").onclick = () => { if (P.historique.length) { P.masques = P.historique.pop(); P.selection.clear(); appliquer(); } };
  $$("input[name=batiments]").forEach(b => b.addEventListener("change", maj));
  $("#vParVolume").addEventListener("change", () => { P.selection.clear(); maj(); });

  /* ---------------------------------------------------------------- volumes du projet */
  // dessin d'un rectangle en trois clics sur la maquette : A, B (un côté), puis la profondeur ; aperçu qui suit la souris
  let dessin = null, numero = 0, finAt = 0;
  const aide = () => $("#aideVolume").textContent = !dessin ? "" : t(["projet.aideA", "projet.aideB", "projet.aideC"][dessin.length]);
  function finDessin() {
    dessin = null; finAt = performance.now(); // le clic qui termine ne doit pas aussi choisir une parcelle
    $("#btnVolume").classList.remove("active");
    scene.renderer.domElement.style.cursor = "";
    scene.afficherVolumes(P.volumes);
    aide();
  }
  $("#btnVolume").onclick = () => {
    if (dessin) return finDessin();
    if (!pret()) return;
    dessin = [];
    $("#btnVolume").classList.add("active");
    $("#btnSelection").classList.remove("active");
    scene.renderer.domElement.style.cursor = "crosshair";
    aide(); maj();
  };
  addEventListener("keydown", e => { if (e.key === "Escape" && dessin) finDessin(); });
  const pointDessin = e => { const p = scene.pointSol(e); return p && Math.max(Math.abs(p[0]), Math.abs(p[1])) < S.G.R - 1 ? p : null; };
  const volumeDe = (coins, base = {}) => ({ id: base.id ?? ++numero, coins, hauteur: base.hauteur ?? 9, toit: base.toit ?? "plat", faite: base.faite ?? 3 });
  function clicDessin(e) {
    const p = pointDessin(e);
    if (!p) return;
    dessin.push(p);
    if (dessin.length === 3) {
      const coins = rectangle(...dessin);
      if (coins) { P.volumes.push(volumeDe(coins)); volumesChanges(); o.compter?.("volume"); }
      return finDessin();
    }
    aide();
  }
  scene.renderer.domElement.addEventListener("pointermove", e => {
    if (!dessin?.length) return;
    const p = pointDessin(e);
    if (!p) return;
    // aperçu : après le premier coin, un mur fin le long du côté ; après le deuxième, le volume entier
    const L = Math.hypot(p[0] - dessin[0][0], p[1] - dessin[0][1]) || 1, n = [-(p[1] - dessin[0][1]) / L * 0.3, (p[0] - dessin[0][0]) / L * 0.3];
    const coins = dessin.length === 1 ? rectangle(dessin[0], p, [p[0] + n[0] * 4, p[1] + n[1] * 4]) : rectangle(dessin[0], dessin[1], p);
    scene.afficherVolumes(P.volumes, coins ? volumeDe(coins, { id: 0, hauteur: dessin.length === 1 ? 0.5 : 9 }) : null);
  });
  /** Volumes changés : maquette, ombres, coupe, heures de soleil (si affichées), liste du panneau. */
  function volumesChanges() {
    scene.afficherVolumes(P.volumes);
    S.versionProjet = (S.versionProjet || 0) + 1;
    S.volumesProjet = P.volumes;
    if (S.coupe) o.majCoupe(S.coupe.A, S.coupe.B);
    if (S.heuresDemandees) o.relancerHeures?.();
    listeVolumes();
  }
  function listeVolumes() {
    const modeles = P.imports.map(m => {
      const d = document.createElement("div");
      d.className = "volume";
      d.innerHTML = `<span style="grid-column: 1 / 4">${t("import.modele", { nom: m.nom })}<br><span class="text-secondary">${m.note}</span></span>`
        + `<button type="button" title="${t("import.retirer")}" aria-label="${t("import.retirer")}">×</button>`;
      d.querySelector("button").onclick = () => { P.imports = P.imports.filter(x => x !== m); importsChanges(); };
      return d;
    });
    $("#listeVolumes").replaceChildren(...modeles, ...P.volumes.map((v, k) => {
      const [l, p] = dimensions(v), d = document.createElement("div");
      d.className = "volume";
      d.innerHTML = `<span>${t("projet.volume", { n: k + 1, l: fr(l), p: fr(p) })}</span>`
        + `<input type="number" class="form-control form-control-sm" min="1" max="200" step="0.5" value="${v.hauteur}" title="${t("projet.hauteur")}" aria-label="${t("projet.hauteur")}">`
        + `<select class="form-select form-select-sm"><option value="plat">${t("projet.plat")}</option><option value="deux">${t("projet.deuxPans")}</option></select>`
        + `<button type="button" title="${t("projet.retirer")}" aria-label="${t("projet.retirer")}">×</button>`;
      const [h, toit, x] = d.querySelectorAll("input, select, button");
      toit.value = v.toit;
      h.onchange = () => { v.hauteur = Math.max(1, +h.value || v.hauteur); volumesChanges(); };
      toit.onchange = () => { v.toit = toit.value; volumesChanges(); };
      x.onclick = () => { P.volumes = P.volumes.filter(w => w !== v); volumesChanges(); };
      return d;
    }));
  }

  /* ---------------------------------------------------------------- modèles importés */
  // glTF/GLB, OBJ, STL ou DXF : placé par ses coordonnées MN95, l'origine locale du site, ou sa limite de parcelle
  // (importer.js) ; son calque « sections » donne des coupes. Les modèles ne sont pas gardés dans les projets enregistrés.
  const contexteImport = () => ({ E0: S.E0, N0: S.N0, zRef: scene.zRef, parcelle: S.parcelle?.anneauxRel || [], solEn: (x, y) => solEn(S.G, x, y) });
  function importsChanges() {
    scene.afficherImports(P.imports.map(m => m.objet));
    volumesChanges();
  }
  $("#btnImporter").onclick = () => { if (pret()) $("#fichierModele").click(); };
  $("#fichierModele").onchange = async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f || !pret()) return;
    o.etat(0.3, t("import.enCours", { nom: f.name }));
    try {
      const r = await importerModele(f, contexteImport());
      const pl = r.placement, note = [t(`import.methode.${pl.methode}`), pl.ecartMax != null ? t("import.ajuste", { cm: Math.max(1, Math.round(pl.ecartMax * 100)) }) : ""].filter(Boolean).join(" · ");
      P.imports.push({ nom: f.name, objet: r.objet, note });
      o.compter?.("import");
      importsChanges();
      if (r.coupes?.length) o.ouvrirCoupes?.([...(S.coupes || []).map(c => ({ A: c.A, B: c.B })), ...r.coupes]);
      o.message([note, ...r.avertissements, t("import.nonEnregistre")].filter(Boolean).join(" · "), 9000);
    } catch (err) {
      console.error(err);
      o.message(err.message);
    }
    o.etat(1, "");
  };
  $("#btnRefParcelle").onclick = () => {
    if (!pret()) return;
    const { nom, texte } = dxfReference({ ...contexteImport(), lieu: $("#lieu").textContent || "" });
    telecharger(new Blob([texte], { type: "application/dxf" }), nom);
  };

  /* ---------------------------------------------------------------- projets enregistrés (dans ce navigateur) */
  function listeProjets() {
    const sel = $("#listeProjets"), liste = listerProjets();
    sel.replaceChildren(new Option(t("projet.nouveau"), ""), ...liste.map(p => new Option(p.nom, p.id)));
    sel.value = P.projet?.id || "";
    $("#btnSupprimerProjet").disabled = !P.projet;
  }
  $("#btnEnregistrer").onclick = () => {
    if (!pret()) return;
    const nom = prompt(t("projet.nom"), P.projet?.nom || t("projet.nomDefaut", { lieu: $("#lieu").textContent || "" }));
    if (!nom) return;
    const p = {
      id: P.projet?.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, nom,
      hash: location.hash, jour: S.jour, rayon: $("#rayonPro").value, masques: [...P.masques], volumes: P.volumes,
      coupes: (S.coupes || []).map(c => ({ A: c.A, B: c.B })),
    };
    if (!enregistrerProjet(p)) return o.message(t("projet.stockage"));
    P.projet = p;
    listeProjets();
    o.compter?.("projet");
    o.message(t("projet.enregistre", { nom }), 3000);
  };
  $("#listeProjets").onchange = () => {
    const p = listerProjets().find(q => q.id === $("#listeProjets").value);
    if (!p) { P.projet = null; P.volumes = []; volumesChanges(); listeProjets(); return; }
    P.projet = p;
    // le projet est rouvert sur son lieu : chargement si besoin, puis bâtiments démolis, volumes et coupes
    if (p.rayon !== undefined && $("#rayonPro").value !== p.rayon) { $("#rayonPro").value = p.rayon; memoire("ombres.rayon", p.rayon); }
    if (location.hash !== p.hash) { P.aOuvrir = p; location.hash = p.hash.slice(1); } else ouvrir(p);
  };
  $("#btnSupprimerProjet").onclick = () => {
    if (!P.projet) return;
    supprimerProjet(P.projet.id);
    P.projet = null;
    listeProjets();
  };
  function ouvrir(p) {
    if (p.jour) o.changerJour?.(p.jour);
    P.masques = new Set(p.masques || []); P.historique = []; P.selection.clear();
    appliquer();
    P.volumes = (p.volumes || []).map(v => ({ ...v }));
    numero = Math.max(0, ...P.volumes.map(v => v.id));
    volumesChanges();
    if (p.coupes?.length) o.ouvrirCoupes?.(p.coupes);
    listeProjets();
  }
  listeProjets();

  /* ---------------------------------------------------------------- taille de la maquette */
  const NOTES_RAYON = { 250: t("pro.noteRayon250"), 400: t("pro.noteRayon400") };
  $("#rayonPro").value = [...$("#rayonPro").options].some(x => x.value === memoire("ombres.rayon")) ? memoire("ombres.rayon") : "";
  const noteRayon = () => $("#noteRayon").textContent = NOTES_RAYON[$("#rayonPro").value] || "";
  $("#rayonPro").addEventListener("change", () => {
    memoire("ombres.rayon", $("#rayonPro").value);
    noteRayon();
    if (S.lat != null) o.recharger();
  });
  noteRayon();

  /* ---------------------------------------------------------------- export du site */
  const format = () => $("input[name=formatExport]:checked").value;
  const choix = () => ({
    terrain: $("#xTerrain").checked, maille: +$("#xMaille").value, socle: $("#xSocle").checked, batiments: $("#xBati").checked,
    arbres: $("#xArbres").checked, parcelle: $("#xParcelle").checked && FORMATS[format()].lignes, courbes: $("#xCourbes").checked && FORMATS[format()].lignes,
  });
  const jeuExport = () => jeu() === "aucun" ? "releve" : jeu();
  function majExport() {
    const F = FORMATS[format()];
    $("#xJeu").textContent = { releve: t("pro.jeuReleve"), swiss: t("pro.jeuSwiss"), roofer: t("pro.jeuRoofer") }[jeuExport()];
    $("#xMn95").disabled = !F.absolu;
    if (!F.absolu) $("#xLocal").checked = true;
    $("#xParcelle").disabled = $("#xCourbes").disabled = !F.lignes;
    $("#exportCoupe").classList.toggle("d-none", !S.coupe);
    if (!pret() || $("#choixExport").hidden) return;
    const e = estimer(scene, choix(), format(), jeuExport());
    $("#noteExport").innerHTML = t("pro.estimation", { triangles: entier(e.triangles), taille: mo(e.octets) })
      + (e.octets > 50e6 ? ` <b>${t("pro.lourd")}${+$("#xMaille").value < 2 ? t("pro.lourdMaille") : ""}.</b>` : "")
      + (!F.absolu ? "<br>" + t("pro.simplePrecision") : "")
      + (!F.lignes ? "<br>" + t("pro.stlSurfaces") : "");
  }
  $("#btnExport").onclick = () => { $("#choixExport").hidden = !$("#choixExport").hidden; majExport(); };
  $$("#choixExport input, #choixExport select").forEach(x => x.addEventListener("change", majExport));

  let enCours = false;
  async function exporter(fmt, quoi, absolu) {
    if (enCours || !pret()) return;
    enCours = true;
    $("#resultatExport").textContent = "";
    try {
      const r = await exporterSite({
        scene, parcelle: S.parcelle, E0: S.E0, N0: S.N0, lieu: $("#lieu").textContent || "site", format: fmt, quoi, jeu: jeuExport(), absolu,
        source: $("#source").textContent, progres: o.etat,
      });
      telecharger(r.blob, r.nom);
      o.compter?.("export");
      $("#resultatExport").innerHTML = t("pro.telecharge", { nom: r.nom, zip: mo(r.octetsZip), fichier: r.fichier, taille: mo(r.octets), triangles: entier(r.triangles), s: fr(r.ms / 1000) });
      if (import.meta.env.DEV) S.dernierExport = r; // pour la relecture pendant le développement
    } catch (e) {
      console.error(e);
      o.message(t("pro.exportImpossible", { m: e.message }));
    }
    o.etat(1, "");
    enCours = false;
  }
  $("#btnTelecharger").onclick = () => exporter(format(), choix(), $("#xMn95").checked);
  // « maquette complète » : tout le contenu, origine locale ; terrain à 1 m (2 m en DXF, format bien plus lourd)
  $$("[data-tout]").forEach(b => b.onclick = () => exporter(b.dataset.tout, { terrain: true, maille: b.dataset.tout === "dxf" ? 2 : 1, socle: true, batiments: true, arbres: true, parcelle: true, courbes: false }, false));

  /* ---------------------------------------------------------------- export de la coupe */
  $$("[data-coupe]").forEach(b => b.onclick = () => {
    if (!S.coupe) return;
    const C = S.coupe, lieu = $("#lieu").textContent || "site", pt = ([x, y]) => `${Math.round(S.E0 + x)}-${Math.round(S.N0 + y)}`;
    const D = dessinCoupe(C.P, { E0: S.E0, N0: S.N0, lieu, soleil: o.soleilActuel(), jour: date(new Date(S.jour + "T12:00:00")) });
    const infos = [t("export.infoCoupe", { lieu }), `A = E ${fr(S.E0 + C.A[0])} N ${fr(S.N0 + C.A[1])} ; B = E ${fr(S.E0 + C.B[0])} N ${fr(S.N0 + C.B[1])} (MN95, EPSG:2056)`,
      t("export.infoAxesCoupe"), t("export.infoSourceCoupe")];
    const nom = `coupe_${sansAccent(lieu)}_A${pt(C.A)}_B${pt(C.B)}.${b.dataset.coupe}`;
    const texte = b.dataset.coupe === "dxf" ? coupeDxf(D, infos) : coupeSvg(D, infos);
    telecharger(new Blob([texte], { type: b.dataset.coupe === "dxf" ? "application/dxf" : "image/svg+xml" }), nom);
    $("#resultatExport").innerHTML = t("pro.telechargeCoupe", { nom, taille: mo(texte.length) });
    if (import.meta.env.DEV) S.dernierExport = { nom, texte };
  });
  $("#vCoupe").addEventListener("change", majExport);

  /* ---------------------------------------------------------------- interrupteur */
  $("#vPro").checked = memoire("ombres.pro") === "1";
  // version pro : avec un compte en service, le mode pro demande le statut Pro (sinon la boîte du compte s'ouvre)
  const autorise = () => !o.compte?.disponible() || o.compte.etat().pro;
  $("#vPro").addEventListener("change", () => { if (actif() && !autorise() && !o.compte.exigerPro(t("compte.raisonPro"))) $("#vPro").checked = false; }, true);
  o.compte?.addEventListener("compte", () => { if (actif() && !autorise()) { $("#vPro").checked = false; basculer(); } });
  $("#vPro").addEventListener("change", () => { if (actif()) o.compter?.("pro_ouvert"); });
  const basculer = () => { $("#outilsPro").hidden = !actif(); document.body.classList.toggle("pro", actif()); memoire("ombres.pro", actif() ? "1" : "0"); maj(); };
  $("#vPro").addEventListener("change", basculer);
  $("#outilsPro").hidden = !actif();
  document.body.classList.toggle("pro", actif()); // les réglages « pro » placés ailleurs dans le panneau (.pro-seul)

  return {
    /** Rayon choisi en mode pro (m), ou null : rayon automatique. */
    rayon: () => actif() && +$("#rayonPro").value || null,
    /** Nouveau lieu : plus de sélection ni de masquage. */
    reinitialiser() {
      P.selection = new Set(); P.masques = new Set(); P.historique = []; P.volumes = []; P.imports = []; S.volumesProjet = [];
      if (dessin) finDessin();
      $("#resultatExport").textContent = ""; listeVolumes(); maj();
    },
    /** Dessin d'un volume en cours (les clics sur la maquette lui reviennent). */
    dessine: () => !!dessin || performance.now() - finAt < 400,
    /** Lieu chargé : un projet en attente (ouvert depuis la liste) est appliqué. */
    apresChargement() { if (P.aOuvrir) { const p = P.aOuvrir; P.aOuvrir = null; ouvrir(p); } else if (P.projet && location.hash !== P.projet.hash) { P.projet = null; listeProjets(); } },
  };
}
