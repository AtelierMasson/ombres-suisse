// Import d'un modèle 3D (projet d'architecte) sur la maquette : glTF/GLB, OBJ, STL, DXF. Le DWG n'est pas lu
// (aucune bibliothèque libre non GPL ne le lit de façon fiable dans le navigateur) : on demande un DXF.
// La lecture et le placement, sans three.js, sont dans src/import/ (testables dans node) ; ce fichier charge les
// formats binaires avec les chargeurs de three.js et construit le groupe three.js en coordonnées de la scène
// (x = est, y = altitude − zRef, z = −nord).
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { lireDxf, lireObj, objDuSite, donneesVides, chainer } from "./import/lecture.js";
import { placer } from "./import/placement.js";
import { t } from "./i18n.js";

const erreur = (cle, p) => Object.assign(new Error(t(cle, p)), { cle, traduit: true });
// entités ACIS (solides, régions, surfaces) : pas de géométrie lisible dans le DXF
const SOLIDES = ["3DSOLID", "BODY", "REGION", "SURFACE", "PLANESURFACE", "EXTRUDEDSURFACE", "LOFTEDSURFACE", "REVOLVEDSURFACE", "SWEPTSURFACE"];

/* ------------------------------------------------------------------ format et texte */
/** Format d'après l'extension, confirmé par les premiers octets. */
function format(nom, octets) {
  const tete = String.fromCharCode(...octets.subarray(0, 6)), ext = (/\.([a-z0-9]+)$/i.exec(nom || "")?.[1] || "").toLowerCase();
  if (tete.startsWith("AC10") || ext === "dwg") return "dwg";
  if (tete.startsWith("glTF")) return "glb";
  if (["glb", "gltf", "obj", "stl", "dxf"].includes(ext)) return ext;
  throw erreur("import.formatInconnu", { ext: ext || "?" });
}

/** Texte du fichier : UTF-8, sinon Windows-1252 (DXF anciens, $DWGCODEPAGE ANSI_1252). */
function texte(octets) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(octets); } catch { return new TextDecoder("windows-1252").decode(octets); }
}

/* ------------------------------------------------------------------ three.js → données */
/**
 * Convertit un objet three.js chargé en données communes (repère du fichier, Z en haut). `yHaut` : le fichier a
 * Y vers le haut (norme glTF, OBJ de la plupart des logiciels) ; on passe alors à X, −Z, Y.
 */
function depuisThree(racine, yHaut) {
  const D = donneesVides(), v = new THREE.Vector3(), M = new THREE.Matrix4(), I = new THREE.Matrix4(), segments = new Map();
  racine.updateMatrixWorld(true);
  const lire = (attr, i, mat) => { v.fromBufferAttribute(attr, i).applyMatrix4(mat); return yHaut ? [v.x, -v.z, v.y] : [v.x, v.y, v.z]; };
  racine.traverse(o => {
    if (!o.geometry?.attributes?.position) return;
    const calque = o.name || o.parent?.name || "MODELE", g = o.geometry, pos = g.attributes.position, idx = g.index;
    const n = idx ? idx.count : pos.count, at = k => (idx ? idx.getX(k) : k);
    const matrices = o.isInstancedMesh ? Array.from({ length: o.count }, (_, k) => { o.getMatrixAt(k, I); return M.multiplyMatrices(o.matrixWorld, I).clone(); }) : [o.matrixWorld];
    for (const mat of matrices) {
      if (o.isMesh) {
        let m = D.maillages.find(m => m.calque === calque);
        if (!m) D.maillages.push(m = { calque, tri: [] });
        for (let k = 0; k + 2 < n; k += 3) for (let s = 0; s < 3; s++) m.tri.push(...lire(pos, at(k + s), mat));
      } else if (o.isLine) {
        if (!segments.has(calque)) segments.set(calque, []);
        const S = segments.get(calque), pas = o.isLineSegments ? 2 : 1;
        for (let k = 0; k + 1 < n; k += pas) S.push([lire(pos, at(k), mat), lire(pos, at(k + 1), mat)]);
        if (o.isLineLoop && n > 2) S.push([lire(pos, at(n - 1), mat), lire(pos, at(0), mat)]);
      }
    }
  });
  for (const [calque, S] of segments) for (const l of chainer(S, 1e-5)) D.lignes.push({ calque, ...l });
  return D;
}

async function lireGltf(octets, ext) {
  try {
    const gltf = await new GLTFLoader().parseAsync(ext === "gltf" ? texte(octets) : octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength), "");
    const D = depuisThree(gltf.scene, true), o = gltf.parser?.json?.asset?.extras?.origine;
    if (o && Number.isFinite(o.E)) D.origine = o; // export du site : origine dans asset.extras
    return D;
  } catch (e) {
    throw erreur(ext === "gltf" ? "import.gltfExterne" : "import.illisible", { message: e.message });
  }
}

function lireStl(octets, axeHaut) {
  const g = new STLLoader().parse(octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength));
  const m = new THREE.Mesh(g);
  m.name = "STL";
  const D = depuisThree(m, axeHaut === "y");
  g.dispose();
  return D;
}

/** Lit le fichier dans les données communes. */
async function lire(fichier, opt) {
  const octets = new Uint8Array(await fichier.arrayBuffer()), f = format(fichier.name, octets);
  if (f === "dwg") throw erreur("import.dwg");
  if (f === "dxf") return { f, D: lireDxf(texte(octets)) };
  if (f === "obj") {
    const s = texte(octets);
    // OBJ : Z en haut s'il vient du site ou si on l'impose, Y en haut sinon (convention Wavefront)
    const axe = opt.axeHaut && opt.axeHaut !== "auto" ? opt.axeHaut : objDuSite(s) ? "z" : "y";
    const D = lireObj(s, axe);
    D.avertissements.push({ cle: axe === "y" ? "import.objYHaut" : "import.objZHaut" });
    return { f, D };
  }
  if (f === "stl") return { f, D: lireStl(octets, opt.axeHaut === "y" ? "y" : "z") };
  return { f, D: await lireGltf(octets, f) };
}

/* ------------------------------------------------------------------ données → three.js */
/** Un maillage par calque, en coordonnées de la scène ; matériau blanc cassé double face (partagé). */
function construire(D, P, zRef) {
  const groupe = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: "#f1ede6", roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
  mat.name = "IMPORT";
  groupe.name = "IMPORT";
  for (const m of D.maillages) {
    if (!P.calquesModele.includes(m.calque)) continue;
    const a = new Float32Array(m.tri.length);
    for (let k = 0; k < m.tri.length; k += 3) {
      const [x, y, alt] = P.versSite(m.tri[k], m.tri[k + 1], m.tri[k + 2]);
      a[k] = x; a[k + 1] = alt - zRef; a[k + 2] = -y;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(a, 3));
    g.computeVertexNormals(); // triangles séparés : normales des faces (arêtes vives)
    g.computeBoundingBox(); g.computeBoundingSphere();
    const o = new THREE.Mesh(g, mat);
    o.name = m.calque; o.castShadow = o.receiveShadow = true;
    groupe.add(o);
  }
  return groupe;
}

/* ------------------------------------------------------------------ point d'entrée */
/**
 * Importe un modèle et le place sur le site.
 * @param {File|Blob & {name}} fichier
 * @param {{ E0, N0, zRef, Z0?, parcelle: number[][][], solEn: (x, y) => number }} contexte  parcelle : anneaux
 *   relatifs [[ [x, y], … ]] ; solEn : altitude absolue du terrain en coordonnées relatives ; Z0 : altitude de
 *   l'origine locale (par défaut Math.round(zRef), comme l'export).
 * @param {{ unite?: "auto"|"m"|"cm"|"mm", axeHaut?: "auto"|"z"|"y", altitude?: "auto"|"fichier"|"terrain"|number,
 *   placement?: "auto"|"mn95"|"origine"|"parcelle" }} [options]
 * @returns {Promise<{ objet: THREE.Group, placement, coupes: { A, B, nom }[], avertissements: string[] }>}
 */
export async function importerModele(fichier, contexte, options = {}) {
  let D, P;
  try {
    ({ D } = await lire(fichier, options));
    const solides = SOLIDES.reduce((s, k) => s + (D.ignores[k] || 0), 0);
    if (solides) D.avertissements.push({ cle: "import.solides", p: { n: solides } });
    if (!D.maillages.length) throw erreur(solides ? "import.seulementSolides" : "import.aucuneFace");
    P = placer(D, contexte, { ...options, nomFichier: fichier.name });
  } catch (e) {
    // erreurs des modules sans traduction (lecture.js, placement.js) : clé i18n dans e.cle
    throw e.cle && !e.traduit ? erreur(e.cle, e.p) : e;
  }
  const objet = construire(D, P, contexte.zRef);
  objet.userData.import = { fichier: fichier.name, placement: P.placement };
  return { objet, placement: P.placement, coupes: P.coupes, avertissements: P.avertissements.map(a => t(a.cle, a.p)) };
}
