// Vols de l'accueil : plans « drone » lents au-dessus de lieux suisses, rendus en direct par le moteur de la maquette.
// Rien n'est préparé d'avance : terrain swissALTI3D 2 m autour du lieu, bâtiments (swissBUILDINGS3D) et arbres
// (vegetation 3D) de swisstopo en tuiles chargées selon la vue, paysage jusqu'à 50 km avec la brume.
import * as THREE from "three";
import { grilleVide, solEn, terrainAutour, majSurface, remplir } from "./grille.js";
import { tuilesAlti2m } from "./geo.js";
import { reliefLointain, materiauLointain } from "./lointain.js";
import { materiauPoints } from "./maillages.js";
import { Monde } from "./monde.js";
import { pontsAutour } from "./pontsModeles.js";
import { EauVecteur } from "./eau.js";

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
  // Fribourg : on remonte la Sarine depuis le lac de Schiffenen, le pont de la Poya apparaît, la caméra passe dessous,
  // suit la boucle de la rivière puis s'élève vers la vieille ville et la cathédrale Saint-Nicolas
  // (centre à 542 m ; rivière vers 531 m, tablier de la Poya vers 600 m, parvis de la cathédrale 588 m)
  fribourg: {
    nom: "Fribourg", E: 2579050, N: 1184400, R: 700, duree: 120,
    camera: [[40, 580, 2], [200, 500, -1], [215, 400, -2], [150, 308, -1], [40, 256, 0], [-150, 234, 2], [-270, 170, 6], [-285, 60, 12], [-200, -70, 30], [-110, -200, 60], [10, -270, 100]],
    cible: [[219, 480, 40], [150, 310, 50], [130, 300, 40], [40, 256, 5], [-150, 234, 5], [-280, 150, 8], [-280, 30, 10], [-180, -120, 30], [-85, -475, 70], [-85, -470, 75], [-85, -470, 80]],
    soleil: { az: 235, h: 32 },
  },
};

/** Point d'une suite de clés (Catmull-Rom centripète), u dans [0, 1]. */
function courbe(cles) {
  const c = new THREE.CatmullRomCurve3(cles.map(([x, y, h]) => new THREE.Vector3(x, h, -y)), false, "centripetal");
  return u => c.getPointAt(Math.min(1, Math.max(0, u)));
}

/**
 * Lance le vol `cle` dans `scene`. `o.etat(f, texte)` : progression ; `o.actif()` : faux si l'on a quitté le vol entre-temps ;
 * `o.monde` : 1 = terrain swisstopo du monde partout (prototype, monde.js), 2 = monde autour du terrain 2 m du centre.
 * Renvoie une fonction qui arrête le vol.
 */
export async function lancerVol(scene, cle, o) {
  const V = VOLS[cle] || VOLS.gruyeres, temps = scene.tempsVol = {}, debut = performance.now();
  const marque = nom => { if (!(nom in temps)) temps[nom] = Math.round(performance.now() - debut); };
  const fin = await decor(scene, V, o, marque);
  if (!fin) return () => {};
  const { voirAvant, jeuAvant } = fin;
  o.etat(1, "");
  // caméra : aller-retour lent, adouci aux deux bouts ; la caméra ne s'arrête jamais tout à fait
  const pos = courbe(V.camera), cib = courbe(V.cible), ctl = scene.controls;
  ctl.enabled = false; ctl.autoRotate = false;
  // la caméra peut regarder vers le haut (sous un pont, vers une tour) : l'angle limite des contrôles est levé pendant le vol
  const polaireAvant = ctl.maxPolarAngle;
  ctl.maxPolarAngle = Math.PI;
  let t0 = null, arret = false;
  scene.animation = t => {
    if (arret) return;
    t0 ??= t;
    const phase = ((t - t0) / 1000 / V.duree) % 2;
    // `scene.volU` (0 à 1) : position figée sur le trajet (vérifications, captures)
    const u = scene.volU ?? 0.5 - 0.5 * Math.cos(Math.PI * (phase < 1 ? phase : 2 - phase));
    scene.camera.position.copy(pos(u));
    ctl.target.copy(cib(u));
    scene.camera.lookAt(ctl.target);
    scene.demander(1);
    // mesure : première image du vol, puis bâtiments et arbres visibles tous chargés
    if (!temps.image) marque("image");
    if (!temps.tuiles && scene.swiss?.enCours === 0 && scene.swiss.tuiles?.stats.loaded > 0 && scene.swiss.arbres?.stats.loaded > 0) marque("tuiles");
  };
  return () => { arret = true; scene.vol = false; scene.monde?.cacherTerrain(); scene.reglerLointain({ voir: voirAvant }); scene.calques.jeu = jeuAvant; ctl.enabled = true; ctl.maxPolarAngle = polaireAvant; scene.animation = null; };
}

/**
 * Décor d'un vol ou du paysage navigable autour de V = { nom, E, N, R, soleil } : grille 2 m au centre (référence
 * d'altitude et calage des bâtiments), bâtiments et arbres swisstopo en tuiles, ombres, puis paysage : relief
 * Terrarium (sans monde) ou terrain swisstopo du monde (o.monde). Renvoie null si l'on a quitté entre-temps.
 */
async function decor(scene, V, o, marque) {
  const { E, N } = V;
  // terrain 2 m jusqu'à 1,5 km (maquette au centre, puis anneau fin du paysage) ; avec le monde, seulement la maquette
  const RF = o.monde ? V.R + 100 : 1500;
  o.etat(0.1, `${V.nom} · terrain`);
  const fin = await terrainAutour(await tuilesAlti2m([E - RF, N - RF, E + RF, N + RF]), E, N, RF);
  marque("alti");
  if (!o.actif()) return null;
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
  // ponts modélisés du décor (la caméra peut passer dessous)
  scene.pontsModeles = await pontsAutour(E, N, V.R).catch(() => []); scene.lieuPonts = { E, N };
  if (!o.actif()) return null;
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
  if (o.monde) {
    // monde persistant : terrain swisstopo (quantized-mesh) dans le repère de la scène, calé sur la grille 2 m du centre
    const m = scene.monde ||= new Monde(scene);
    m.placer(E, N, scene.zRef);
    m.solEn = (x, y) => solEn(G, x, y); m.rayonCalage = G.R;
    // matière du paysage (mêmes uniformes : plan drapé, couleurs, brume), dans une instance propre au monde (trou)
    m.montrerTerrain(scene.matMonde ||= materiauLointain(scene.loin.mat.uniforms), { trou: o.monde === 2 ? V.R - 1 : 0 });
    if (o.monde !== 2) k.terrain.visible = false; // le monde seul : qualité du terrain swisstopo jugée telle quelle
    // mesure : terrain fin présent autour du centre (premier calage sur les tuiles fines)
    const suivi = () => { if (!o.actif()) return; if (m.calage.n > 0) { marque("terrain"); temps.calage = m.calage; } else setTimeout(suivi, 200); };
    suivi();
  } else {
    // paysage jusqu'à 50 km (sans bloquer)
    const idScene = scene.idScene;
    reliefLointain(E, N, G.R, scene.zRef, (x, y) => solEn(G, x, y), fin)
      .then(g => { marque("paysage"); return o.actif() && scene.afficherLointain(g, idScene, { E0: E, N0: N }); })
      .catch(e => console.warn("Relief lointain :", e.message));
  }
  // rivières et lacs (la grille du vol n'a pas de nuage, donc pas d'eau) : polygones swisstopo, niveau tiré du terrain
  // dessiné — grille 2 m du lieu, ou, avec le monde, swissALTI3D lu autour de la caméra
  const eau = scene.eauVecteur ||= new EauVecteur(scene), m = scene.monde;
  // (terrain du monde : maillage plus grossier que la grille 2 m et calé à quelques décimètres près, d'où 30 cm de plus)
  if (o.monde) eau.configurer({ origine: () => ({ E: m.E0, N: m.N0, zRef: m.zRef }), alti: true, courbure: 1, hausse: 0.3, rayonSansPaysage: V.R });
  else eau.configurer({ origine: () => ({ E, N, zRef: scene.zRef }), fin, rayonSansPaysage: V.R });
  marque("maquette");
  return { G, voirAvant, jeuAvant };
}

/**
 * Paysage navigable (#p=E,N) : le décor du vol, sans maquette ni relevé, où l'on se déplace librement (souris,
 * clavier) sans rechargement : au-delà de 250 m du centre, l'origine de la scène suit la cible (origine flottante) ;
 * monde, bâtiments, arbres et plan gardent leurs tuiles. Remplace le « voyage » (surVoyage) dans ce mode.
 */
export async function lancerPaysage(scene, { E, N }, o) {
  const V = { nom: o.nom || "Paysage", E, N, R: 300, soleil: { az: 215, h: 35 } }, temps = scene.tempsVol = {}, debut = performance.now();
  const marque = nom => { if (!(nom in temps)) temps[nom] = Math.round(performance.now() - debut); };
  const fin = await decor(scene, V, { ...o, monde: 1 }, marque);
  if (!fin) return () => {};
  const { voirAvant, jeuAvant } = fin;
  o.etat(1, "");
  scene.vol = false; scene.paysage = true;
  scene.groupe.visible = false; // la petite maquette du départ (grille 2 m) ne suit pas l'origine flottante
  const m = scene.monde, ctl = scene.controls;
  ctl.enabled = true; ctl.autoRotate = false;
  scene.camera.position.set(-420, 260, 520); ctl.target.set(0, 20, 0); ctl.update();
  scene.surPaysage = cible => {
    // origine flottante : la scène se recentre sous la cible tous les 250 m (précision des flottants ; les ombres
    // couvrent ±360 m autour de l'origine)
    if (Math.hypot(cible.x, cible.z) < 250) return;
    const E1 = Math.round(m.E0 + cible.x), N1 = Math.round(m.N0 - cible.z);
    const [dx, dn] = m.rebaser(E1, N1);
    scene.swiss?.deplacerOrigine(E1, N1);
    scene.tuilesPlan?.decaler(dx, dn);
    o.surOrigine?.(E1, N1);
    scene.demander(3);
  };
  return () => {
    scene.paysage = false; scene.surPaysage = null; m?.cacherTerrain(); scene.groupe.visible = true;
    scene.reglerLointain({ voir: voirAvant }); scene.calques.jeu = jeuAvant;
  };
}

