// Étiquettes de cote à taille constante à l'écran (texte sur fond blanc arrondi), quelle que soit la caméra du rendu
// (vue 3D, plan, élévations, caméra orthographique) : leur échelle est recalculée juste avant chaque rendu.
import * as THREE from "three";

const v3 = new THREE.Vector3();
/** Mètres par pixel à la position `p` pour la caméra `cam` (hauteur de la vue `h` en pixels). */
export function metresParPixel(cam, p, h) {
  if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / (h || 1);
  const d = Math.max(0.05, -v3.copy(p).applyMatrix4(cam.matrixWorldInverse).z);
  return 2 * d * Math.tan(cam.fov * Math.PI / 360) / (cam.zoom || 1) / (h || 1);
}

/** Étiquette `txt` (couleur du texte et du liseré) placée en `pos` (repère de la scène) ; à retirer avec jeterEtiquette. */
export function etiquetteEcran(scene, txt, couleur, pos) {
  const cv = document.createElement("canvas"), c = cv.getContext("2d"), H = 40, f = "600 24px system-ui, sans-serif";
  c.font = f;
  const W = Math.ceil(c.measureText(txt).width) + 20;
  cv.width = W; cv.height = H;
  c.font = f; c.fillStyle = "rgba(255,255,255,0.94)"; c.strokeStyle = couleur; c.lineWidth = 2;
  c.beginPath(); c.roundRect(1, 1, W - 2, H - 2, 9); c.fill(); c.stroke();
  c.fillStyle = couleur; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, W / 2, H / 2 + 1);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, fog: false }));
  s.renderOrder = 44; s.frustumCulled = false; s.raycast = () => {};
  s.position.copy(pos);
  const el = scene.renderer.domElement, k = H / 2; // 20 px de haut à l'écran
  s.onBeforeRender = (r, sc, cam) => { const m = metresParPixel(cam, s.position, el.clientHeight) * k; s.scale.set(m * W / H, m, 1); s.updateMatrixWorld(); };
  return s;
}
export function jeterEtiquette(s) { s.parent?.remove(s); s.material.map.dispose(); s.material.dispose(); }
