// Fenêtre « Impression 3D » (mode pro) : options, aperçu 3D du solide imprimable et téléchargement du STL.
// Le solide est calculé par impression3d.js (un seul volume fermé, en millimètres).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { solideImpression, verifierEtanche, stlBinaire } from "./impression3d.js";
import { t, nombre, entier } from "./i18n.js";
import "./impression3d.css";

let dlg = null, rendu = null, scene3 = null, cam = null, ctl = null, maille = null, dernier = null, minuteur = 0;

const CHOIX = {
  taille: [100, 150, 200, 250],
  exag: [1, 1.5, 2, 3],
  socle: [2, 3, 5, 8],
  resolution: [[0.4, "impr.resFine"], [0.6, "impr.resNormale"], [1, "impr.resRapide"]],
  arbres: [["aucun", "impr.arbresAucun"], ["masses", "impr.arbresMasses"], ["isoles", "impr.arbresIsoles"]],
};

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
      <div class="impr-apercu"><canvas></canvas><div class="impr-calcul" hidden>${t("impr.calcul")}</div></div>
      <div class="impr-options">
        ${sel("taille", CHOIX.taille, 150, "impr.taille")}
        ${sel("exag", CHOIX.exag, 1.5, "impr.exag")}
        ${sel("socle", CHOIX.socle, 3, "impr.socle")}
        ${sel("arbres", CHOIX.arbres, "masses", "impr.arbres")}
        ${sel("resolution", CHOIX.resolution, 0.6, "impr.resolution")}
        <label class="impr-case"><input type="checkbox" class="form-check-input" name="eau" checked> ${t("impr.eau")}</label>
        <p class="impr-aide">${t("impr.aide")}</p>
      </div>
    </div>
    <p class="impr-infos" role="status"></p>
    <div class="impr-pied"><button type="button" class="btn btn-primary" data-telecharger>${t("impr.telecharger")}</button></div>
  </form>`;
  document.body.append(dlg);
  dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest("[data-fermer]")) dlg.close(); });
  dlg.addEventListener("close", () => { if (rendu) rendu.setAnimationLoop(null); });
  const canvas = dlg.querySelector("canvas");
  rendu = new THREE.WebGLRenderer({ canvas, antialias: true });
  rendu.setPixelRatio(Math.min(2, devicePixelRatio));
  scene3 = new THREE.Scene();
  scene3.background = new THREE.Color("#eef1f5");
  scene3.add(new THREE.HemisphereLight("#ffffff", "#8a8f99", 1.6));
  const soleil = new THREE.DirectionalLight("#ffffff", 2.2); soleil.position.set(-0.6, -0.8, 1.2); scene3.add(soleil);
  cam = new THREE.PerspectiveCamera(35, 1, 1, 5000);
  cam.up.set(0, 0, 1);
  ctl = new OrbitControls(cam, canvas);
  ctl.enableDamping = true;
}

function options() {
  const f = dlg.querySelector("form"), v = n => f.elements[n].value;
  return { taille: +v("taille"), exag: +v("exag"), socle: +v("socle"), arbres: v("arbres"), resolution: +v("resolution"), eau: f.elements.eau.checked };
}

/** Calcule le solide avec les options du moment et met l'aperçu à jour. */
function calculer(ctx) {
  const zone = dlg.querySelector(".impr-calcul");
  zone.hidden = false;
  clearTimeout(minuteur);
  minuteur = setTimeout(() => {
    const o = options();
    const r = solideImpression(ctx.G, { ...o, bat: ctx.bat() });
    const e = verifierEtanche(r.geometrie);
    dernier = { r, o };
    if (maille) { scene3.remove(maille); maille.geometry.dispose(); }
    maille = new THREE.Mesh(r.geometrie, new THREE.MeshStandardMaterial({ color: "#d9d4cb", roughness: 0.85, flatShading: true }));
    scene3.add(maille);
    // cadrage : vue oblique sur tout le solide
    const [lx, ly, lz] = r.infos.dims, d = Math.max(lx, ly) * 1.25;
    if (!ctl.userData?.cadre) { cam.position.set(-d * 0.55, -d * 0.85, d * 0.7); ctl.target.set(0, 0, lz * 0.3); ctl.userData = { cadre: true }; }
    ctl.update();
    const octets = 84 + r.infos.triangles * 50;
    dlg.querySelector(".impr-infos").innerHTML = t("impr.infos", {
      x: nombre(lx, 0), y: nombre(ly, 0), z: nombre(lz, 0), echelle: entier(r.infos.echelle), triangles: entier(r.infos.triangles),
      mo: nombre(octets / 1e6, 1), cellule: nombre(r.infos.cellule, 1),
    }) + " · " + (e.etanche ? `<span class="impr-ok">✓ ${t("impr.etanche")}</span>` : `<span class="impr-ko">${t("impr.pasEtanche", { n: e.ouvertes + e.malOrientees })}</span>`);
    zone.hidden = true;
  }, 60);
}

/**
 * Ouvre la fenêtre. `ctx` = { G (grille du lieu), bat() (grille des bâtiments affichés, alignée sur G),
 * nom(taille) (nom du fichier), telecharger(blob, nom) }.
 */
export function ouvrirImpression3D(ctx) {
  if (!dlg) construireFenetre();
  ctl.userData = {};
  const f = dlg.querySelector("form");
  f.onchange = () => calculer(ctx);
  dlg.querySelector("[data-telecharger]").onclick = () => {
    if (!dernier) return;
    ctx.telecharger(stlBinaire(dernier.r.geometrie, `Topograph STL mm 1:${dernier.r.infos.echelle}`), ctx.nom(dernier.o.taille));
  };
  dlg.showModal();
  const canvas = dlg.querySelector("canvas"), taille = () => {
    const w = canvas.clientWidth || 480, h = canvas.clientHeight || 340;
    rendu.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
  };
  taille();
  rendu.setAnimationLoop(() => { taille(); ctl.update(); rendu.render(scene3, cam); });
  calculer(ctx);
}
