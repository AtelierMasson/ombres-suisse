// Panneau d'administration : un petit bouton à côté du rapport de bug (comptes administrateurs seulement) ouvre une
// fenêtre flottante, déplaçable, à onglets — un onglet par outil. Premier outil : « Ponts » (parcourir les ponts faits
// main, y voler, cadrage latéral automatique, photos utilisées et leur crédit, superposition calée, vérification au
// nuage). Les images (public/ponts/photos, outils/ponts/publier_photos.py) ne sont chargées qu'à l'ouverture d'une fiche.
//
// Développement : pas d'API PHP sous Vite, donc pas de compte administrateur ; `?admin=1` dans l'adresse (ou
// localStorage « ombres.dev.admin » = "1") montre le bouton. Ce raccourci n'existe pas dans le build de production.

const BASE = `${import.meta.env?.BASE_URL ?? "/"}ponts/`;
const CLE_DEV = "ombres.dev.admin";
const CLE_POS = "ombres.admin.position";
const ORDRE_CONFIANCE = { bonne: 0, moyenne: 1, faible: 2 };

const echap = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const el = (tag, cls = "", html = "") => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };

function adminDev() {
  if (!import.meta.env.DEV) return false;
  try {
    const q = new URLSearchParams(location.search).get("admin");
    if (q === "1") localStorage.setItem(CLE_DEV, "1");
    if (q === "0") localStorage.removeItem(CLE_DEV);
    return localStorage.getItem(CLE_DEV) === "1";
  } catch { return false; }
}

/** Branche le bouton et la fenêtre. `scene` : Scene3D ; `t` : traductions. */
export function brancherAdmin({ compte, scene, t = c => c }) {
  const dev = adminDev();
  const bouton = el("button", "admin-bouton");
  bouton.type = "button";
  bouton.title = t("admin.titre");
  bouton.setAttribute("aria-label", t("admin.titre"));
  bouton.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>';
  bouton.hidden = true;
  document.body.append(bouton);
  let fenetre = null, actif = null; // déclarés avant montrer() (appelé tout de suite : en prod, sans admin, la fenêtre est lue)
  const montrer = () => {
    bouton.hidden = !(compte?.etat().admin || dev);
    if (bouton.hidden && fenetre) fenetre.hidden = true;
  };
  compte?.addEventListener("compte", montrer);
  compte?.pret?.then(montrer);
  montrer();

  // ------------------------------------------------------------------ fenêtre à onglets
  const outils = [{ id: "ponts", titre: t("admin.ponts.titre"), monter: corps => outilPonts(corps, { scene, t }) }];
  const montes = new Map();

  function creer() {
    fenetre = el("section", "admin-fenetre card shadow");
    fenetre.setAttribute("aria-label", t("admin.titre"));
    fenetre.innerHTML = `<header class="admin-entete card-header d-flex align-items-center gap-2 py-1 px-2">
        <strong class="small flex-grow-1">${echap(t("admin.titre"))}</strong>
        <button type="button" class="btn-close btn-sm" aria-label="${echap(t("admin.fermer"))}" data-fermer></button>
      </header>
      <ul class="nav nav-tabs nav-sm px-2 pt-1" role="tablist"></ul>
      <div class="admin-corps card-body p-2"></div>`;
    const onglets = fenetre.querySelector(".nav"), corps = fenetre.querySelector(".admin-corps");
    for (const o of outils) {
      const li = el("li", "nav-item"), b = el("button", "nav-link py-1 px-2 small", echap(o.titre));
      b.type = "button"; b.dataset.outil = o.id; b.setAttribute("role", "tab");
      b.addEventListener("click", () => choisir(o.id));
      li.append(b); onglets.append(li);
    }
    fenetre.querySelector("[data-fermer]").addEventListener("click", () => { fenetre.hidden = true; });
    document.body.append(fenetre);
    deplacable(fenetre, fenetre.querySelector(".admin-entete"));
    choisir(outils[0].id);

    function choisir(id) {
      actif = id;
      for (const b of onglets.querySelectorAll(".nav-link")) { b.classList.toggle("active", b.dataset.outil === id); b.setAttribute("aria-selected", b.dataset.outil === id); }
      for (const [k, div] of montes) div.hidden = k !== id;
      if (!montes.has(id)) {
        const div = el("div");
        corps.append(div); montes.set(id, div);
        outils.find(o => o.id === id).monter(div);
      }
    }
  }

  bouton.addEventListener("click", () => {
    if (!fenetre) creer();
    else fenetre.hidden = !fenetre.hidden;
  });
  return { ouvrir: () => { if (!fenetre) creer(); fenetre.hidden = false; } };
}

/** Fenêtre déplacée en la tirant par son en-tête ; la position est gardée dans ce navigateur. */
function deplacable(f, poignee) {
  const placer = (x, y) => {
    x = Math.max(0, Math.min(innerWidth - 80, x)); y = Math.max(0, Math.min(innerHeight - 40, y));
    Object.assign(f.style, { left: `${x}px`, top: `${y}px`, right: "auto", bottom: "auto" });
  };
  try { const p = JSON.parse(localStorage.getItem(CLE_POS) || "null"); if (p) placer(p.x, p.y); } catch { /* rien */ }
  poignee.addEventListener("pointerdown", e => {
    if (e.target.closest("button")) return;
    const r = f.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    poignee.setPointerCapture(e.pointerId);
    const bouger = ev => placer(ev.clientX - dx, ev.clientY - dy);
    const fin = () => {
      poignee.removeEventListener("pointermove", bouger);
      try { localStorage.setItem(CLE_POS, JSON.stringify({ x: parseFloat(f.style.left), y: parseFloat(f.style.top) })); } catch { /* rien */ }
    };
    poignee.addEventListener("pointermove", bouger);
    poignee.addEventListener("pointerup", fin, { once: true });
  });
}

// ------------------------------------------------------------------ outil « Ponts »

/** Milieu de l'axe (à mi-longueur), direction en plan et longueur. */
function milieuAxe(axe) {
  let L = 0;
  const seg = [];
  for (let i = 0; i < axe.length - 1; i++) { const l = Math.hypot(axe[i + 1][0] - axe[i][0], axe[i + 1][1] - axe[i][1]); seg.push(l); L += l; }
  let reste = L / 2, M = axe[0];
  for (let i = 0; i < seg.length; i++) {
    if (reste <= seg[i] || i === seg.length - 1) {
      const u = seg[i] ? Math.min(1, reste / seg[i]) : 0, a = axe[i], b = axe[i + 1];
      M = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, (a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * u];
      break;
    }
    reste -= seg[i];
  }
  const a = axe[0], b = axe[axe.length - 1], n = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return { M, L, u: [(b[0] - a[0]) / n, (b[1] - a[1]) / n] };
}

/**
 * Caméra de côté sur le pont (lieu chargé centré sur E0, N0) : perpendiculaire à l'axe, du côté où le terrain est le
 * plus bas, légèrement au-dessus du tablier ; jamais sous le terrain, ni avec le terrain entre la caméra et le pont.
 */
function cadrerPont(scene, P, E0, N0) {
  const { M, L, u } = milieuAxe(P.axe);
  const sol = (x, z) => { const s = scene.solSous(x, z); return Number.isFinite(s) ? s : NaN; };
  const mx = M[0] - E0, mz = -(M[1] - N0), deck = M[2] - scene.zRef;
  const solM = sol(mx, mz), hauteur = Number.isFinite(solM) ? Math.max(0, deck - solM) : 20;
  const cible = { x: mx, y: deck - Math.min(hauteur * 0.4, 40), z: mz };
  const d = Math.min(550, Math.max(70, L * 0.62, hauteur * 1.6));
  const essais = [1, -1].map(signe => {
    // normale en plan (E, N) → repère de la scène (x = E, z = −N)
    const nx = -u[1] * signe, nn = u[0] * signe;
    const cx = mx + nx * d, cz = mz - nn * d;
    let cy = cible.y + d * 0.22;
    const s = sol(cx, cz);
    if (Number.isFinite(s)) cy = Math.max(cy, s + 30);
    // ligne de visée dégagée : relevée tant qu'un point de la visée passe à moins de 25 m du terrain (arbres, maisons)
    // ; près du pont, la marge diminue (le tablier est souvent bas sur le terrain)
    let releve = 0;
    for (let k = 0; k < 6; k++) {
      let manque = 0;
      for (let i = 1; i < 20; i++) {
        const f = i / 20, x = cx + (cible.x - cx) * f, z = cz + (cible.z - cz) * f, y = cy + (cible.y - cy) * f, so = sol(x, z);
        const marge = 25 * Math.min(1, (1 - f) * 2.5);
        if (Number.isFinite(so) && y < so + marge) manque = Math.max(manque, (so + marge - y) / (1 - f));
      }
      if (!manque) break;
      cy += manque; releve += manque;
    }
    return { x: cx, y: cy, z: cz, releve: releve + (Number.isFinite(s) ? s : 0) * 0.01 };
  });
  const cam = essais.sort((a, b) => a.releve - b.releve)[0];
  // fenêtre d'administration ouverte sur la vue : le pont est décalé vers la partie libre de l'écran
  const f = document.querySelector(".admin-fenetre:not([hidden])"), v = scene.renderer?.domElement.getBoundingClientRect();
  if (f && v?.width) {
    const r = f.getBoundingClientRect(), libreG = Math.max(0, r.left - v.left), libreD = Math.max(0, v.right - r.right);
    const px = libreG >= libreD ? (v.width - libreG) / 2 : -(v.width - libreD) / 2; // > 0 : vers la gauche
    if (Math.abs(px) > 20 && Math.max(libreG, libreD) > v.width * 0.3) {
      const dist = Math.hypot(cam.x - cible.x, cam.y - cible.y, cam.z - cible.z);
      const demiL = Math.tan((scene.camera.fov || 45) * Math.PI / 360) * dist * (v.width / v.height);
      const dx = cible.x - cam.x, dz = cible.z - cam.z, n = Math.hypot(dx, dz) || 1;
      const droite = [-dz / n, dx / n]; // à droite de la visée, en plan (repère x, z)
      const k = px / (v.width / 2) * demiL;
      // seule la cible bouge : la caméra garde sa place dégagée, le regard tourne un peu vers la droite
      cible.x += droite[0] * k; cible.z += droite[1] * k;
    }
  }
  if (scene.modeVue) scene.vueOrtho(null);
  animer(scene, cam, cible);
  return { cam, cible };
}

function animer(scene, p1, c1, duree = 900) {
  const cam = scene.camera, ctl = scene.controls, p0 = cam.position.clone(), c0 = ctl.target.clone(), t0 = performance.now();
  const pas = () => {
    const v = Math.min(1, (performance.now() - t0) / duree), e = v < 0.5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2;
    cam.position.set(p0.x + (p1.x - p0.x) * e, p0.y + (p1.y - p0.y) * e, p0.z + (p1.z - p0.z) * e);
    ctl.target.set(c0.x + (c1.x - c0.x) * e, c0.y + (c1.y - c0.y) * e, c0.z + (c1.z - c0.z) * e);
    ctl.update(); scene.demander?.(2);
    if (v < 1) requestAnimationFrame(pas);
  };
  // onglet caché : pas d'images, donc pas d'animation — la vue est posée tout de suite
  if (document.hidden) { cam.position.set(p1.x, p1.y, p1.z); ctl.target.set(c1.x, c1.y, c1.z); ctl.update(); scene.demander?.(2); return; }
  requestAnimationFrame(pas);
}

function outilPonts(racine, { scene, t }) {
  racine.innerHTML = `<div class="admin-ponts">
    <div class="d-flex gap-1 mb-1">
      <input type="search" class="form-control form-control-sm" data-recherche placeholder="${echap(t("admin.ponts.rechercher"))}" aria-label="${echap(t("admin.ponts.rechercher"))}">
      <select class="form-select form-select-sm w-auto" data-confiance aria-label="${echap(t("admin.ponts.confiance"))}">
        <option value="">${echap(t("admin.ponts.toutes"))}</option>
        <option value="bonne">${echap(t("admin.ponts.c.bonne"))}</option>
        <option value="moyenne">${echap(t("admin.ponts.c.moyenne"))}</option>
        <option value="faible">${echap(t("admin.ponts.c.faible"))}</option>
      </select>
    </div>
    <div class="d-flex gap-2 align-items-center mb-1 small">
      <label class="d-flex align-items-center gap-1 text-nowrap">${echap(t("admin.ponts.tri"))}
        <select class="form-select form-select-sm w-auto" data-tri>
          <option value="nom">${echap(t("admin.ponts.tri.nom"))}</option>
          <option value="confiance">${echap(t("admin.ponts.tri.confiance"))}</option>
          <option value="ville">${echap(t("admin.ponts.tri.ville"))}</option>
          <option value="photos">${echap(t("admin.ponts.tri.photos"))}</option>
        </select></label>
      <div class="form-check form-check-inline m-0"><input class="form-check-input" type="checkbox" id="adminAvecPhotos" data-avecphotos>
        <label class="form-check-label" for="adminAvecPhotos">${echap(t("admin.ponts.avecPhotos"))}</label></div>
    </div>
    <div class="d-flex align-items-center gap-1 mb-1">
      <button type="button" class="btn btn-sm btn-outline-secondary" data-prec title="${echap(t("admin.ponts.precedent"))}" aria-label="${echap(t("admin.ponts.precedent"))}">‹</button>
      <span class="small text-secondary flex-grow-1 text-center" data-compte role="status"></span>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-suiv title="${echap(t("admin.ponts.suivant"))}" aria-label="${echap(t("admin.ponts.suivant"))}">›</button>
    </div>
    <div class="list-group list-group-flush admin-liste" data-liste></div>
    <div class="admin-fiche mt-2" data-fiche hidden></div>
  </div>`;
  const $ = s => racine.querySelector(s);
  const liste = $("[data-liste]"), fiche = $("[data-fiche]"), compteur = $("[data-compte]");
  let ponts = [], vus = [], courant = null, suivi = null;

  compteur.textContent = t("admin.ponts.chargement");
  (async () => {
    const [index, photos] = await Promise.all([
      fetch(BASE + "index.json", { cache: "no-store" }).then(r => r.json()),
      fetch(BASE + "photos/index.json", { cache: "no-store" }).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    ]);
    // JSON de chaque pont (confiance, notes, sources, crédit de la photo) : lus en parallèle, 12 à la fois
    const res = new Array(index.length);
    let i = 0, fini = 0;
    await Promise.all(Array.from({ length: 12 }, async () => {
      while (i < index.length) {
        const k = i++;
        res[k] = await fetch(BASE + index[k].fichier).then(r => r.ok ? r.json() : null).catch(() => null);
        if (++fini % 25 === 0) compteur.textContent = `${t("admin.ponts.chargement")} ${fini}/${index.length}`;
      }
    }));
    ponts = index.map((p, k) => {
      const id = p.fichier.replace(/\.json$/, ""), J = res[k] || {}, ph = photos[id] || { fichiers: [] };
      const nPhotos = ph.fichiers.filter(f => f.role === "photo" || f.role === "vue").length;
      return { id, nom: J.nom || p.nom, ville: ph.ville || "", confiance: J.confiance || "", nPhotos, fichiers: ph.fichiers, J, axe: J.axe };
    }).filter(p => p.axe?.length >= 2);
    filtrer();
  })().catch(e => { compteur.textContent = t("admin.ponts.erreur", { m: e.message }); });

  function filtrer() {
    const q = $("[data-recherche]").value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const c = $("[data-confiance]").value, avec = $("[data-avecphotos]").checked, tri = $("[data-tri]").value;
    const sans = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    vus = ponts.filter(p => (!c || p.confiance === c) && (!avec || p.nPhotos > 0)
      && (!q || sans(`${p.nom} ${p.ville} ${p.id}`).includes(q)));
    const cmp = (a, b) => a.nom.localeCompare(b.nom, "fr");
    vus.sort({
      nom: cmp,
      confiance: (a, b) => (ORDRE_CONFIANCE[a.confiance] ?? 9) - (ORDRE_CONFIANCE[b.confiance] ?? 9) || cmp(a, b),
      ville: (a, b) => (a.ville || "~").localeCompare(b.ville || "~", "fr") || cmp(a, b),
      photos: (a, b) => b.nPhotos - a.nPhotos || cmp(a, b),
    }[tri]);
    dessinerListe();
  }

  function dessinerListe() {
    liste.replaceChildren(...vus.map(p => {
      const b = el("button", "list-group-item list-group-item-action py-1 px-2 small d-flex align-items-center gap-2");
      b.type = "button"; b.dataset.id = p.id;
      b.innerHTML = `<span class="flex-grow-1 text-truncate" title="${echap(p.nom)}">${echap(p.nom)}${p.ville ? `<span class="text-secondary"> · ${echap(p.ville)}</span>` : ""}</span>
        ${p.nPhotos ? `<span class="text-secondary text-nowrap" title="${echap(t("admin.ponts.nPhotos", { n: p.nPhotos }))}">${p.nPhotos}&nbsp;ph.</span>` : ""}
        ${badge(p.confiance)}`;
      b.classList.toggle("active", p === courant);
      b.addEventListener("click", () => choisir(p));
      return b;
    }));
    majCompteur();
  }

  const badge = c => c ? `<span class="badge admin-confiance admin-confiance-${echap(c)}">${echap(t(`admin.ponts.c.${c}`))}</span>` : "";

  function majCompteur() {
    const i = vus.indexOf(courant);
    compteur.textContent = i >= 0 ? `${i + 1} / ${vus.length}` : t("admin.ponts.n", { n: vus.length });
    $("[data-prec]").disabled = $("[data-suiv]").disabled = !vus.length;
  }

  function parcourir(sens) {
    if (!vus.length) return;
    const i = vus.indexOf(courant);
    choisir(vus[i < 0 ? (sens > 0 ? 0 : vus.length - 1) : (i + sens + vus.length) % vus.length]);
  }

  function choisir(p) {
    courant = p;
    for (const b of liste.children) b.classList.toggle("active", b.dataset.id === p.id);
    liste.querySelector(`[data-id="${CSS.escape(p.id)}"]`)?.scrollIntoView({ block: "nearest" });
    majCompteur();
    dessinerFiche(p);
    voler(p);
  }

  /** Vol vers le pont : lieu centré sur le milieu de l'axe (voyage : centre exact), puis cadrage de côté. */
  function voler(p) {
    const { M } = milieuAxe(p.axe), E = Math.round(M[0]), N = Math.round(M[1]);
    clearInterval(suivi?.minuterie);
    const Gavant = scene.G, ici = scene.lieuPonts?.E === E && scene.lieuPonts?.N === N && scene.G;
    if (ici) { cadrerPont(scene, p.J, E, N); return; }
    location.hash = `e=${E}&n=${N}&l=${encodeURIComponent(p.nom)}&t=Voyage`;
    // la maquette se construit deux fois (vue de base, puis relevé) : cadrée à chaque fois, jusqu'à ce qu'on touche
    // à la vue ou au bout d'une minute
    const s = suivi = { G: Gavant, A: null, t0: performance.now(), touche: false };
    const toucher = () => { s.touche = true; };
    scene.controls.addEventListener("start", toucher);
    s.minuterie = setInterval(() => {
      const fini = () => { clearInterval(s.minuterie); scene.controls.removeEventListener("start", toucher); };
      if (suivi !== s || performance.now() - s.t0 > 60000) return fini();
      if (s.touche && s.cadre) return fini();
      // recadré aussi quand l'anneau arrive (terrain connu plus loin : la caméra peut devoir monter)
      const A = scene.couches?.anneau?.visible ? scene.couches.anneau : null;
      if (scene.G && (scene.G !== s.G || (s.cadre && A !== s.A)) && scene.lieuPonts?.E === E && scene.lieuPonts?.N === N) {
        s.G = scene.G; s.A = A; s.cadre = true;
        cadrerPont(scene, p.J, E, N);
      }
    }, 250);
  }

  function dessinerFiche(p) {
    const J = p.J, roles = r => p.fichiers.filter(f => r.includes(f.role));
    const url = f => `${BASE}photos/${p.id}/${f.fichier}`;
    const credit = f => {
      const c = f.credit;
      if (!c) return `<span class="text-warning-emphasis">${echap(t("admin.ponts.sourceAPreciser"))}</span>`;
      const txt = [c.auteur, c.licence].filter(Boolean).map(echap).join(", ") || echap(t("admin.ponts.voirPage"));
      return c.page ? `<a href="${echap(c.page)}" target="_blank" rel="noopener">${txt}</a>` : txt;
    };
    const vignettes = (liste, titre) => liste.length ? `<h3 class="admin-sous-titre">${echap(titre)}</h3>
      <div class="admin-vignettes">${liste.map(f => `<figure class="m-0">
        <button type="button" class="admin-vignette" data-image="${echap(url(f))}" data-legende="${echap(t(`admin.ponts.role.${f.role}`))}">
          <img loading="lazy" src="${echap(url(f))}" alt="${echap(t(`admin.ponts.role.${f.role}`))}"></button>
        ${f.role === "photo" || f.role === "vue" || f.role === "ortho" ? `<figcaption class="small">${credit(f)}</figcaption>` : ""}</figure>`).join("")}</div>` : "";
    const photos = roles(["photo", "vue", "ortho"]), travail = roles(["superposition", "verification"]);
    const sources = (J.sources || []).map(s => {
      const u = String(s).match(/^https?:\/\/\S+/)?.[0];
      return `<li>${u ? `<a href="${echap(u)}" target="_blank" rel="noopener">${echap(decodeURI(u).replace(/^https?:\/\/(www\.)?/, ""))}</a>${echap(String(s).slice(u.length))}` : echap(s)}</li>`;
    }).join("");
    fiche.hidden = false;
    fiche.innerHTML = `<div class="d-flex align-items-start gap-2">
        <div class="flex-grow-1"><h2 class="h6 mb-0">${echap(p.nom)}</h2>
        <div class="small text-secondary">${[p.ville, p.id].filter(Boolean).map(echap).join(" · ")}</div></div>
        ${badge(p.confiance)}
      </div>
      <div class="d-flex gap-1 my-1">
        <button type="button" class="btn btn-sm btn-outline-primary" data-aller>${echap(t("admin.ponts.aller"))}</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-cadrer>${echap(t("admin.ponts.cadrer"))}</button>
      </div>
      ${photos.length ? vignettes(photos, t("admin.ponts.photos")) : `<p class="small text-secondary my-1">${echap(t("admin.ponts.sansPhoto"))}${J.photos_vues ? ` (${echap(t("admin.ponts.photosVues", { n: J.photos_vues }))})` : ""}</p>`}
      ${vignettes(travail, t("admin.ponts.travail"))}
      ${J.notes ? `<h3 class="admin-sous-titre">${echap(t("admin.ponts.notes"))}</h3><p class="small admin-notes mb-1">${echap(J.notes)}</p>` : ""}
      ${sources ? `<h3 class="admin-sous-titre">${echap(t("admin.ponts.sources"))}</h3><ul class="small admin-sources mb-0">${sources}</ul>` : ""}`;
    fiche.querySelector("[data-aller]").addEventListener("click", () => voler(p));
    fiche.querySelector("[data-cadrer]").addEventListener("click", () => {
      if (scene.lieuPonts && scene.G) cadrerPont(scene, J, scene.lieuPonts.E, scene.lieuPonts.N);
    });
    for (const b of fiche.querySelectorAll("[data-image]")) {
      b.addEventListener("click", () => agrandir(b.dataset.image, b.dataset.legende, b.closest("figure").querySelector("figcaption")?.innerHTML || ""));
    }
  }

  function agrandir(src, legende, credit) {
    const d = el("dialog", "admin-agrandi");
    d.innerHTML = `<form method="dialog" class="m-0"><img src="${echap(src)}" alt="${echap(legende)}">
      <div class="d-flex align-items-center gap-2 mt-2 small"><span class="flex-grow-1"><strong>${echap(legende)}</strong>${credit ? ` · ${credit}` : ""}</span>
      <a class="btn btn-sm btn-link" href="${echap(src)}" target="_blank" rel="noopener">${echap(t("admin.ponts.ouvrir"))}</a>
      <button class="btn btn-sm btn-outline-secondary">${echap(t("admin.fermer"))}</button></div></form>`;
    d.addEventListener("click", e => { if (e.target === d || e.target.tagName === "IMG") d.close(); });
    d.addEventListener("close", () => d.remove());
    document.body.append(d);
    d.showModal();
  }

  $("[data-recherche]").addEventListener("input", filtrer);
  for (const s of ["[data-confiance]", "[data-tri]", "[data-avecphotos]"]) $(s).addEventListener("change", filtrer);
  $("[data-prec]").addEventListener("click", () => parcourir(-1));
  $("[data-suiv]").addEventListener("click", () => parcourir(1));
  // clavier dans la liste : ↑ ↓ pour passer d'un pont à l'autre
  liste.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); parcourir(e.key === "ArrowDown" ? 1 : -1); liste.querySelector(".active")?.focus(); }
  });
}
