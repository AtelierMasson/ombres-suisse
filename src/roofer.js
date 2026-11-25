// Comparaison : bâtiments reconstruits hors ligne par roofer (3DBAG, TU Delft) pour des lieux d'essai (Lutry, Lausanne av. Floréal).
// Le fichier contient des polygones (toits et murs) en MN95 relatives à son origine, altitudes absolues.
import * as THREE from "three";

const ESSAIS = [
  { url: `${import.meta.env.BASE_URL}essais/roofer_lutry.json`, centre: [2542766, 1152300], rayon: 400, nom: "Lutry" },
  { url: `${import.meta.env.BASE_URL}essais/roofer_floreal.json`, centre: [2537679, 1151560], rayon: 400, nom: "Lausanne, av. Floréal" },
];

/** Essai roofer qui couvre le point (E, N), ou null. */
export function essaiRoofer(E, N) {
  return ESSAIS.find(e => Math.hypot(E - e.centre[0], N - e.centre[1]) < e.rayon) || null;
}

/** Charge l'essai et construit le maillage dans le repère de la scène (origine E0, N0 ; altitudes relatives à zRef). */
export async function maillageRoofer(essai, [E0, N0], zRef, materiau) {
  const d = await (await fetch(essai.url)).json();
  const [oE, oN] = d.origine, pos = [];
  const v3 = ([x, y, z]) => new THREE.Vector3(x + oE - E0, z - zRef, -(y + oN - N0));
  for (const { r } of d.polygones) {
    const anneaux = r.map(a => a.map(v3));
    if (anneaux[0].length < 3) continue;
    // normale (Newell), puis projection sur le plan principal pour trianguler (anneaux concaves et trous compris)
    const n = new THREE.Vector3(), A = anneaux[0];
    for (let i = 0; i < A.length; i++) {
      const a = A[i], b = A[(i + 1) % A.length];
      n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y);
    }
    const ax = Math.abs(n.x) > Math.abs(n.y) ? (Math.abs(n.x) > Math.abs(n.z) ? "x" : "z") : (Math.abs(n.y) > Math.abs(n.z) ? "y" : "z");
    const plan = p => ax === "x" ? new THREE.Vector2(p.y, p.z) : ax === "y" ? new THREE.Vector2(p.x, p.z) : new THREE.Vector2(p.x, p.y);
    const tous = anneaux.flat();
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(anneaux[0].map(plan), anneaux.slice(1).map(h => h.map(plan))))
      pos.push(...tous[a].toArray(), ...tous[b].toArray(), ...tous[c].toArray());
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, materiau);
  m.castShadow = m.receiveShadow = true;
  m.userData = { batiments: d.batiments, source: d.source };
  return m;
}
