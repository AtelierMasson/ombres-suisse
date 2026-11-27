// Édition directe des volumes du projet (mode pro), à la souris :
// - un clic sur un volume le sélectionne (contour) ; Échap ou un clic ailleurs le désélectionne ; Suppr le retire ;
// - au survol du volume sélectionné, la face sous la souris s'éclaire : tirer un mur le déplace (le volume s'allonge
//   ou s'élargit), tirer le toit change la hauteur ;
// - poignées au-dessus du toit, dans le genre de l'étoile d'orientation (axes fins colorés, pastilles cerclées de blanc,
//   taille constante à l'écran quelle que soit la focale) : la pastille du centre déplace le volume (il garde son
//   altitude), la pastille sur l'anneau le fait tourner ;
// - numéros des coins et petits traits cotés vers les bâtiments et les limites de la parcelle les plus proches
//   (dépassement en rouge vif), mis à jour pendant le glissement.
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { reglerCorniche } from "./projet.js";

const ROUGE = "#c8553d", VERT = "#5b8c3a", BLEU = "#3d6fb6", ENCRE = "#8c1c1c";

/** Pastille ronde cerclée de blanc (comme les bouts d'axes de l'étoile d'orientation), avec un glyphe ou un texte. */
function pastille(fond, dessin, diametre = 20) {
  const cv = document.createElement("canvas"), N = 128;
  cv.width = cv.height = N;
  const c = cv.getContext("2d"), r = N * 0.36; // marge transparente autour : la pastille se saisit un peu plus large
  c.fillStyle = fond; c.strokeStyle = "#fff"; c.lineWidth = N * 0.05;
  c.shadowColor = "rgba(0,0,0,0.3)"; c.shadowBlur = N * 0.04;
  c.beginPath(); c.arc(N / 2, N / 2, r, 0, Math.PI * 2); c.fill(); c.shadowBlur = 0; c.stroke();
  c.strokeStyle = c.fillStyle = "#fff"; c.lineCap = c.lineJoin = "round"; c.lineWidth = N * 0.035;
  c.translate(N / 2, N / 2); c.scale(r / 30, r / 30);
  dessin(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, fog: false }));
  s.userData.taille = diametre / 0.72; // en pixels (le disque occupe 72 % du carré)
  s.renderOrder = 42;
  return s;
}
const pointe = (c, x, y, a) => { c.save(); c.translate(x, y); c.rotate(a); c.beginPath(); c.moveTo(0, 0); c.lineTo(-6, -5); c.lineTo(-6, 5); c.closePath(); c.fill(); c.restore(); };
const texte = (t, taille = 28) => c => { c.font = `700 ${taille}px system-ui, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(t, 0, 2); };

/** Étiquette de cote (texte sur fond blanc arrondi), taille constante. */
function etiquette(txt, couleur) {
  const cv = document.createElement("canvas"), c = cv.getContext("2d"), H = 44, f = "600 26px system-ui, sans-serif";
  c.font = f;
  const W = Math.ceil(c.measureText(txt).width) + 22;
  cv.width = W; cv.height = H;
  c.font = f; c.fillStyle = "rgba(255,255,255,0.94)"; c.strokeStyle = couleur; c.lineWidth = 2;
  c.beginPath(); c.roundRect(1, 1, W - 2, H - 2, 10); c.fill(); c.stroke();
  c.fillStyle = couleur; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(txt, W / 2, H / 2 + 1);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, depthWrite: false, fog: false }));
  s.userData.taille = H / 2; s.userData.rapport = W / H; s.renderOrder = 43;
  return s;
}

export function brancherEdition({ scene, volumes, actif, dessine, changes, retirer, bouge = () => {}, choix = () => {}, cotes = () => [] }) {
  const calque = new THREE.Group();
  calque.renderOrder = 35;
  scene.scene.add(calque);
  (scene.horsAO ||= []).push(calque); // pas d'occlusion ambiante sur le contour, la face éclairée et les poignées
  const el = scene.renderer.domElement, rayon = e => scene.viser(e);
  const v3 = new THREE.Vector3();

  /* ---------------------------------------------------------------- objets de taille constante à l'écran */
  // Un « ancrage » est un groupe placé dans la scène dont l'unité locale vaut un pixel : son échelle est recalculée
  // juste avant chaque rendu (onBeforeRender de ses enfants), avec la profondeur et la focale de la caméra du rendu
  // (vue 3D, plan et élévations à très longue focale, caméra orthographique).
  const parPixel = (cam, p) => {
    const h = el.clientHeight || 1;
    if (cam.isOrthographicCamera) return (cam.top - cam.bottom) / cam.zoom / h;
    const d = Math.max(0.05, -v3.copy(p).applyMatrix4(cam.matrixWorldInverse).z);
    return 2 * d * Math.tan(cam.fov * Math.PI / 360) / (cam.zoom || 1) / h;
  };
  const vueRasante = cam => Math.abs(cam.getWorldDirection(v3).y) < 0.35; // élévations, vue 3D presque horizontale
  function ajuster(a, cam) {
    cam.updateMatrixWorld();
    a.parent?.updateMatrixWorld();
    a.scale.setScalar(parPixel(cam, a.position));
    if (a.userData.plat) {
      // poignées : à plat (axes est et nord), ou dressées face à la caméra en vue rasante (élévations)
      const ras = vueRasante(cam);
      if (ras) { const d = cam.getWorldDirection(v3); a.rotation.set(0, Math.atan2(-d.x, -d.z), 0); } else a.rotation.set(-Math.PI / 2, 0, 0);
      for (const o of a.children) if (o.userData.horsRasante) o.visible = !ras;
    }
    a.updateMatrixWorld(true);
  }
  const ancrage = (plat = false) => { const a = new THREE.Group(); a.userData.plat = plat; return a; };
  const accrocher = (a, o) => {
    if (o.isSprite) o.scale.set(o.userData.taille * (o.userData.rapport || 1), o.userData.taille, 1);
    o.onBeforeRender = (r, s, cam) => ajuster(a, cam);
    a.add(o);
    return o;
  };
  const trait = (points, couleur, largeur = 1.6, opacite = 1) => {
    const g = new LineGeometry(); g.setPositions(points.flat());
    const m = new LineMaterial({ color: couleur, linewidth: largeur, transparent: true, opacity: opacite, depthTest: false, depthWrite: false, fog: false });
    m.uniforms.resolution = scene.mat.trait.uniforms.resolution; // même objet : suit la taille de la vue
    const l = new Line2(g, m);
    l.renderOrder = 41; l.frustumCulled = false; l.raycast = () => {};
    return l;
  };

  /* ---------------------------------------------------------------- poignées */
  // dessinées une fois, en pixels, dans le plan local x (est) / y (nord) de leur ancrage
  const poignees = ancrage(true), RAYON = 46, BRAS = 30;
  const chevron = (x, y, dx, dy) => [[x - 5 * dx - 4 * dy, y - 5 * dy + 4 * dx, 0], [x, y, 0], [x - 5 * dx + 4 * dy, y - 5 * dy - 4 * dx, 0]];
  accrocher(poignees, trait([[-BRAS, 0, 0], [BRAS, 0, 0]], ROUGE));
  accrocher(poignees, trait(chevron(BRAS, 0, 1, 0), ROUGE));
  accrocher(poignees, trait(chevron(-BRAS, 0, -1, 0), ROUGE));
  for (const o of [trait([[0, -BRAS, 0], [0, BRAS, 0]], VERT), trait(chevron(0, BRAS, 0, 1), VERT), trait(chevron(0, -BRAS, 0, -1), VERT)]) { o.userData.horsRasante = true; accrocher(poignees, o); }
  const cercle = [];
  for (let k = 0; k <= 72; k++) cercle.push([RAYON * Math.cos(k / 36 * Math.PI), RAYON * Math.sin(k / 36 * Math.PI), 0]);
  accrocher(poignees, trait(cercle, BLEU, 1.3, 0.85)).userData.horsRasante = true;
  const deplacer = accrocher(poignees, pastille(ENCRE, c => {
    c.beginPath(); c.moveTo(-15, 0); c.lineTo(15, 0); c.moveTo(0, -15); c.lineTo(0, 15); c.stroke();
    pointe(c, 19, 0, 0); pointe(c, -19, 0, Math.PI); pointe(c, 0, -19, -Math.PI / 2); pointe(c, 0, 19, Math.PI / 2);
  }, 22));
  const tourner = accrocher(poignees, pastille(BLEU, c => {
    c.beginPath(); c.arc(0, 0, 13, -Math.PI * 0.2, Math.PI * 1.25); c.stroke();
    pointe(c, 13 * Math.cos(-Math.PI * 0.2) + 1, 13 * Math.sin(-Math.PI * 0.2), Math.PI * 0.38);
  }, 18));
  deplacer.userData.poignee = "deplacer"; tourner.userData.poignee = "tourner";

  const matFace = new THREE.MeshBasicMaterial({ color: "#b84a44", transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const matContour = new THREE.LineBasicMaterial({ color: ENCRE, depthTest: false, transparent: true, fog: false });
  let sel = null, survol = null, prise = null, avantClic = 0, jetables = [];
  const mailles = () => (scene.couches.volumes?.children || []).filter(m => m.visible);
  const volumeDe = id => volumes().find(v => v.id === id);
  const toucher = e => {
    const h = rayon(e).intersectObjects(mailles(), false)[0];
    if (!h) return null;
    return { id: h.object.userData.volume, face: h.object.geometry.userData.faces?.[h.faceIndex] ?? -1, point: h.point, maille: h.object };
  };
  const viserPoignee = e => {
    if (!poignees.parent) return null;
    ajuster(poignees, scene.camera);
    return rayon(e).intersectObjects([deplacer, tourner], false)[0] || null;
  };

  /** Contour du volume sélectionné, face survolée, poignées, numéros des coins, cotes. */
  function dessiner() {
    for (const o of jetables) {
      o.parent?.remove(o);
      o.traverse(x => { x.geometry?.dispose(); if (x.material && x.material !== matFace && x.material !== matContour) { x.material.map?.dispose(); x.material.dispose(); } });
    }
    jetables = [];
    calque.remove(poignees);
    const v = sel != null && volumeDe(sel), m = v && mailles().find(o => o.userData.volume === sel);
    if (!v || !m) { scene.demander(); return; }
    const jeter = o => { jetables.push(o); calque.add(o); return o; };
    jeter(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 20), matContour)).renderOrder = 36;
    if (survol && survol.id === sel) {
      // triangles de la face survolée, repris du maillage
      const g = m.geometry, p = g.attributes.position, f = g.userData.faces || [], pos = [];
      for (let t = 0; t < f.length; t++) if (f[t] === survol.face) for (let k = 0; k < 3; k++) pos.push(p.getX(3 * t + k), p.getY(3 * t + k), p.getZ(3 * t + k));
      if (pos.length) {
        const gf = new THREE.BufferGeometry();
        gf.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        jeter(new THREE.Mesh(gf, matFace)).renderOrder = 37;
      }
    }
    m.geometry.computeBoundingBox();
    const b = m.geometry.boundingBox, cx = v.coins.reduce((s, q) => s + q[0], 0) / v.coins.length, cy = v.coins.reduce((s, q) => s + q[1], 0) / v.coins.length;
    // poignées 2,5 m au-dessus du point le plus haut ; la pastille « tourner » sur l'anneau, du côté du premier coin
    poignees.position.set(cx, b.max.y + 2.5, -cy);
    const a = Math.atan2(v.coins[0][1] - cy, v.coins[0][0] - cx);
    tourner.position.set(RAYON * Math.cos(a), RAYON * Math.sin(a), 0);
    calque.add(poignees);
    // numéros des coins, au niveau de la corniche
    const hc = m.geometry.userData.base + v.hauteur;
    v.coins.forEach(([x, y], k) => {
      const an = jeter(ancrage());
      an.position.set(x + (x - cx) * 0.04, hc, -(y + (y - cy) * 0.04));
      accrocher(an, pastille("#4a4540", texte(String(k + 1), 36), 15));
    });
    // cotes : bâtiments et limites les plus proches (traits fins et valeur au centimètre)
    for (const c of cotes(v)) {
      const A = new THREE.Vector3(c.p[0], c.z, -c.p[1]), B = new THREE.Vector3(c.q[0], c.z, -c.q[1]);
      const l = c.alerte ? 2.6 : 1.4; // dépassement de la limite : trait plus fort
      jeter(trait([A.toArray(), B.toArray()], c.couleur, l));
      for (const P of [A, B]) jeter(trait([[P.x, P.y - 0.7, P.z], [P.x, P.y + 0.7, P.z]], c.couleur, l));
      const an = jeter(ancrage());
      an.position.copy(A).add(B).multiplyScalar(0.5);
      accrocher(an, etiquette(c.texte, c.couleur));
    }
    scene.demander();
  }

  function choisir(id) { const avant = sel; sel = id; survol = null; dessiner(); if (avant !== id) choix(id); }

  el.addEventListener("pointermove", e => {
    if (prise) return glisser(e);
    if (!actif() || dessine()) { if (survol) { survol = null; dessiner(); } return; }
    const h = viserPoignee(e);
    if (h) { el.style.cursor = h.object.userData.poignee === "tourner" ? "alias" : "move"; if (survol) { survol = null; dessiner(); } return; }
    const t = toucher(e), avant = survol && `${survol.id}/${survol.face}`;
    survol = t && t.id === sel ? t : null;
    el.style.cursor = t ? (t.id === sel ? (t.face === -1 ? "ns-resize" : "ew-resize") : "pointer") : "";
    if ((survol && `${survol.id}/${survol.face}`) !== avant) dessiner();
  });

  // appui : poignée, face du volume sélectionné, ou sélection d'un autre volume (avant la rotation de la vue)
  el.addEventListener("pointerdown", e => {
    if (e.button !== 0 || !actif() || dessine()) return;
    const hp = viserPoignee(e), t = hp ? null : toucher(e);
    if (!hp && !t) return;
    avantClic = performance.now();
    if (!hp && t.id !== sel) { choisir(t.id); return; }
    const v = volumeDe(sel);
    if (!v) return;
    const cam = scene.camera, vue = cam.getWorldDirection(new THREE.Vector3()), ras = vueRasante(cam);
    const depart = hp ? poignees.position.clone() : t.point.clone();
    prise = { mode: hp ? hp.object.userData.poignee : t.face === -1 ? "hauteur" : "mur", face: t?.face, depart, orig: v.coins.map(q => [...q]), hauteur: v.hauteur, v, y0: e.clientY, ras };
    prise.parPixel = parPixel(cam, depart);
    // plan de glissement : horizontal (murs, déplacer, tourner) ; en vue rasante (élévations), vertical face à la
    // caméra : on ne glisse alors que de côté ; hauteur : vertical face à la caméra, ou au pixel en vue de dessus
    const face = new THREE.Vector3(vue.x, 0, vue.z);
    if (prise.mode === "hauteur" || ras) prise.plan = face.lengthSq() > 0.04 ? new THREE.Plane().setFromNormalAndCoplanarPoint(face.normalize().negate(), depart) : null;
    else prise.plan = new THREE.Plane(new THREE.Vector3(0, 1, 0), -depart.y);
    const q0 = prise.plan && rayon(e).ray.intersectPlane(prise.plan, new THREE.Vector3());
    if (q0 && prise.mode !== "hauteur") depart.copy(q0); // le volume suit la souris sans saut
    if (prise.mode === "tourner") {
      const cx = prise.orig.reduce((s, p) => s + p[0], 0) / 4, cy = prise.orig.reduce((s, p) => s + p[1], 0) / 4;
      prise.centre = [cx, cy];
      prise.rayon = Math.max(1, RAYON * prise.parPixel);
      prise.droite = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
      prise.a0 = Math.atan2(-depart.z - cy, depart.x - cx);
    }
    scene.controls.enabled = false;
    el.setPointerCapture(e.pointerId);
    e.stopImmediatePropagation();
  }, true);

  function glisser(e) {
    const { v, orig, depart } = prise;
    if (prise.mode === "hauteur" && !prise.plan) {
      // vue de dessus : la hauteur suit le déplacement vertical de la souris
      reglerCorniche(v, Math.round((prise.hauteur - (e.clientY - prise.y0) * prise.parPixel) * 10) / 10);
    } else {
      const q = rayon(e).ray.intersectPlane(prise.plan, new THREE.Vector3());
      if (!q) return;
      const dx = q.x - depart.x, dy = -(q.z - depart.z);
      if (prise.mode === "deplacer") v.coins = orig.map(([x, y]) => [x + dx, y + dy]); // v.base ne change pas : altitude gardée
      else if (prise.mode === "tourner") {
        const [cx, cy] = prise.centre, r = prise.droite;
        // vue rasante : l'angle suit le glissement latéral (rapporté au rayon de l'anneau) ; sinon l'angle autour du centre
        const a = prise.ras ? -((q.x - depart.x) * r.x + (q.z - depart.z) * r.z) / prise.rayon : Math.atan2(-q.z - cy, q.x - cx) - prise.a0;
        const co = Math.cos(a), si = Math.sin(a);
        v.coins = orig.map(([x, y]) => [cx + (x - cx) * co - (y - cy) * si, cy + (x - cx) * si + (y - cy) * co]);
      } else if (prise.mode === "hauteur") reglerCorniche(v, Math.round((prise.hauteur + q.y - depart.y) * 10) / 10);
      else {
        // mur k : ses deux coins avancent le long de la normale extérieure (polygone dans le sens trigonométrique)
        const k = prise.face, n = orig.length, A = orig[k], B = orig[(k + 1) % n], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
        const nx = (B[1] - A[1]) / L, ny = -(B[0] - A[0]) / L;
        // le mur ne passe pas à moins d'un mètre du mur opposé
        const opp = orig.reduce((m, p) => Math.min(m, (p[0] - A[0]) * nx + (p[1] - A[1]) * ny), 0);
        const d = Math.max(opp + 1, dx * nx + dy * ny);
        v.coins = orig.map((p, i) => i === k || i === (k + 1) % n ? [p[0] + nx * d, p[1] + ny * d] : [...p]);
      }
    }
    scene.afficherVolumes(volumes());
    dessiner();
    bouge(v);
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
    /** Les volumes ont changé (liste, chargement d'un projet, tableau) : contour, poignées et cotes à jour. */
    maj() { if (sel != null && !volumeDe(sel)) choisir(null); else dessiner(); },
    choisir,
    deselectionner() { choisir(null); },
    get selection() { return sel; },
  };
}
