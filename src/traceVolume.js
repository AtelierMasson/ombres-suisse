// Tracé d'un volume en cours de dessin, drapé sur le terrain : traits entre les points cliqués et vers la souris,
// qui épousent le relief (un point tous les 25 cm, 12 cm au-dessus du sol), en trait plein là où ils sont visibles et
// en trait pâle par-dessus le relief, les arbres et les bâtiments qui les cachent : la forme réelle au sol reste lisible.
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { solEn } from "./grille.js";

export function traceSol(scene) {
  const groupe = new THREE.Group();
  scene.scene.add(groupe);
  (scene.horsAO ||= []).push(groupe);
  const net = new LineMaterial({ linewidth: 3, transparent: true, depthWrite: false, fog: false });
  const pale = new LineMaterial({ linewidth: 2, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, fog: false });
  // points posés et point visé : pastilles de 11 px (disque cerclé de blanc), toujours visibles
  const cv = document.createElement("canvas"); cv.width = cv.height = 32;
  const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.beginPath(); cx.arc(16, 16, 15, 0, Math.PI * 2); cx.fill(); cx.fillStyle = "#e0262b"; cx.beginPath(); cx.arc(16, 16, 10, 0, Math.PI * 2); cx.fill();
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const point = new THREE.PointsMaterial({ size: 11, sizeAttenuation: false, map: tex, alphaTest: 0.5, depthTest: false, depthWrite: false, transparent: true, fog: false });
  for (const m of [net, pale]) m.uniforms.resolution = scene.mat.trait.uniforms.resolution;

  /** `pts` = points relatifs [x est, y nord] (null : rien), `ferme` = polygone fermé (le dernier suit la souris). */
  function montrer(pts, ferme = false) {
    for (const o of [...groupe.children]) { groupe.remove(o); o.geometry.dispose(); }
    if (pts?.length && scene.G) {
      const G = scene.G, z = (x, y) => solEn(G, x, y) - scene.zRef + 0.12, pos = [];
      const P = ferme ? [...pts, pts[0]] : pts;
      for (let k = 0; k + 1 < P.length; k++) {
        const [a, b] = [P[k], P[k + 1]], n = Math.min(2000, Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.25)));
        for (let i = k ? 1 : 0; i <= n; i++) { const x = a[0] + (b[0] - a[0]) * i / n, y = a[1] + (b[1] - a[1]) * i / n; pos.push(x, z(x, y), -y); }
      }
      const couleur = scene.T?.parcelle || "#e0262b";
      net.color.set(couleur); pale.color.set(couleur);
      if (pos.length >= 6) for (const [m, ordre] of [[pale, 38], [net, 39]]) {
        const g = new LineGeometry(); g.setPositions(pos);
        const l = new Line2(g, m);
        l.renderOrder = ordre; l.frustumCulled = false;
        groupe.add(l);
      }
      const gp = new THREE.BufferGeometry();
      gp.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap(([x, y]) => [x, z(x, y), -y]), 3));
      const nuage = new THREE.Points(gp, point);
      nuage.renderOrder = 40; nuage.frustumCulled = false;
      groupe.add(nuage);
    }
    scene.demander();
  }
  return { montrer };
}
