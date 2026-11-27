// Impression 3D : lecture des toits à imprimer dans la scène (côté page), pour le calcul fait dans un fil.
// Repère rendu : x = est, y = nord, z = altitude absolue (m) ; la scène three.js est en x = est, y = haut, z = sud.
import * as THREE from "three";

/**
 * Toits du relevé tels qu'affichés : ce qu'il faut au fil de calcul pour les refaire à l'échelle de l'impression
 * (toitsReleve dans impression3d.js). `C` : contours affichés (contours.js), bâtiments masqués déjà retirés.
 * Renvoie un lot { releve: { n, c, x0, px, py, seg, val, coins, debuts, segs } }.
 */
export function toitsReleve(G, C) {
  const B = C.boucles, debuts = new Int32Array(B.length + 1), segs = new Int32Array(B.length);
  B.forEach((b, k) => { debuts[k + 1] = debuts[k] + b.coins.length; segs[k] = b.seg; });
  const coins = new Int32Array(debuts[B.length]);
  B.forEach((b, k) => coins.set(b.coins, debuts[k]));
  return { releve: { n: G.n, c: G.c, x0: G.x0, px: C.px, py: C.py, seg: C.seg, val: C.val, coins, debuts, segs } };
}

/**
 * Toits (et façades) de maillages three.js. `racines` : objets de la scène ; chacun forme un groupe de bâtiments (et,
 * avec un attribut `_batchid`, un groupe par bâtiment). `murs` : relever aussi les façades (faces verticales) comme
 * segments vus de dessus, pour rogner les débords de toit. `limite` : demi-côté (m) au-delà duquel rien n'est gardé.
 * Renvoie un lot { pos (triangles à la suite), groupe, murs, mursGroupe }.
 */
export function toitsObjets(racines, zRef, { murs = false, limite = Infinity, visibles = false } = {}) {
  const pos = [], groupe = [], segs = [], segGroupe = [], vus = new Set(), V = new Float64Array(9);
  racines.forEach((racine, r) => racine?.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position || (visibles && !o.visible)) return;
    o.updateWorldMatrix(true, false);
    const g = o.geometry, P = g.attributes.position, I = g.index, B = g.attributes._batchid, e = o.matrixWorld.elements, nt = (I ? I.count : P.count) / 3;
    for (let t = 0; t < nt; t++) {
      let i0 = 0;
      for (let k = 0; k < 3; k++) {
        const i = I ? I.getX(3 * t + k) : 3 * t + k, x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        if (k === 0) i0 = i;
        V[3 * k] = e[0] * x + e[4] * y + e[8] * z + e[12];
        V[3 * k + 1] = -(e[2] * x + e[6] * y + e[10] * z + e[14]);
        V[3 * k + 2] = e[1] * x + e[5] * y + e[9] * z + e[13] + zRef;
      }
      if (Math.min(V[0], V[3], V[6]) > limite || Math.max(V[0], V[3], V[6]) < -limite || Math.min(V[1], V[4], V[7]) > limite || Math.max(V[1], V[4], V[7]) < -limite) continue;
      const gr = r * 65536 + (B ? Math.round(B.getX(i0)) : 0); // _batchid : compressé, entier à 0,02 près
      const ux = V[3] - V[0], uy = V[4] - V[1], uz = V[5] - V[2], wx = V[6] - V[0], wy = V[7] - V[1], wz = V[8] - V[2];
      const nz = ux * wy - uy * wx, nn = Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, nz);
      if (Math.abs(nz) >= 0.05 * nn) { for (let k = 0; k < 9; k++) pos.push(V[k]); groupe.push(gr); continue; }
      if (!murs || nn < 1e-9) continue;
      // façade : son tracé vu de dessus est le segment entre ses deux points les plus écartés
      let a = 0, b = 1, d = -1;
      for (const [p, q] of [[0, 1], [1, 2], [0, 2]]) { const l = Math.hypot(V[3 * p] - V[3 * q], V[3 * p + 1] - V[3 * q + 1]); if (l > d) { d = l; a = p; b = q; } }
      if (d < 0.05) continue;
      let x1 = Math.round(V[3 * a] * 100), y1 = Math.round(V[3 * a + 1] * 100), x2 = Math.round(V[3 * b] * 100), y2 = Math.round(V[3 * b + 1] * 100);
      if (x1 > x2 || (x1 === x2 && y1 > y2)) { [x1, x2] = [x2, x1]; [y1, y2] = [y2, y1]; }
      const cle = `${gr},${x1},${y1},${x2},${y2}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      segs.push(x1 / 100, y1 / 100, x2 / 100, y2 / 100); segGroupe.push(gr);
    }
  }));
  return { pos: new Float32Array(pos), groupe: new Int32Array(groupe), murs: new Float32Array(segs), mursGroupe: new Int32Array(segGroupe) };
}

/**
 * Charge les tuiles swisstopo (swissBUILDINGS3D) de toute la maquette, au niveau de détail le plus fin, quelle que
 * soit la vue du moment : le chargeur ne télécharge que ce qu'une caméra voit, on lui en prête donc une, à la
 * verticale du lieu, qui embrasse le carré de demi-côté `demi` (m) à très haute résolution. Sans afficher les
 * bâtiments. Renvoie la caméra prêtée (à rendre avec `t.deleteCamera`) ou null si rien n'a pu être chargé.
 */
async function chargerSwiss(scene, demi, attente = 45000) {
  const sw = scene.swiss;
  if (!sw) return null;
  if (!sw.tuiles && sw.lieu) sw.charger(sw.lieu);
  const t = sw.tuiles;
  if (!t) return null;
  const cam = new THREE.PerspectiveCamera(30, 1, 10, 60000);
  cam.position.set(0, demi * 1.15 / Math.tan(15 * Math.PI / 180), 0);
  cam.up.set(0, 0, -1);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  t.setCamera(cam);
  t.setResolution(cam, 8000, 8000);
  const debut = performance.now();
  for (let calme = 0; calme < 5 && performance.now() - debut < attente;) {
    sw.socle.updateWorldMatrix(true, true);
    t.update();
    await new Promise(r => setTimeout(r, 200));
    const st = t.stats;
    calme = t.root && st.downloading + st.parsing + st.queued === 0 ? calme + 1 : 0;
  }
  return cam;
}

/**
 * Toits swisstopo de la maquette, à leur position calée, débords à rogner. Seules les tuiles retenues par le
 * chargeur pour l'affichage sont lues (une tuile grossière et ses tuiles fines ne sont pas comptées deux fois) ; celles
 * hors de l'écran, détachées du groupe, sont rattachées le temps de la lecture. Renvoie null si rien n'est chargé.
 */
export async function toitsSwiss(scene, limite) {
  const cam = await chargerSwiss(scene, limite), t = scene.swiss?.tuiles;
  if (!cam) return null;
  const modeles = [], rattachees = [];
  try {
    for (const tuile of new Set([...t.activeTiles, ...t.visibleTiles])) {
      const sc = tuile.engineData?.scene;
      if (!sc) continue;
      modeles.push(sc);
      if (!sc.parent) { t.group.add(sc); rattachees.push(sc); }
    }
    if (!modeles.length) return null;
    scene.swiss.socle.updateWorldMatrix(true, true);
    return { ...toitsObjets(modeles, scene.zRef, { murs: true, limite }), rogner: true };
  } finally {
    for (const sc of rattachees) t.group.remove(sc);
    t.deleteCamera(cam);
  }
}
