// Scène three.js. Repère : x = est, y = altitude (relative à zRef), z = sud (−nord).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { solEn } from "./grille.js";

export class Scene3D {
  constructor(conteneur) {
    this.el = conteneur;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    r.setPixelRatio(Math.min(2, devicePixelRatio));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    conteneur.appendChild(r.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#cfe3f3");
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 20000);
    this.camera.position.set(-120, 140, 160);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.ciel = new THREE.HemisphereLight("#ffffff", "#8a8f7a", 1.1);
    this.scene.add(this.ciel);
    const s = this.soleil = new THREE.DirectionalLight("#fff6e0", 2.6);
    s.castShadow = true;
    s.shadow.mapSize.set(4096, 4096);
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.25;
    this.scene.add(s, s.target);
    this.disque = new THREE.Mesh(new THREE.SphereGeometry(8, 16, 8), new THREE.MeshBasicMaterial({ color: "#ffcc33" }));
    this.disque.visible = false; // affiché dès qu'un lieu est chargé
    this.scene.add(this.disque);
    this.groupe = new THREE.Group();
    this.scene.add(this.groupe);
    new ResizeObserver(() => this.taille()).observe(conteneur);
    this.taille();
    r.setAnimationLoop(() => { this.controls.update(); r.render(this.scene, this.camera); });
  }

  taille() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  vider() {
    this.groupe.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    this.groupe.clear();
    this.couches = {};
  }

  /** Construit la scène depuis les grilles. */
  construire(G, nuage, parcelle, orthoUrl) {
    this.vider();
    this.G = G;
    this.zRef = solEn(G, 0, 0);
    const s = this.soleil.shadow.camera, R = G.R * 1.45;
    Object.assign(s, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 3000 });
    s.updateProjectionMatrix();

    const terrain = this.terrain(G, orthoUrl);
    const bati = maillageHauteurs(G, G.bat, this.zRef, true);
    bati.material = new THREE.MeshStandardMaterial({ color: G.classifie ? "#f1ece4" : "#c9c4bc", roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
    bati.castShadow = bati.receiveShadow = true;
    // la canopée porte l'ombre mais reste invisible : les arbres sont affichés en points
    const canopee = maillageHauteurs(G, G.veg, this.zRef, false);
    canopee.material = new THREE.MeshStandardMaterial({ color: "#5d8a3c", roughness: 1, side: THREE.DoubleSide });
    canopee.castShadow = true;
    const arbres = nuage ? points(nuage, this.zRef, c => c === 3 || c === 4 || c === 5, 0.5) : null;
    const tous = nuage ? points(nuage, this.zRef, () => true, 0.35) : null;
    const limite = contour(parcelle, G, this.zRef);
    this.couches = { terrain, bati, canopee, arbres, tous, limite };
    for (const o of Object.values(this.couches)) if (o) this.groupe.add(o);
    if (tous) tous.visible = false;
    if (arbres) canopee.material.colorWrite = canopee.material.depthWrite = false;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(-110, 120, 150);
  }

  terrain(G, orthoUrl) {
    const pas = 2, m = Math.floor(G.n / pas) + 1, pos = new Float32Array(m * m * 3), uv = new Float32Array(m * m * 2);
    for (let b = 0; b < m; b++) for (let a = 0; a < m; a++) {
      const x = G.x0 + a * pas * G.c, y = G.x0 + b * pas * G.c, k = b * m + a;
      pos.set([x, solEn(G, x, y) - this.zRef, -y], 3 * k);
      uv.set([(x - G.x0) / (2 * G.R), (y - G.x0) / (2 * G.R)], 2 * k);
    }
    const idx = [];
    for (let b = 0; b < m - 1; b++) for (let a = 0; a < m - 1; a++) {
      const p = b * m + a;
      idx.push(p, p + 1, p + m + 1, p, p + m + 1, p + m);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: "#d9d6c8", roughness: 1 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    if (orthoUrl) new THREE.TextureLoader().load(orthoUrl, t => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      mat.map = t; mat.color.set("#ffffff"); mat.needsUpdate = true;
    });
    return mesh;
  }

  /** Place le soleil ; `visible` = au-dessus de l'horizon (relief lointain compris). */
  placerSoleil(dir, visible) {
    const d = new THREE.Vector3(...dir);
    this.soleil.position.copy(d.clone().multiplyScalar(900));
    this.soleil.target.position.set(0, 0, 0);
    this.soleil.intensity = visible ? 2.6 : 0;
    this.ciel.intensity = visible ? 1.1 : Math.max(0.35, 0.9 * Math.min(1, (dir[1] + 0.1) * 4));
    this.disque.position.copy(d.clone().multiplyScalar(1200));
    this.disque.visible = dir[1] > -0.02;
    this.scene.background.set(visible ? "#cfe3f3" : dir[1] > 0 ? "#b4c2cf" : "#5c6b7a");
  }

  /** Carte des heures d'ensoleillement posée sur la surface. */
  afficherHeures({ heures, w, h }, [i0, j0], max) {
    this.couches.heures && (this.groupe.remove(this.couches.heures), this.couches.heures.geometry.dispose());
    const G = this.G, pos = [], col = [], c = new THREE.Color();
    const sommet = (i, j) => { // hauteur au coin : max des cellules voisines (suit toits et terrain)
      let z = -Infinity;
      for (const [di, dj] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
        const a = Math.min(G.n - 1, Math.max(0, i + di)), b = Math.min(G.n - 1, Math.max(0, j + dj));
        z = Math.max(z, G.base[b * G.n + a]);
      }
      return z;
    };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const gi = i0 + i, gj = j0 + j;
      couleurHeures(heures[j * w + i], max, c);
      const P = [[gi, gj], [gi + 1, gj], [gi + 1, gj + 1], [gi, gj + 1]].map(([a, b]) =>
        [G.x0 + a * G.c, sommet(a, b) - this.zRef + 0.15, -(G.x0 + b * G.c)]);
      for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(...P[k]); col.push(c.r, c.g, c.b); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
    this.couches.heures = m;
    this.groupe.add(m);
  }

  vuePieton(actif) {
    if (actif) {
      this.camera.position.set(0, 1.7, 0.01);
      this.controls.target.set(0, 1.7, -10);
      this.controls.maxPolarAngle = Math.PI * 0.75;
    } else {
      this.controls.maxPolarAngle = Math.PI * 0.495;
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(-110, 120, 150);
    }
  }
}

/** Échelle de couleurs bleu -> jaune -> rouge. */
export function couleurHeures(v, max, c = new THREE.Color()) {
  const t = Math.max(0, Math.min(1, v / Math.max(0.01, max)));
  return t < 0.5 ? c.setRGB(0.15 + t * 1.6, 0.3 + t * 1.2, 0.75 - t * 1.1) : c.setRGB(0.95, 0.9 - (t - 0.5) * 1.3, 0.2 - (t - 0.5) * 0.3);
}

/** Maillage d'une grille de hauteurs (NaN = vide) : dessus lissé aux coins + murs jusqu'au sol. */
function maillageHauteurs(G, val, zRef, murs) {
  const { n, c, x0, sol } = G, pos = [];
  const coin = new Float32Array((n + 1) * (n + 1)).fill(NaN);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    let s = 0, k = 0;
    for (const [a, b] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) {
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const v = val[b * n + a];
      if (!isNaN(v)) { s += v; k++; }
    }
    if (k) coin[j * (n + 1) + i] = s / k;
  }
  const P = (i, j, z) => [x0 + i * c, z - zRef, -(x0 + j * c)];
  const vide = (i, j) => i < 0 || j < 0 || i >= n || j >= n || isNaN(val[j * n + i]);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const v = val[j * n + i];
    if (isNaN(v)) continue;
    const A = P(i, j, coin[j * (n + 1) + i]), B = P(i + 1, j, coin[j * (n + 1) + i + 1]);
    const C = P(i + 1, j + 1, coin[(j + 1) * (n + 1) + i + 1]), D = P(i, j + 1, coin[(j + 1) * (n + 1) + i]);
    pos.push(...A, ...B, ...C, ...A, ...C, ...D);
    if (!murs) continue;
    const zs = sol[j * n + i] - 0.3 - zRef;
    for (const [ok, H, K] of [[vide(i, j - 1), A, B], [vide(i + 1, j), B, C], [vide(i, j + 1), C, D], [vide(i - 1, j), D, A]]) {
      if (!ok) continue;
      const Hb = [H[0], zs, H[2]], Kb = [K[0], zs, K[2]];
      pos.push(...H, ...Hb, ...Kb, ...H, ...Kb, ...K);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g);
}

const COULEURS = { 2: [0.78, 0.72, 0.6], 3: [0.33, 0.55, 0.22], 6: [0.92, 0.45, 0.35], 9: [0.3, 0.55, 0.85], 17: [0.6, 0.6, 0.6] };

/** Nuage de points coloré par classe (part = fraction gardée). */
function points(nuage, zRef, filtre, part) {
  const pos = [], col = [], pas = Math.max(1, Math.round(1 / part));
  for (let k = 0; k < nuage.n; k += 1) {
    if (!filtre(nuage.C[k]) || (pas > 1 && k % pas)) continue;
    pos.push(nuage.X[k], nuage.Z[k] - zRef, -nuage.Y[k]);
    col.push(...(COULEURS[nuage.C[k]] || [0.55, 0.55, 0.6]));
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size: 0.45, vertexColors: true }));
}

/** Limite de la parcelle posée sur le terrain. */
function contour(parcelle, G, zRef) {
  const grp = new THREE.Group();
  for (const anneau of parcelle.anneauxRel) {
    const pts = [];
    for (let k = 0; k < anneau.length - 1; k++) {
      const [x1, y1] = anneau[k], [x2, y2] = anneau[k + 1], L = Math.hypot(x2 - x1, y2 - y1), m = Math.max(1, Math.ceil(L));
      for (let t = 0; t < m; t++) {
        const x = x1 + (x2 - x1) * t / m, y = y1 + (y2 - y1) * t / m;
        pts.push(new THREE.Vector3(x, solEn(G, x, y) - zRef + 0.4, -y));
      }
    }
    pts.push(pts[0].clone());
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0), pts.length * 2, 0.25, 6),
      new THREE.MeshBasicMaterial({ color: "#e0262b" }));
    grp.add(tube);
  }
  return grp;
}
