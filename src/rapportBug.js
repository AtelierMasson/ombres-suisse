// Rapport de bug, pour les comptes administrateurs : un petit bouton en bas à droite capture la vue 3D, demande un
// commentaire et envoie le tout avec l'état de l'application en JSON (api/rapport.php). Rien pour les autres comptes.

// derniers messages de la console (erreurs et avertissements) : joints au rapport
const journal = [];
const garder = (niveau, args) => {
  const texte = args.map(a => a instanceof Error ? `${a.message}\n${a.stack || ""}` : typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()).join(" ");
  if (/ThreeTilesRenderer : Non uniform scale/.test(texte)) return; // bruit connu
  journal.push({ t: Math.round(performance.now()), niveau, texte: texte.slice(0, 2000) });
  if (journal.length > 80) journal.shift();
};
for (const niveau of ["error", "warn"]) {
  const avant = console[niveau].bind(console);
  console[niveau] = (...a) => { garder(niveau, a); avant(...a); };
}
addEventListener("error", e => garder("exception", [e.error || e.message]));
addEventListener("unhandledrejection", e => garder("promesse", [e.reason]));

// version publiée (version.txt, écrit à la mise en ligne ; absent en développement)
let version = "dev";
fetch("/version.txt", { cache: "no-store" }).then(r => r.ok ? r.text() : "dev").then(v => { if (!v.trimStart().startsWith("<")) version = v.trim() || "dev"; }).catch(() => {});

/** Réglages de l'application gardés dans le navigateur (clés « ombres.* »), chacun coupé à 20 000 caractères. */
function reglages() {
  const r = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith("ombres.")) r[k] = String(localStorage.getItem(k)).slice(0, 20000);
    }
  } catch { /* stockage indisponible */ }
  return r;
}

function infoGpu(renderer) {
  try {
    const gl = renderer.getContext(), ext = gl.getExtension("WEBGL_debug_renderer_info");
    return { carte: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), fournisseur: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : "", webgl2: renderer.capabilities?.isWebGL2 };
  } catch { return null; }
}

/**
 * `scene` : la scène 3D (renderer, camera, controls, rendre) ; `etatApp()` : l'état propre à main.js (lieu, rayon, onglet…).
 */
export function brancherRapport({ compte, scene, etatApp = () => ({}), t = c => c, api = "/api" }) {
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "rapport-bug-bouton";
  bouton.title = t("rapport.titre");
  bouton.setAttribute("aria-label", t("rapport.titre"));
  bouton.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 7a4 4 0 0 1 8 0M7 10h10v4a5 5 0 0 1-10 0zM12 10v9M3 12h4M17 12h4M4 7l3 2M20 7l-3 2M4 18l3-2M20 18l-3-2"/></svg>';
  bouton.hidden = true;
  document.body.append(bouton);
  const montrer = () => { bouton.hidden = !compte.etat().admin; };
  compte.addEventListener("compte", montrer);
  compte.pret?.then(montrer);

  /** Image de la vue 3D telle qu'affichée (rendue juste avant la lecture : pas besoin de garder le tampon). */
  function capture() {
    try { scene.rendre(); return scene.renderer.domElement.toDataURL("image/jpeg", 0.85); } catch { return null; }
  }

  function etat() {
    const c = scene.camera, cible = scene.controls?.target;
    const r3 = v => v && [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
    let app = {};
    try { app = etatApp() || {}; } catch (e) { app = { erreur: e.message }; }
    return {
      version,
      adresse: location.href,
      langue: document.documentElement.lang,
      date: new Date().toISOString(),
      fenetre: { largeur: innerWidth, hauteur: innerHeight, ratio: devicePixelRatio },
      navigateur: navigator.userAgent,
      gpu: infoGpu(scene.renderer),
      camera: { position: r3(c?.position), cible: r3(cible), fov: c?.fov, proche: c?.near, loin: c?.far },
      scene: {
        modeVue: scene.modeVue ?? null, typeFond: scene.typeFond ?? null, zRef: scene.zRef, zBasAnneau: scene.zBasAnneau ?? null,
        rayonFin: scene.G?.rayonZone ?? scene.G?.R ?? null, rayonExt: scene.rayonExt ?? null, coupe: !!scene.coupe,
        rendu: scene.renderer?.info ? { triangles: scene.renderer.info.render.triangles, appels: scene.renderer.info.render.calls, geometries: scene.renderer.info.memory.geometries, textures: scene.renderer.info.memory.textures } : null,
      },
      application: app,
      reglages: reglages(),
      console: journal.slice(),
    };
  }

  let dlg = null;
  function ouvrir() {
    const image = capture(), donnees = etat();
    dlg?.remove();
    dlg = document.createElement("dialog");
    dlg.className = "rapport-bug";
    dlg.innerHTML = `<form method="dialog">
      <h2 class="h6 mb-2">${t("rapport.titre")}</h2>
      ${image ? `<img alt="" class="rapport-bug-image">` : `<p class="small text-secondary">${t("rapport.sansImage")}</p>`}
      <textarea class="form-control form-control-sm mt-2" rows="4" maxlength="5000" placeholder="${t("rapport.commentaire")}"></textarea>
      <p class="small text-secondary mt-1 mb-2">${t("rapport.note")}</p>
      <div class="d-flex gap-2 justify-content-end">
        <button type="button" class="btn btn-sm btn-link" data-telecharger>${t("rapport.telecharger")}</button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-fermer>${t("rapport.annuler")}</button>
        <button type="submit" class="btn btn-sm btn-primary" data-envoyer>${t("rapport.envoyer")}</button>
      </div>
      <p class="small mt-2 mb-0" role="status" data-statut></p>
    </form>`;
    if (image) dlg.querySelector("img").src = image;
    document.body.append(dlg);
    const zone = dlg.querySelector("textarea"), statut = dlg.querySelector("[data-statut]");
    const corps = () => ({ commentaire: zone.value.trim(), image, etat: donnees });
    dlg.querySelector("[data-fermer]").onclick = () => dlg.close();
    dlg.querySelector("[data-telecharger]").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(corps(), null, 2)], { type: "application/json" }));
      a.download = `topograph-rapport-${donnees.date.replace(/[:.]/g, "-")}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    dlg.querySelector("form").onsubmit = async ev => {
      ev.preventDefault();
      const b = dlg.querySelector("[data-envoyer]");
      b.disabled = true; statut.textContent = t("rapport.envoi");
      try {
        const r = await fetch(`${api}/rapport.php`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps()) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.erreur || r.status);
        statut.textContent = t("rapport.envoye", { id: d.id });
        setTimeout(() => dlg.open && dlg.close(), 1500);
      } catch (e) {
        statut.textContent = t("rapport.echec", { erreur: e.message });
        b.disabled = false;
      }
    };
    dlg.addEventListener("close", () => dlg.remove());
    dlg.showModal();
    zone.focus();
  }
  bouton.addEventListener("click", ouvrir);
  return { ouvrir };
}
