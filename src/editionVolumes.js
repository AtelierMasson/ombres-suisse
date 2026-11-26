// Édition directe des volumes du projet (mode pro), à la souris :
// - un clic sur un volume le sélectionne (contour) ; Échap ou un clic ailleurs le désélectionne ; Suppr le retire ;
// - au survol du volume sélectionné, la face sous la souris s'éclaire : tirer un mur le déplace (le volume s'allonge
//   ou s'élargit), tirer le toit change la hauteur ;
// - deux poignées : la croix fléchée (sur le toit) déplace tout le volume, la flèche ronde (à un angle) le fait tourner.
import * as THREE from "three";

/** Petite icône dessinée dans un canevas (sprite de taille constante à l'écran). */
function icone(dessin) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d");
  c.fillStyle = "rgba(255,255,255,0.95)"; c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 2;
  c.beginPath(); c.arc(32, 32, 28, 0, Math.PI * 2); c.fill(); c.stroke();
  c.strokeStyle = "#8c1c1c"; c.fillStyle = "#8c1c1c"; c.lineWidth = 4; c.lineCap = "round"; c.lineJoin = "round";
  dessin(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, sizeAttenuation: false }));
  s.scale.setScalar(0.05);
  s.renderOrder = 40;
  return s;
}
const fleche = (c, x, y, a) => { c.save(); c.translate(x, y); c.rotate(a); c.beginPath(); c.moveTo(0, 0); c.lineTo(-7, -6); c.lineTo(-7, 6); c.closePath(); c.fill(); c.restore(); };

export function brancherEdition({ scene, volumes, actif, dessine, changes, retirer }) {
  const calque = new THREE.Group();
  calque.renderOrder = 35;
  scene.scene.add(calque);
  (scene.horsAO ||= []).push(calque); // pas d'occlusion ambiante sur le contour, la face éclairée et les poignées
  const deplacer = icone(c => {
    c.beginPath(); c.moveTo(14, 32); c.lineTo(50, 32); c.moveTo(32, 14); c.lineTo(32, 50); c.stroke();
    fleche(c, 54, 32, 0); fleche(c, 10, 32, Math.PI); fleche(c, 32, 10, -Math.PI / 2); fleche(c, 32, 54, Math.PI / 2);
  });
  const tourner = icone(c => {
    c.beginPath(); c.arc(32, 32, 15, -Math.PI * 0.15, Math.PI * 1.35); c.stroke();
    fleche(c, 32 + 15 * Math.cos(-Math.PI * 0.15), 32 + 15 * Math.sin(-Math.PI * 0.15), Math.PI * 0.35);
  });
  deplacer.userData.poignee = "deplacer"; tourner.userData.poignee = "tourner";
  const matFace = new THREE.MeshBasicMaterial({ color: "#b84a44", transparent: true, opacity: 0.45, depthTest: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const matContour = new THREE.LineBasicMaterial({ color: "#8c1c1c", depthTest: false, transparent: true });
  let sel = null, survol = null, prise = null, avantClic = 0;
  const el = scene.renderer.domElement, rayon = e => scene.viser(e);
  const mailles = () => (scene.couches.volumes?.children || []).filter(m => m.visible);
  const volumeDe = id => volumes().find(v => v.id === id);
  const toucher = e => {
    const h = rayon(e).intersectObjects(mailles())[0];
    if (!h) return null;
    return { id: h.object.userData.volume, face: h.object.geometry.userData.faces?.[h.faceIndex] ?? -1, point: h.point, maille: h.object };
  };

  /** Contour du volume sélectionné, face survolée, poignées. */
  function dessiner() {
    for (const o of [...calque.children]) { calque.remove(o); if (o.geometry && !o.isSprite) o.geometry.dispose(); }
    const v = sel != null && volumeDe(sel), m = v && mailles().find(o => o.userData.volume === sel);
    if (!v || !m) { scene.demander(); return; }
    calque.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 20), matContour));
    if (survol && survol.id === sel) {
      // triangles de la face survolée, repris du maillage
      const g = m.geometry, p = g.attributes.position, f = g.userData.faces || [], pos = [];
      for (let t = 0; t < f.length; t++) if (f[t] === survol.face) for (let k = 0; k < 3; k++) pos.push(p.getX(3 * t + k), p.getY(3 * t + k), p.getZ(3 * t + k));
      if (pos.length) {
        const gf = new THREE.BufferGeometry();
        gf.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        calque.add(new THREE.Mesh(gf, matFace));
      }
    }
    // poignées : déplacer au-dessus du milieu du toit, tourner à côté du premier angle
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox, cx = v.coins.reduce((s, q) => s + q[0], 0) / v.coins.length, cy = v.coins.reduce((s, q) => s + q[1], 0) / v.coins.length;
    deplacer.position.set(cx, b.max.y + 2, -cy);
    const [ax, ay] = v.coins[0], dx = ax - cx, dy = ay - cy, L = Math.hypot(dx, dy) || 1;
    tourner.position.set(ax + dx / L * 2.5, b.max.y + 1, -(ay + dy / L * 2.5));
    calque.add(deplacer, tourner);
    scene.demander();
  }

  function choisir(id) { sel = id; survol = null; dessiner(); }

  el.addEventListener("pointermove", e => {
    if (prise) return glisser(e);
    if (!actif() || dessine()) { if (survol) { survol = null; dessiner(); } return; }
    const h = rayon(e).intersectObjects([deplacer, tourner].filter(o => o.parent))[0];
    if (h) { el.style.cursor = h.object.userData.poignee === "tourner" ? "alias" : "move"; return; }
    const t = toucher(e), avant = survol && `${survol.id}/${survol.face}`;
    survol = t && t.id === sel ? t : null;
    el.style.cursor = t ? (t.id === sel ? (t.face === -1 ? "ns-resize" : "ew-resize") : "pointer") : "";
    if ((survol && `${survol.id}/${survol.face}`) !== avant) dessiner();
  });

  // appui : poignée, face du volume sélectionné, ou sélection d'un autre volume (avant la rotation de la vue)
  el.addEventListener("pointerdown", e => {
    if (e.button !== 0 || !actif() || dessine()) return;
    const hp = rayon(e).intersectObjects([deplacer, tourner].filter(o => o.parent))[0], t = hp ? null : toucher(e);
    if (!hp && !t) return;
    avantClic = performance.now();
    if (!hp && t.id !== sel) { choisir(t.id); return; }
    const v = volumeDe(sel);
    if (!v) return;
    const depart = hp ? hp.object.position.clone() : t.point.clone();
    prise = { mode: hp ? hp.object.userData.poignee : t.face === -1 ? "hauteur" : "mur", face: t?.face, depart, orig: v.coins.map(q => [...q]), hauteur: v.hauteur, v };
    // plan de glissement : horizontal (murs, déplacer, tourner), vertical face à la caméra (hauteur)
    const vue = scene.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    prise.plan = prise.mode === "hauteur" ? new THREE.Plane().setFromNormalAndCoplanarPoint(vue.negate(), depart) : new THREE.Plane(new THREE.Vector3(0, 1, 0), -depart.y);
    scene.controls.enabled = false;
    el.setPointerCapture(e.pointerId);
    e.stopImmediatePropagation();
  }, true);

  function glisser(e) {
    const q = rayon(e).ray.intersectPlane(prise.plan, new THREE.Vector3());
    if (!q) return;
    const { v, orig, depart } = prise, dx = q.x - depart.x, dy = -(q.z - depart.z);
    if (prise.mode === "deplacer") v.coins = orig.map(([x, y]) => [x + dx, y + dy]);
    else if (prise.mode === "tourner") {
      const cx = orig.reduce((s, p) => s + p[0], 0) / orig.length, cy = orig.reduce((s, p) => s + p[1], 0) / orig.length;
      const a = Math.atan2(-q.z - cy, q.x - cx) - Math.atan2(-depart.z - cy, depart.x - cx), co = Math.cos(a), si = Math.sin(a);
      v.coins = orig.map(([x, y]) => [cx + (x - cx) * co - (y - cy) * si, cy + (x - cx) * si + (y - cy) * co]);
    } else if (prise.mode === "hauteur") v.hauteur = Math.max(1, Math.round((prise.hauteur + q.y - depart.y) * 10) / 10);
    else {
      // mur k : ses deux coins avancent le long de la normale extérieure (polygone dans le sens trigonométrique)
      const k = prise.face, n = orig.length, A = orig[k], B = orig[(k + 1) % n], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
      const nx = (B[1] - A[1]) / L, ny = -(B[0] - A[0]) / L;
      // le mur ne passe pas à moins d'un mètre du mur opposé
      const opp = orig.reduce((m, p) => Math.min(m, (p[0] - A[0]) * nx + (p[1] - A[1]) * ny), 0);
      const d = Math.max(opp + 1, dx * nx + dy * ny);
      v.coins = orig.map((p, i) => i === k || i === (k + 1) % n ? [p[0] + nx * d, p[1] + ny * d] : [...p]);
    }
    scene.afficherVolumes(volumes(), null, true);
    dessiner();
  }

  el.addEventListener("pointerup", e => {
    if (!prise) return;
    prise = null;
    scene.controls.enabled = true;
    try { el.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }
    changes();
    dessiner();
  });
  addEventListener("keydown", e => {
    if (sel == null || e.target.closest?.("input, textarea, select")) return;
    if (e.key === "Escape") choisir(null);
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); const id = sel; choisir(null); retirer(id); }
  });

  return {
    /** Vrai juste après un clic consommé par l'édition (le clic ne doit pas aussi choisir un bâtiment). */
    consomme: () => performance.now() - avantClic < 450,
    /** Les volumes ont changé (liste, chargement d'un projet) : contour et poignées à jour. */
    maj() { if (sel != null && !volumeDe(sel)) sel = null; dessiner(); },
    deselectionner() { choisir(null); },
    get selection() { return sel; },
  };
}
