// Compte : connexion par lien e-mail, statut Gratuit / Pro, achat unique (CHF 39.–). Sans dépendance.
// Un seul écran : une petite boîte <dialog> ouverte par le bouton « Compte » de la barre du haut.
// Si l'API n'est pas joignable (site statique seul), le module se tait : bouton masqué, etat() déconnecté.
//
//   const compte = brancherCompte({ api: "/api", t });
//   compte.monter(document.getElementById("haut"), document.getElementById("themes"));
//   compte.addEventListener("compte", e => verrouiller(!e.detail.pro));
//   if (!compte.exigerPro(t("pro.raisonExport"))) return;

const CLE_INTENTION = "ombres.compte.achat"; // « veut passer pro » mémorisé pendant l'aller-retour par e-mail

export function brancherCompte({ api = "/api", t = c => c } = {}) {
  const bus = new EventTarget();
  let e = { connecte: false, email: null, pro: false, admin: false, profil: {} };
  let disponible = false;
  let bouton = null, dlg = null, raison = "", message = "", annonce = false;
  const sections = []; // parties ajoutées à la boîte d'un compte connecté (ex. « Mes lieux », lieux.js)

  const appel = (chemin, options = {}) =>
    fetch(api + chemin, { credentials: "include", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) }, ...options });

  function changer(nouveau) {
    const avant = JSON.stringify(e);
    e = { ...nouveau };
    if (bouton) majBouton();
    if (dlg?.open) dessiner();
    // premier état connu, puis chaque changement
    if (annonce && JSON.stringify(e) === avant) return;
    annonce = true;
    bus.dispatchEvent(new CustomEvent("compte", { detail: etat() }));
  }

  /** Relit /moi.php. 200 → connecté, 401 → déconnecté, autre ou réseau → API absente (module muet). */
  async function relire() {
    try {
      const r = await appel("/moi.php");
      if (r.status === 401) {
        // session remplacée par une connexion sur un autre appareil (un seul appareil à la fois par compte)
        const etaitConnecte = e.connecte;
        disponible = true; changer({ connecte: false, email: null, pro: false });
        if (etaitConnecte) { message = t("compte.autreAppareil"); ouvrir(); }
      }
      else if (r.ok) {
        const d = await r.json();
        disponible = true;
        changer({ connecte: true, email: String(d.email || ""), pro: !!d.pro, admin: !!d.admin, profil: d.profil || {}, retractation: d.retractation || null });
      } else disponible = false;
    } catch { disponible = false; }
    if (bouton) bouton.hidden = !disponible;
    return etat();
  }

  // ------------------------------------------------------------------ interface

  function monter(conteneur, avant = null) {
    if (bouton || typeof document === "undefined" || !conteneur) return;
    bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "compte-bouton";
    bouton.hidden = !disponible;
    bouton.addEventListener("click", () => ouvrir());
    conteneur.insertBefore(bouton, avant);
    majBouton();
  }

  function majBouton() {
    bouton.textContent = t(e.connecte ? "compte.boutonConnecte" : "compte.bouton");
    bouton.title = e.connecte ? e.email : t("compte.boutonTitre");
    if (e.pro) {
      const b = document.createElement("span");
      b.className = "compte-pro";
      b.textContent = "Pro";
      bouton.append(" ", b);
    }
  }

  function creerBoite() {
    dlg = document.createElement("dialog");
    dlg.id = "compte";
    dlg.setAttribute("aria-labelledby", "compteTitre");
    dlg.addEventListener("click", ev => {
      if (ev.target === dlg || ev.target.closest("[data-fermer]")) { dlg.close(); return; }
      if (ev.target.closest("[data-legal]")) { dlg.close(); return; } // la boîte légale s'ouvre par main.js
      const a = ev.target.closest("[data-action]")?.dataset.action;
      if (a === "acheter") {
        const c = dlg.querySelector("input[name=cgv]");
        if (c && !c.checked) {
          // ce qui manque, bien visible : la case des conditions entourée et une phrase sous elle
          const lab = c.closest(".compte-cgv"), m = dlg.querySelector(".compte-manque");
          lab?.classList.add("compte-cgv-manque"); if (m) m.hidden = false; c.focus();
          return;
        }
        acheter();
      }
      else if (a === "deconnecter") deconnecter();
      else if (a === "supprimer") supprimer();
      else if (a === "retracter") retracter();
    });
    dlg.addEventListener("submit", ev => {
      ev.preventDefault();
      if (ev.target.dataset.profil !== undefined) enregistrerProfil(ev.target);
      else demanderLien(ev.target.elements.email.value);
    });
    dlg.addEventListener("close", () => { raison = ""; message = ""; });
    document.body.append(dlg);
  }

  const el = (tag, cls, texte) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texte != null) n.textContent = texte;
    return n;
  };
  const bouton2 = (cls, texte, action) => { const b = el("button", cls, texte); b.type = "button"; b.dataset.action = action; return b; };

  function dessiner() {
    const fermer = el("button", "btn-close");
    fermer.type = "button";
    fermer.dataset.fermer = "";
    fermer.setAttribute("aria-label", t("compte.fermer"));
    const titre = el("h2", null, t("compte.titre"));
    titre.id = "compteTitre";
    const contenu = [fermer, titre];
    if (raison && !e.pro) contenu.push(el("p", "compte-raison", raison));

    if (!e.connecte) {
      contenu.push(el("p", "compte-doux", t("compte.explication")));
      const f = el("form", "compte-formulaire");
      const champ = el("input", "form-control");
      Object.assign(champ, { type: "email", name: "email", required: true, autocomplete: "email", placeholder: t("compte.emailPlaceholder") });
      champ.setAttribute("aria-label", t("compte.email"));
      const envoyer = el("button", "btn btn-primary", t("compte.recevoirLien"));
      envoyer.type = "submit";
      f.append(champ, envoyer);
      contenu.push(f);
    } else {
      const dl = el("dl", "compte-infos");
      dl.append(el("dt", null, t("compte.email")), el("dd", null, e.email),
        el("dt", null, t("compte.statut")), el("dd", e.pro ? "compte-statut-pro" : null, t(e.pro ? "compte.pro" : "compte.gratuit")));
      contenu.push(dl);
      if (e.pro) {
        contenu.push(el("p", "compte-doux", t("compte.merci")));
      }
      else {
        // offre Pro : titre, avantages, bouton et conditions dans un même encadré, bien visible
        const offre = el("div", "compte-offre");
        offre.append(el("div", "compte-offre-titre", "Topograph Pro"), el("p", "compte-offre-texte", t("compte.avantages")));
        // conditions de vente : case obligatoire avant le paiement (exécution immédiate, renonciation à la rétractation)
        const accord = el("label", "compte-cgv");
        const case_ = el("input"); case_.type = "checkbox"; case_.name = "cgv";
        accord.append(case_, " ", el("span", null, t("compte.accepteCgv")));
        // bouton toujours actif : sans la case, il dit ce qui manque (au lieu d'un bouton grisé sans explication)
        const acheter = bouton2("btn btn-primary w-100", t("compte.passerPro"), "acheter");
        const manque = el("p", "compte-manque", t("compte.cocherCgv"));
        manque.hidden = true; manque.setAttribute("role", "alert");
        case_.addEventListener("change", () => { if (case_.checked) { manque.hidden = true; accord.classList.remove("compte-cgv-manque"); } });
        offre.append(accord, manque, acheter);
        const note = el("p", "compte-note", t("compte.paiement") + " ");
        const cgv = el("a", null, t("compte.conditions"));
        cgv.href = "#";
        cgv.dataset.legal = "conditions";
        note.append(cgv);
        offre.append(note);
        contenu.push(offre);
      }
      for (const f of sections) { const n = f(); if (n) contenu.push(n); }
      // informations du compte (facultatives) : repliées, un seul formulaire
      const P = e.profil || {}, det = el("details", "compte-profil"), resume = el("summary", null, t("compte.mesInfos"));
      const f = el("form", "compte-profil-form");
      f.dataset.profil = "";
      const champ = (nom, auto, large = false) => {
        const c = el("input", "form-control form-control-sm");
        Object.assign(c, { name: nom, value: P[nom] || "", autocomplete: auto, placeholder: t("compte.champ." + nom) });
        c.setAttribute("aria-label", t("compte.champ." + nom));
        if (large) c.classList.add("large");
        return c;
      };
      f.append(champ("prenom", "given-name"), champ("nom", "family-name"), champ("societe", "organization", true), champ("adresse", "street-address", true),
        champ("npa", "postal-code"), champ("localite", "address-level2"), champ("pays", "country-name"), champ("telephone", "tel"));
      const ok = el("button", "btn btn-sm btn-outline-primary large", t("compte.enregistrer"));
      ok.type = "submit";
      f.append(ok);
      det.append(resume, f);
      if (!P.prenom && !P.nom) det.open = true; // pas encore rempli : ouvert
      contenu.push(det);
      if (e.admin) {
        const a = el("a", "btn btn-sm btn-outline-secondary w-100 mt-2", t("compte.administration"));
        a.href = "/admin/";
        contenu.push(a);
      }
      contenu.push(bouton2("btn btn-link btn-sm compte-deconnexion", t("compte.deconnecter"), "deconnecter"));
      // « Gestion du compte » : un lien discret qui déplie la rétractation (14 jours après l'achat) et la suppression
      const gestion = el("details", "compte-gestion");
      gestion.append(el("summary", null, t("compte.gestion")));
      if (e.pro && e.retractation) {
        const date = new Date(e.retractation).toLocaleDateString(langueDoc() + "-CH", { day: "numeric", month: "long", year: "numeric" });
        gestion.append(bouton2("btn btn-link btn-sm compte-retracter", t("compte.retracter"), "retracter"),
          el("p", "compte-retracter-note", t("compte.retractationInfo", { date })));
      }
      gestion.append(bouton2("btn btn-link btn-sm compte-supprimer", t("compte.supprimer"), "supprimer"));
      contenu.push(gestion);
    }
    if (message) {
      const m = el("p", "compte-message", message);
      m.setAttribute("role", "status");
      contenu.push(m);
    }
    dlg.replaceChildren(...contenu);
  }

  function ouvrir() {
    if (typeof document === "undefined") return;
    if (!dlg) creerBoite();
    dessiner();
    if (!dlg.open) dlg.showModal();
    dlg.querySelector("input[name=email]")?.focus();
  }

  const ecrire = texte => { message = texte; if (dlg?.open) dessiner(); };
  const occupe = oui => dlg?.querySelectorAll("button:not(.btn-close), input").forEach(n => { n.disabled = oui; });

  // ------------------------------------------------------------------ actions

  async function demanderLien(email) {
    occupe(true);
    try {
      const r = await appel("/connexion.php", { method: "POST", body: JSON.stringify({ email: email.trim(), langue: langueDoc() }) });
      if (r.ok) {
        if (raison) memoriser(true);
        ecrire(t("compte.lienEnvoye", { email: email.trim() }));
      } else ecrire(t(r.status === 400 ? "compte.emailInvalide" : r.status === 429 ? "compte.tropDeDemandes" : "compte.erreur"));
    } catch { ecrire(t("compte.erreur")); }
    occupe(false);
  }

  async function acheter() {
    ecrire(t("compte.redirection"));
    occupe(true);
    try {
      const r = await appel("/achat.php", { method: "POST", body: JSON.stringify({ langue: langueDoc(), cgv: true }) });
      if (r.ok) { location.href = (await r.json()).url; return; }
      // une explication pour chaque refus
      if (r.status === 409) { await relire(); ecrire(t("compte.dejaPro")); }
      else if (r.status === 401) { await relire(); ecrire(t("compte.sessionExpiree")); }
      else if (r.status === 400) ecrire(t("compte.cocherCgv"));
      else ecrire(t("compte.erreurPaiement"));
    } catch { ecrire(t("compte.erreurPaiement")); }
    occupe(false);
  }

  async function enregistrerProfil(f) {
    const d = Object.fromEntries(new FormData(f).entries());
    try {
      const r = await appel("/profil.php", { method: "POST", body: JSON.stringify(d) });
      if (!r.ok) throw new Error();
      e = { ...e, profil: d };
      message = t("compte.enregistre");
    } catch { message = t("compte.erreur"); }
    dessiner();
  }

  /** Rétractation de l'achat Pro (14 jours) : remboursement intégral par Stripe, Pro retiré, e-mail de confirmation. */
  async function retracter() {
    if (!confirm(t("compte.retracterConfirmer"))) return;
    occupe(true);
    try {
      const r = await appel("/retractation.php", { method: "POST", body: JSON.stringify({ langue: langueDoc() }) });
      if (r.ok) { message = t("compte.retracte"); await relire(); }
      else ecrire(t(r.status === 409 ? "compte.retracterDelai" : r.status === 404 ? "compte.retracterAucun" : "compte.retracterErreur"));
    } catch { ecrire(t("compte.retracterErreur")); }
    occupe(false);
  }

  /** Suppression du compte : l'adresse retapée confirme ; lieux, informations et sessions sont effacés. */
  async function supprimer() {
    const saisie = prompt(t("compte.supprimerConfirmer", { email: e.email }));
    if (saisie === null) return;
    occupe(true);
    try {
      const r = await appel("/supprimer.php", { method: "POST", body: JSON.stringify({ email: saisie.trim() }) });
      if (r.ok) { message = t("compte.supprime"); changer({ connecte: false, email: null, pro: false }); }
      else ecrire(t(r.status === 400 ? "compte.supprimerErreur" : "compte.erreur"));
    } catch { ecrire(t("compte.erreur")); }
    occupe(false);
  }

  async function deconnecter() {
    occupe(true);
    try { await appel("/deconnexion.php", { method: "POST" }); } catch { /* le cookie expirera de lui-même */ }
    message = "";
    changer({ connecte: false, email: null, pro: false });
    occupe(false);
  }

  /** Fonction réservée aux comptes connectés : true si connecté, sinon ouvre la boîte de connexion avec la raison. */
  function exigerConnexion(texte = "") {
    if (e.connecte) return true;
    if (!disponible) return false;
    raison = texte;
    message = "";
    ouvrir();
    return false;
  }

  /**
   * À appeler avant une fonction pro. Renvoie true si le compte est pro ; sinon ouvre la boîte sur l'achat
   * (ou sur la connexion) avec la raison donnée, et renvoie false. Sans API joignable, renvoie false sans rien ouvrir.
   */
  function exigerPro(texte = "") {
    if (e.pro) return true;
    if (!disponible) return false;
    raison = texte;
    message = "";
    ouvrir();
    return false;
  }

  const etat = () => ({ ...e });
  const langueDoc = () => (typeof document !== "undefined" && document.documentElement.lang) || "fr";
  const memoriser = oui => { try { oui ? localStorage.setItem(CLE_INTENTION, "1") : localStorage.removeItem(CLE_INTENTION); } catch { /* stockage indisponible */ } };
  const intention = () => { try { return localStorage.getItem(CLE_INTENTION) === "1"; } catch { return false; } };

  // ------------------------------------------------------------------ retour du lien e-mail ou de Stripe

  async function demarrer() {
    let retour = null, achat = null;
    if (typeof location !== "undefined") {
      const u = new URL(location.href);
      retour = u.searchParams.get("compte");
      achat = u.searchParams.get("achat");
      if (retour || achat) {
        u.searchParams.delete("compte");
        u.searchParams.delete("achat");
        try { history.replaceState(history.state, "", u.pathname + u.search + u.hash); } catch { /* sans historique */ }
      }
    }
    await relire();
    if (!disponible) return etat();
    if (retour === "lien_expire" || retour === "lien_invalide") { message = t("compte.lienExpire"); ouvrir(); }
    else if (retour === "connecte" && intention()) { memoriser(false); ouvrir(); }
    if (achat === "ok") {
      memoriser(false);
      message = t("compte.confirmation");
      ouvrir();
      // le webhook peut arriver quelques secondes après le retour de Stripe (TWINT notamment)
      for (let i = 0; i < 15 && !e.pro; i++) {
        await new Promise(r => setTimeout(r, 2000));
        await relire();
      }
      ecrire(e.pro ? "" : t("compte.confirmationLente"));
    } else if (achat === "annule") { message = t("compte.annule"); ouvrir(); }
    return etat();
  }

  const pret = demarrer();

  return {
    monter, ouvrir, exigerPro, exigerConnexion, relire, etat, pret, appel,
    /** Ajoute une partie à la boîte d'un compte connecté : `f()` renvoie un élément (ou null). Redessine si ouverte. */
    ajouterSection: f => { sections.push(f); if (dlg?.open) dessiner(); },
    redessiner: () => { if (dlg?.open) dessiner(); },
    /** true si l'API répond (sinon le site reste en mode statique, sans compte). */
    disponible: () => disponible,
    addEventListener: bus.addEventListener.bind(bus),
    removeEventListener: bus.removeEventListener.bind(bus),
  };
}
