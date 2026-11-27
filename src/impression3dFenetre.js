// Fenêtre « Impression 3D » (mode pro) : options, aperçu 3D des solides imprimables et téléchargement (STL, ou zip
// de STL quand la maquette est découpée en tuiles). Le calcul (impression3d.js) se fait dans un fil ; l'aperçu montre
// exactement les triangles du fichier.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { zipSync } from "three/addons/libs/fflate.module.js";
import { calculerImpression, stlBinaire, contenuZip } from "./impression3d.js";
import { t, nombre, entier } from "./i18n.js";
import "./impression3d.css";

let ouvert = null, dlg = null, rendu = null, scene3 = null, cam = null, ctl = null, groupe = null, dernier = null, minuteur = 0, fil = null, tour = 0;
const toits = new Map(); // toits lus dans la scène, par type de bâtiments (le temps que la fenêtre reste ouverte)

const TAILLES = [100, 150, 200, 250, 300, 350, 400], ECHELLES = [100, 200, 250, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000, 10000];
const CHOIX = {
  batiments: [["releve", "impr.batReleve"], ["swiss", "impr.batSwiss"], ["roofer", "impr.batAdvanced"], ["aucun", "impr.batAucun"]],
  exag: [1, 1.5, 2, 3],
  socle: [2, 3, 5, 8],
  finesse: [["fine", "impr.resFine"], ["normale", "impr.resNormale"], ["rapide", "impr.resRapide"]],
  arbres: [["aucun", "impr.arbresAucun"], ["masses", "impr.arbresMasses"], ["isoles", "impr.arbresIsoles"]],
};
const MAT = [new THREE.MeshStandardMaterial({ color: "#d6d0c5", roughness: 0.85, flatShading: true }), new THREE.MeshStandardMaterial({ color: "#f1ede6", roughness: 0.85, flatShading: true })];

function construireFenetre() {
  dlg = document.createElement("dialog");
  dlg.id = "impression3d";
  dlg.className = "impr";
  const sel = (nom, valeurs, defaut, libelle) => `<label class="impr-champ"><span>${t(libelle)}</span><select class="form-select form-select-sm" name="${nom}">`
    + valeurs.map(v => Array.isArray(v) ? `<option value="${v[0]}"${v[0] === defaut ? " selected" : ""}>${t(v[1])}</option>` : `<option value="${v}"${v === defaut ? " selected" : ""}>${v}</option>`).join("")
    + `</select></label>`;
  dlg.innerHTML = `<form method="dialog" class="impr-boite">
    <div class="impr-tete"><b>${t("impr.titre")}</b><button type="button" class="btn-close" data-fermer aria-label="${t("legal.fermer")}"></button></div>
    <div class="impr-corps">
      <div class="impr-apercu"><canvas></canvas><div class="impr-calcul" role="status" hidden><span></span><button type="button" data-annuler>${t("impr.annuler")}</button></div><div class="impr-invite" hidden></div></div>
      <div class="impr-options">
        ${sel("batiments", CHOIX.batiments, "releve", "impr.batiments")}
        <div class="impr-duo">${sel("taille", TAILLES, 200, "impr.taille")}${sel("echelle", [], "", "impr.echelle")}</div>
        ${sel("decoupe", [[1, "impr.decoupe1"]], 1, "impr.decoupe")}
        <div class="impr-duo">${sel("exag", CHOIX.exag, 1, "impr.exag")}${sel("socle", CHOIX.socle, 3, "impr.socle")}</div>
        ${sel("arbres", CHOIX.arbres, "masses", "impr.arbres")}
        ${sel("finesse", CHOIX.finesse, "normale", "impr.resolution")}
        <label class="impr-case"><input type="checkbox" class="form-check-input" name="eau" checked> ${t("impr.eau")}</label>
        <p class="impr-aide">${t("impr.aide")}</p>
      </div>
    </div>
    <p class="impr-infos" role="status"></p>
    <div class="impr-pied"><button type="button" class="btn btn-primary" data-telecharger disabled>${t("impr.telecharger")}</button></div>
  </form>`;
  document.body.append(dlg);
  dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest("[data-fermer]")) dlg.close(); });
  dlg.addEventListener("close", () => {
    // fenêtre fermée : calcul arrêté, aperçu et résultats rendus à la mémoire
    if (rendu) rendu.setAnimationLoop(null);
    arreter(); tour++; toits.clear(); clearTimeout(minuteur);
    vider(); dernier = null;
  });
  dlg.querySelector("[data-annuler]").onclick = () => {
    arreter(); tour++; clearTimeout(minuteur);
    dlg.querySelector(".impr-calcul").hidden = true;
    dlg.querySelector(".impr-infos").textContent = t("impr.annule");
  };
  const f = dlg.querySelector("form");
  f.elements.decoupe.innerHTML = [1, 2, 3, 4].map(n => `<option value="${n}">${n === 1 ? t("impr.decoupe1") : t("impr.decoupeN", { n })}</option>`).join("");
  const canvas = dlg.querySelector("canvas");
  rendu = new THREE.WebGLRenderer({ canvas, antialias: true });
  rendu.setPixelRatio(Math.min(2, devicePixelRatio));
  scene3 = new THREE.Scene();
  scene3.background = new THREE.Color("#eef1f5");
  scene3.add(new THREE.HemisphereLight("#ffffff", "#8a8f99", 1.6));
  const soleil = new THREE.DirectionalLight("#ffffff", 2.2); soleil.position.set(-0.6, -0.8, 1.2); scene3.add(soleil);
  cam = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  cam.up.set(0, 0, 1);
  ctl = new OrbitControls(cam, canvas);
  ctl.enableDamping = true;
  if (import.meta.env.DEV) window.__impr = { rendu, scene3, cam, ctl, get dernier() { return dernier; }, fichier: () => fichier(ouvert) }; // essais
}

/** Échelles proposées pour ce lieu (taille imprimée de 40 mm à 1,6 m) et remise à « selon la taille ». */
function remplirEchelles(ctx) {
  const f = dlg.querySelector("form"), cote = 2 * coteReel(ctx.G) * 1000;
  f.elements.echelle.innerHTML = `<option value="">${t("impr.echelleLibre")}</option>`
    + ECHELLES.filter(e => cote / e >= 40 && cote / e <= 1600).map(e => `<option value="${e}">1:${entier(e)}</option>`).join("");
}
const coteReel = G => G.rayonZone ? G.rayonZone - 0.5 : G.R - G.c / 2; // demi-côté (ou rayon) imprimé, en m

/** Taille choisie : celle de la liste, ou celle que donne l'échelle choisie (ajoutée à la liste). */
function accorderTaille(ctx, source) {
  const f = dlg.querySelector("form"), E = f.elements.echelle, T = f.elements.taille;
  T.querySelector("[data-echelle]")?.remove();
  if (source === "taille" || !E.value) { if (source === "taille") E.value = ""; if (!T.value) T.value = "200"; accorderDecoupe(); return; }
  const mm = Math.round(2 * coteReel(ctx.G) * 1000 / +E.value * 10) / 10;
  T.insertAdjacentHTML("beforeend", `<option value="${mm}" data-echelle>${nombre(mm, 0)}</option>`);
  T.value = String(mm);
  accorderDecoupe();
}

/** Découpes trop grossières pour la taille (tuile de plus de 400 mm) : grisées, et découpe relevée au besoin. */
function accorderDecoupe() {
  const f = dlg.querySelector("form"), D = f.elements.decoupe, n = decoupeMin(+f.elements.taille.value);
  for (const op of D.options) op.disabled = +op.value < n;
  if (+D.value < n) D.value = String(n);
}

function options() {
  const f = dlg.querySelector("form"), v = n => f.elements[n].value;
  return { batiments: v("batiments"), taille: +v("taille"), decoupe: Math.max(+v("decoupe"), decoupeMin(+v("taille"))), exag: +v("exag"), socle: +v("socle"), arbres: v("arbres"), finesse: v("finesse"), eau: f.elements.eau.checked, min: 0.8 };
}

function arreter() { fil?.terminate(); fil = null; }

/** Retire l'aperçu de la scène et libère ses géométries. */
function vider() {
  if (!groupe) return;
  scene3.remove(groupe); groupe.traverse(o => o.geometry?.dispose()); groupe = null;
}

/** Message d'erreur lisible : mémoire épuisée (grande maquette) ou fil de calcul interrompu. */
function messageErreur(e) {
  const m = String(e?.message || e || "");
  if (e instanceof RangeError || /memory|allocation|array length|out of memory/i.test(m)) return t("impr.erreurMemoire");
  return t("impr.erreur", { m: m || t("impr.erreurFil") });
}

/** Découpe minimale : chaque tuile doit tenir sur un plateau de 400 mm. */
const decoupeMin = taille => Math.max(1, Math.min(4, Math.ceil(taille / 400 - 1e-9)));

/** Calcul dans un fil (remplacé si les options changent entre-temps) ; sans fil disponible, calcul direct. */
function lancer(d, o, etape) {
  arreter();
  return new Promise((ok, ko) => {
    try {
      fil = new Worker(new URL("./impression3d.worker.js", import.meta.url), { type: "module" });
    } catch { fil = null; }
    if (!fil) { try { ok(calculerImpression(d, o)); } catch (e) { ko(e); } return; }
    const moi = fil;
    // résultat reçu : le fil est arrêté (sa mémoire, grilles et toits copiés, est rendue aussitôt)
    const finir = () => { if (fil === moi) arreter(); };
    fil.onmessage = ({ data }) => {
      if (data.etape) return etape(data.etape, data.part);
      finir();
      if (data.ok) ok(data.r); else ko(Object.assign(new Error(data.erreur), { memoire: data.memoire }));
    };
    fil.onerror = e => { e.preventDefault?.(); finir(); ko(new Error(e.message || "")); };
    fil.postMessage({ d, o });
  });
}

/** Aperçu : un maillage par tuile, tel qu'il sera écrit (terrain et bâtiments en deux teintes) ; tuiles un peu écartées. */
function montrer(r) {
  vider();
  groupe = new THREE.Group();
  const N = r.infos.decoupe, ecart = N > 1 ? Math.max(1.5, r.infos.taille * 0.012) : 0;
  for (const tu of r.tuiles) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(tu.pos, 3));
    g.setIndex(new THREE.BufferAttribute(tu.idx, 1));
    const terrain = tu.solides.find(s => s.type === "terrain"), fin = terrain ? terrain.t1 : 0;
    g.addGroup(0, 3 * fin, 0); g.addGroup(3 * fin, tu.idx.length - 3 * fin, 1);
    const m = new THREE.Mesh(g, MAT);
    m.position.set((tu.colonne - 1 - (N - 1) / 2) * ecart, ((N - tu.ligne) - (N - 1) / 2) * ecart, 0);
    groupe.add(m);
  }
  scene3.add(groupe);
  const [lx, ly, lz] = r.infos.dims, d = Math.max(lx, ly) * 1.25;
  if (ctl.userData?.cadre !== r.infos.taille) {
    cam.position.set(-d * 0.55, -d * 0.85, d * 0.7); ctl.target.set(0, 0, lz * 0.3); ctl.userData = { cadre: r.infos.taille };
    cam.near = d / 400; cam.far = d * 20; cam.updateProjectionMatrix();
  }
  ctl.update();
}

function ecrireInfos(r) {
  const i = r.infos, N = i.decoupe, lignes = [];
  lignes.push(t("impr.infos", { x: nombre(i.dims[0], 0), y: nombre(i.dims[1], 0), z: nombre(i.dims[2], 0), echelle: entier(i.echelle), triangles: entier(i.triangles), mo: nombre(i.octets / 1e6, 1) })
    + (N > 1 ? " · " + t("impr.infosTuiles", { n: r.tuiles.length, x: nombre(i.taille / N, 0) }) : ""));
  const details = [t("impr.solides", { n: entier(i.batiments) })];
  if (i.arbres) details.push(t("impr.arbresN", { n: entier(i.arbres) }));
  if (i.debords) details.push(t("impr.debords", { n: entier(i.debords) }));
  if (i.fins) details.push(t("impr.fins", { n: entier(i.fins) }));
  details.push(i.etanche ? `<span class="impr-ok">✓ ${t("impr.etanche")}</span>` : `<span class="impr-ko">${t("impr.pasEtanche", { n: i.ouvertes })}</span>`);
  if (i.taille / N > 400) details.push(`<span class="impr-alerte">${t("impr.tropGrand")}</span>`);
  lignes.push(details.join(" · "));
  dlg.querySelector(".impr-infos").innerHTML = lignes.join("<br>");
}

/** Toits du type demandé (lus une fois) ; null si une action est attendue de l'utilisateur (invite affichée). */
async function lireToits(ctx, type, zone) {
  if (toits.has(type)) return toits.get(type);
  const invite = dlg.querySelector(".impr-invite");
  invite.hidden = true;
  if (type === "roofer") zone.textContent = t("impr.advancedCalcul");
  else if (type === "swiss") zone.textContent = t("impr.swissAttente");
  let lots;
  try { lots = await ctx.toits(type); } catch (e) {
    invite.innerHTML = `<p>${t("impr.advancedEchec", { m: e.message })}</p>`; invite.hidden = false;
    return null;
  }
  if (!lots) {
    // swisstopo : rien n'a pu être chargé (connexion, onglet en arrière-plan) ; on propose de réessayer
    invite.innerHTML = `<p>${t("impr.swissAbsent")}</p><button type="button" class="btn btn-sm btn-primary">${t("impr.swissCharger")}</button>`;
    invite.hidden = false;
    invite.querySelector("button").onclick = () => { invite.hidden = true; calculer(ctx); };
    return null;
  }
  toits.set(type, lots);
  return lots;
}

/** Calcule les solides avec les options du moment et met l'aperçu à jour. */
function calculer(ctx) {
  const zone = dlg.querySelector(".impr-calcul"), texte = zone.querySelector("span"), bouton = dlg.querySelector("[data-telecharger]");
  zone.hidden = false; texte.textContent = t("impr.calcul");
  // le fichier précédent ne correspond plus aux options : pas de téléchargement avant la fin du nouveau calcul
  bouton.disabled = true; dernier = null;
  clearTimeout(minuteur);
  minuteur = setTimeout(async () => {
    const o = options(), G = ctx.G, moi = ++tour;
    bouton.textContent = o.decoupe > 1 ? t("impr.telechargerZip", { n: o.decoupe * o.decoupe }) : t("impr.telecharger");
    const lots = await lireToits(ctx, o.batiments, texte);
    if (moi !== tour) return;
    if (!lots) { zone.hidden = true; return; }
    const d = { G: { n: G.n, c: G.c, x0: G.x0, R: G.R, rayonZone: G.rayonZone, sol: G.sol, eau: G.eau, veg: G.veg }, lots };
    try {
      const debut = performance.now();
      const r = await lancer(d, o, (etape, part) => { texte.textContent = t("impr.etape." + etape) + (part > 0 && part < 1 ? ` ${Math.round(100 * part)} %` : ""); });
      if (moi !== tour) return;
      r.infos.attente = performance.now() - debut;
      dernier = { r, o };
      montrer(r); ecrireInfos(r);
      bouton.disabled = false;
    } catch (e) {
      if (moi !== tour) return; // calcul remplacé par un plus récent
      console.error(e);
      vider();
      dlg.querySelector(".impr-infos").innerHTML = `<span class="impr-ko"></span>`;
      dlg.querySelector(".impr-infos span").textContent = e.memoire ? t("impr.erreurMemoire") : messageErreur(e);
    }
    zone.hidden = true;
  }, 80);
}

/** Fichier à télécharger : le STL, ou un zip d'un STL par tuile (ligne 1 au nord, colonne 1 à l'ouest). */
function fichier(ctx) {
  const { r, o } = dernier, e = Math.round(r.infos.echelle), base = `impression3d-${Math.round(o.taille)}mm-1-${e}`;
  if (r.tuiles.length === 1 && o.decoupe === 1) {
    const tu = r.tuiles[0];
    return { blob: new Blob([stlBinaire(tu.pos, tu.idx, `Topograph STL mm 1:${e}`)], { type: "model/stl" }), nom: ctx.nom(base, "stl") };
  }
  const contenu = contenuZip(r, o, { nom: ctx.nom, lisezMoi: p => t("impr.lisezMoi", { n: p.n, cote: nombre(p.cote, 0), echelle: entier(p.echelle) }) });
  return { blob: new Blob([zipSync(contenu)], { type: "application/zip" }), nom: ctx.nom(base + `_${o.decoupe}x${o.decoupe}`, "zip") };
}

/**
 * Ouvre la fenêtre. `ctx` = { G (grille du lieu), jeu (bâtiments affichés : "releve" | "swiss" | "roofer" | "aucun"),
 * toits(type) (promesse des lots de toits à imprimer, ou null si les bâtiments swisstopo n'ont pas pu être chargés),
 * nom(contenu, ext), telecharger(blob, nom) }.
 */
export function ouvrirImpression3D(ctx) {
  if (!dlg) construireFenetre();
  ouvert = ctx;
  ctl.userData = {};
  toits.clear();
  dernier = null;
  const f = dlg.querySelector("form");
  f.elements.batiments.value = ctx.jeu || "releve";
  remplirEchelles(ctx);
  accorderTaille(ctx, "taille");
  f.onchange = e => {
    if (e.target.name === "taille" || e.target.name === "echelle") accorderTaille(ctx, e.target.name);
    calculer(ctx);
  };
  dlg.querySelector("[data-telecharger]").disabled = true;
  dlg.querySelector("[data-telecharger]").onclick = () => {
    if (!dernier) return;
    const { blob, nom } = fichier(ctx);
    ctx.telecharger(blob, nom);
  };
  dlg.querySelector(".impr-infos").textContent = "";
  dlg.querySelector(".impr-invite").hidden = true;
  // aperçu aux couleurs du thème (jour ou nuit)
  scene3.background = new THREE.Color(getComputedStyle(document.body).getPropertyValue("--discret").trim() || "#eef1f5");
  dlg.showModal();
  const canvas = dlg.querySelector("canvas"), taille = () => {
    const w = canvas.clientWidth || 480, h = canvas.clientHeight || 340;
    rendu.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  };
  taille();
  rendu.setAnimationLoop(() => { taille(); ctl.update(); rendu.render(scene3, cam); });
  calculer(ctx);
}
