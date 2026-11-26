// Vols de l'accueil : plans « drone » lents au-dessus de lieux suisses, rendus en direct par le moteur de la maquette.
// Rien n'est préparé d'avance : terrain swissALTI3D 2 m autour du lieu, bâtiments (swissBUILDINGS3D) et arbres
// (vegetation 3D) de swisstopo en tuiles chargées selon la vue, paysage jusqu'à 50 km avec la brume.
import * as THREE from "three";
import { grilleVide, solEn, terrainAutour, majSurface, remplir } from "./grille.js";
import { tuilesAlti2m } from "./geo.js";
import { reliefLointain } from "./lointain.js";
import { materiauPoints } from "./maillages.js";

/**
 * Lieux et trajectoires. Coordonnées MN95 du centre ; une trajectoire = des clés [x est, y nord, hauteur] (m, depuis le
 * centre et son altitude) pour la caméra et pour le point regardé, parcourues lentement aller-retour en `duree` s.
 */
export const VOLS = {
  gruyeres: {
    nom: "Gruyères", E: 2572794, N: 1159319, R: 700, duree: 110,
    // du nord-est vers le nord-ouest du bourg, en descendant un peu ; le regard glisse du château vers le Moléson
    // le long du flanc est du bourg, du nord vers le château, assez bas ; le regard finit sur le Moléson
    camera: [[230, 560, 95], [190, 360, 78], [160, 170, 70], [120, -30, 72], [40, -210, 90]],
    cible: [[-30, 420, 12], [-45, 250, 15], [-40, 80, 20], [-60, -120, 30], [-500, -1100, 160]],
    soleil: { az: 215, h: 28 }, // azimut depuis le nord, hauteur (degrés)
  },
};

/** Point d'une suite de clés (Catmull-Rom centripète), u dans [0, 1]. */
function courbe(cles) {
  const c = new THREE.CatmullRomCurve3(cles.map(([x, y, h]) => new THREE.Vector3(x, h, -y)), false, "centripetal");
  return u => c.getPointAt(Math.min(1, Math.max(0, u)));
}

/**
 * Lance le vol `cle` dans `scene`. `o.etat(f, texte)` : progression ; `o.actif()` : faux si l'on a quitté le vol entre-temps.
 * Renvoie une fonction qui arrête le vol.
 */
export async function lancerVol(scene, cle, o) {
  const V = VOLS[cle] || VOLS.gruyeres, { E, N } = V, debut = performance.now(), temps = scene.tempsVol = {};
  const marque = nom => { temps[nom] = Math.round(performance.now() - debut); };
  // terrain 2 m jusqu'à 1,5 km (maquette au centre, puis anneau fin du paysage)
  const RF = 1500;
  o.etat(0.1, `${V.nom} · terrain`);
  const fin = await terrainAutour(await tuilesAlti2m([E - RF, N - RF, E + RF, N + RF]), E, N, RF);
  marque("terrain");
  if (!o.actif()) return () => {};
  const G = grilleVide(V.R, 2), { n, c } = G;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -V.R + (i + 0.5) * c, y = -V.R + (j + 0.5) * c;
    const fx = (E + x - fin.e0) / fin.c - 0.5, fy = (fin.n1 - (N + y)) / fin.c - 0.5, i0 = Math.floor(fx), j0 = Math.floor(fy), u = fx - i0, v = fy - j0;
    const p = j0 * fin.n + i0, H = fin.h;
    G.sol[j * n + i] = (H[p] * (1 - u) + H[p + 1] * u) * (1 - v) + (H[p + fin.n] * (1 - u) + H[p + fin.n + 1] * u) * v;
  }
  remplir(G.sol, G.n); // trous éventuels (tuile manquante) : bouchés par les voisins
  majSurface(G);
  o.etat(0.35, `${V.nom} · bâtiments et arbres`);
  scene.vol = true;
  const voirAvant = scene.loin.voir;
  scene.loin.voir = true; // le vol montre toujours le paysage
  scene.construire(G, null, { anneauxRel: [] }, null);
  const k = scene.couches;
  for (const nom of ["socle", "limite", "canopee", "arbres"]) if (k[nom]) k[nom].visible = false;
  // le terrain du centre prend la matière du paysage : même plan, même grain, même brume, sans couture
  k.terrain.material = scene.loin.mat;
  scene.tuilesPlan?.placer(E, N, G.R);
  // bâtiments et arbres swisstopo, chargés selon ce que voit la caméra
  const jeuAvant = scene.calques.jeu;
  scene.calques.jeu = "swiss";
  scene.comparerSwiss(true, { E, N });
  const couronne = new THREE.MeshStandardMaterial({ color: "#86a565", roughness: 1 });
  const tronc = new THREE.MeshStandardMaterial({ color: "#8a7560", roughness: 1 });
  // arbres en nuage de points, du même matériau que ceux du relevé (teintes du thème) ; le modèle porte l'ombre
  const points = materiauPoints(1.6, false);
  points.uniforms.relief.value = 0;
  ["c1", "c2", "c3"].forEach((u, i) => points.uniforms[u].value.set(scene.T.arbres[i]));
  const v2 = new THREE.Vector2();
  points.onBeforeRender = (r, sc, cam) => { points.uniforms.echelle.value = r.getDrawingBufferSize(v2).y / (2 * Math.tan(cam.fov * Math.PI / 360)); };
  scene.swiss.chargerArbres({ couronne, tronc, points, calqueOmbre: 2 }, 10);
  // ombres sur toute la maquette centrale
  const sc = scene.soleil.shadow.camera, Rs = V.R * 1.2;
  Object.assign(sc, { left: -Rs, right: Rs, top: Rs, bottom: -Rs, near: 1, far: 6000 });
  sc.updateProjectionMatrix();
  const az = V.soleil.az * Math.PI / 180, h = V.soleil.h * Math.PI / 180;
  scene.placerSoleil([Math.sin(az) * Math.cos(h), Math.sin(h), -Math.cos(az) * Math.cos(h)], true);
  // paysage jusqu'à 50 km (sans bloquer)
  const idScene = scene.idScene;
  reliefLointain(E, N, G.R, scene.zRef, (x, y) => solEn(G, x, y), fin)
    .then(g => { marque("paysage"); return o.actif() && scene.afficherLointain(g, idScene, { E0: E, N0: N }); })
    .catch(e => console.warn("Relief lointain :", e.message));
  marque("maquette");
  o.etat(1, "");
  // caméra : aller-retour lent, adouci aux deux bouts ; la caméra ne s'arrête jamais tout à fait
  const pos = courbe(V.camera), cib = courbe(V.cible), ctl = scene.controls;
  ctl.enabled = false; ctl.autoRotate = false;
  let t0 = null, arret = false;
  scene.animation = t => {
    if (arret) return;
    t0 ??= t;
    const phase = ((t - t0) / 1000 / V.duree) % 2, u = 0.5 - 0.5 * Math.cos(Math.PI * (phase < 1 ? phase : 2 - phase));
    scene.camera.position.copy(pos(u));
    ctl.target.copy(cib(u));
    scene.camera.lookAt(ctl.target);
    scene.demander(1);
    // mesure : première image du vol, puis bâtiments et arbres visibles tous chargés
    if (!temps.image) marque("image");
    if (!temps.tuiles && scene.swiss?.enCours === 0 && scene.swiss.tuiles?.stats.loaded > 0 && scene.swiss.arbres?.stats.loaded > 0) marque("tuiles");
  };
  return () => { arret = true; scene.vol = false; scene.reglerLointain({ voir: voirAvant }); scene.calques.jeu = jeuAvant; ctl.enabled = true; scene.animation = null; };
}
