// Compte : connexion par lien e-mail, statut Gratuit / Pro, abonnement Pro (CHF 9.– par mois ou 84.– par an, 7 jours
// d'essai) géré par Stripe (Checkout, portail client). Sans dépendance.
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
        // administrateur : le statut Pro peut être simulé (gratuit ou Pro) pour essayer l'application des deux côtés
        const simule = d.admin ? proSimule() : null;
        changer({ connecte: true, email: String(d.email || ""), pro: simule ?? !!d.pro, proReel: !!d.pro, admin: !!d.admin, profil: d.profil || {}, newsletter: !!d.newsletter,
          abonnement: d.abonnement || null, essaiPossible: d.essaiPossible !== false });
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
        acheter(dlg.querySelector("input[name=formule]:checked")?.value || "mois");
      }
      else if (a === "gerer") gerer();
      else if (a === "formule") changerFormule(ev.target.closest("[data-formule]").dataset.formule);
      else if (a === "basculerPro") basculerPro(ev.target.checked);
      else if (a === "newsletter") changerNewsletter(ev.target.checked);
      else if (a === "deconnecter") deconnecter();
      else if (a === "supprimer") supprimer();
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
      // newsletter : accord explicite, case décochée par défaut
      const nl = el("label", "form-check compte-newsletter");
      const caseNl = el("input", "form-check-input");
      Object.assign(caseNl, { type: "checkbox", name: "newsletter" });
      nl.append(caseNl, el("span", "form-check-label", t("compte.newsletterAccord")));
      f.append(champ, envoyer, nl);
      contenu.push(f);
    } else {
      const dl = el("dl", "compte-infos");
      dl.append(el("dt", null, t("compte.email")), el("dd", null, e.email),
        el("dt", null, t("compte.statut")), el("dd", e.pro ? "compte-statut-pro" : null, t(e.pro ? "compte.pro" : "compte.gratuit")));
      contenu.push(dl);
      const abo = aboVivant(e.abonnement);
      if (abo) contenu.push(blocAbonnement(abo));
      else if (e.pro) contenu.push(el("p", "compte-doux", t("compte.merci")));
      else contenu.push(blocOffre());
      for (const f of sections) { const n = f(); if (n) contenu.push(n); }
      // newsletter : accord ou retrait à tout moment
      {
        const b = el("div", "form-check form-switch compte-newsletter mt-2");
        const c = el("input", "form-check-input");
        Object.assign(c, { type: "checkbox", id: "compteNewsletter", checked: !!e.newsletter });
        c.dataset.action = "newsletter";
        const l = el("label", "form-check-label small", t("compte.newsletter"));
        l.htmlFor = "compteNewsletter";
        b.append(c, l);
        contenu.push(b);
      }
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
        // essai : voir l'application comme un compte gratuit ou comme un compte Pro
        const essai = el("div", "form-check form-switch compte-admin-pro mt-2");
        const c = el("input", "form-check-input");
        Object.assign(c, { type: "checkbox", id: "compteAdminPro", checked: !!e.pro });
        c.dataset.action = "basculerPro";
        const l = el("label", "form-check-label small", t("compte.adminPro"));
        l.htmlFor = "compteAdminPro";
        essai.append(c, l, el("div", "form-text", t("compte.adminProNote", { reel: t(e.proReel ? "compte.pro" : "compte.gratuit") })));
        contenu.push(essai);
        const a = el("a", "btn btn-sm btn-outline-secondary w-100 mt-2", t("compte.administration"));
        a.href = "/admin/";
        contenu.push(a);
      }
      contenu.push(bouton2("btn btn-link btn-sm compte-deconnexion", t("compte.deconnecter"), "deconnecter"));
      // « Gestion du compte » : un lien discret qui déplie la suppression
      const gestion = el("details", "compte-gestion");
      gestion.append(el("summary", null, t("compte.gestion")));
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

  // ------------------------------------------------------------------ abonnement

  const aboVivant = a => (a && ["trialing", "active", "past_due"].includes(a.statut) ? a : null);
  const chf = centimes => "CHF " + (centimes % 100 ? (centimes / 100).toFixed(2) : centimes / 100 + ".–");
  const jour = iso => new Date(iso).toLocaleDateString(langueDoc() + "-CH", { day: "numeric", month: "long", year: "numeric" });

  /** Offre Pro (compte gratuit) : deux formules, conditions, bouton d'essai, dans un même encadré bien visible. */
  function blocOffre() {
    const offre = el("div", "compte-offre");
    offre.append(el("div", "compte-offre-titre", "Topograph Pro"), el("p", "compte-offre-texte", t("compte.avantages")));
    const choix = el("div", "compte-formules");
    for (const [v, titre, prix] of [["mois", "compte.offreMois", "compte.offreMoisPrix"], ["annee", "compte.offreAnnee", "compte.offreAnneePrix"]]) {
      const l = el("label", "compte-formule");
      const r = el("input");
      Object.assign(r, { type: "radio", name: "formule", value: v, checked: v === "mois" });
      l.append(r, " ", el("b", null, t(titre)), el("span", null, t(prix)));
      choix.append(l);
    }
    // conditions de vente : case obligatoire avant le paiement (abonnement, renouvellement automatique)
    const accord = el("label", "compte-cgv");
    const case_ = el("input"); case_.type = "checkbox"; case_.name = "cgv";
    accord.append(case_, " ", el("span", null, t("compte.accepteCgv")));
    // bouton toujours actif : sans la case, il dit ce qui manque (au lieu d'un bouton grisé sans explication)
    const essai = e.essaiPossible !== false;
    const acheter = bouton2("btn btn-primary w-100", t(essai ? "compte.essayer" : "compte.sAbonner"), "acheter");
    const manque = el("p", "compte-manque", t("compte.cocherCgv"));
    manque.hidden = true; manque.setAttribute("role", "alert");
    case_.addEventListener("change", () => { if (case_.checked) { manque.hidden = true; accord.classList.remove("compte-cgv-manque"); } });
    const note = el("p", "compte-note", t(essai ? "compte.paiement" : "compte.paiementSansEssai") + " ");
    const cgv = el("a", null, t("compte.conditions"));
    cgv.href = "#";
    cgv.dataset.legal = "conditions";
    note.append(cgv);
    offre.append(choix, accord, manque, acheter, note);
    return offre;
  }

  /** Abonnement en cours : formule, état (essai, renouvellement, résiliation, impayé), gestion par le portail Stripe. */
  function blocAbonnement(a) {
    const annee = a.intervalle === "year";
    const montant = a.montant ?? (annee ? 8400 : 900);
    const bloc = el("div", "compte-abonnement");
    bloc.append(el("div", "compte-offre-titre", t(annee ? "compte.aboAnnee" : "compte.aboMois", { prix: chf(montant) })));
    let etat;
    if (a.impaye) etat = el("p", "compte-abo-etat compte-abo-impaye", t("compte.aboImpaye"));
    else if (a.resilie && (a.periodeFin || a.essaiFin)) etat = el("p", "compte-abo-etat", t("compte.aboResilie", { date: jour(a.statut === "trialing" ? a.essaiFin || a.periodeFin : a.periodeFin) }));
    else if (a.statut === "trialing" && a.essaiFin) etat = el("p", "compte-abo-etat", t("compte.aboEssai", { date: jour(a.essaiFin) }));
    else if (a.periodeFin) etat = el("p", "compte-abo-etat", t("compte.aboActif", { date: jour(a.periodeFin) }));
    if (etat) bloc.append(etat);
    bloc.append(bouton2("btn btn-primary w-100", t("compte.gerer"), "gerer"), el("p", "compte-note", t("compte.gererNote")));
    if (!a.resilie) {
      const autre = bouton2("btn btn-link btn-sm compte-formule-changer", t(annee ? "compte.passerMois" : "compte.passerAnnee"), "formule");
      autre.dataset.formule = annee ? "mois" : "annee";
      bloc.append(autre);
    }
    return bloc;
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

  async function changerNewsletter(accord) {
    try {
      const r = await appel("/newsletter.php", { method: "POST", body: JSON.stringify({ accord, langue: langueDoc() }) });
      const d = await r.json();
      e = { ...e, newsletter: !!d.accord };
      ecrire(t(d.accord ? "compte.newsletterOui" : "compte.newsletterNon"));
    } catch { ecrire(t("compte.erreur")); }
  }

  async function demanderLien(email) {
    occupe(true);
    try {
      const nl = !!dlg?.querySelector("input[name=newsletter]")?.checked;
      const r = await appel("/connexion.php", { method: "POST", body: JSON.stringify({ email: email.trim(), langue: langueDoc(), newsletter: nl }) });
      if (r.ok) {
        if (raison) memoriser(true);
        ecrire(t("compte.lienEnvoye", { email: email.trim() }));
      } else ecrire(t(r.status === 400 ? "compte.emailInvalide" : r.status === 429 ? "compte.tropDeDemandes" : "compte.erreur"));
    } catch { ecrire(t("compte.erreur")); }
    occupe(false);
  }

  async function acheter(formule = "mois") {
    ecrire(t("compte.redirection"));
    occupe(true);
    try {
      const r = await appel("/achat.php", { method: "POST", body: JSON.stringify({ langue: langueDoc(), cgv: true, formule }) });
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

  /** Portail client Stripe : carte, factures, résiliation. Retour sur le site avec ?compte=abonnement. */
  async function gerer() {
    ecrire(t("compte.redirection"));
    occupe(true);
    try {
      const r = await appel("/portail.php", { method: "POST", body: JSON.stringify({ langue: langueDoc() }) });
      if (r.ok) { location.href = (await r.json()).url; return; }
      if (r.status === 401) { await relire(); ecrire(t("compte.sessionExpiree")); }
      else ecrire(t("compte.portailErreur"));
    } catch { ecrire(t("compte.portailErreur")); }
    occupe(false);
  }

  /** Passage mensuel ↔ annuel (formule.php) : rien n'est débité pendant l'essai, sinon facturation tout de suite avec crédit. */
  async function changerFormule(formule) {
    if (!confirm(t("compte.formuleConfirmer"))) return;
    occupe(true);
    try {
      const r = await appel("/formule.php", { method: "POST", body: JSON.stringify({ formule }) });
      if (r.ok || r.status === 409) { message = t("compte.formuleChangee"); await relire(); }
      else if (r.status === 401) { await relire(); ecrire(t("compte.sessionExpiree")); }
      else ecrire(t("compte.formuleErreur"));
    } catch { ecrire(t("compte.formuleErreur")); }
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
  /** Pro actif : seulement sur un compte que l'API confirme Pro. Une API absente ou bloquée laisse le visiteur en gratuit,
   *  sauf en développement (serveur Vite sans PHP), où tout reste ouvert pour travailler. */
  const proActif = () => !!e.pro || (!disponible && !!import.meta.env?.DEV);

  function exigerPro(texte = "") {
    if (proActif()) return true;
    if (!disponible) return false;
    raison = texte;
    message = "";
    ouvrir();
    return false;
  }

  const etat = () => ({ ...e });
  // bascule de test des administrateurs : "1" Pro, "0" gratuit, absent = statut réel
  const CLE_SIMUL = "ombres.admin.pro";
  const proSimule = () => { try { const v = localStorage.getItem(CLE_SIMUL); return v === "1" ? true : v === "0" ? false : null; } catch { return null; } };
  function basculerPro(oui) {
    if (!e.admin) return;
    try { localStorage.setItem(CLE_SIMUL, oui ? "1" : "0"); } catch { /* stockage indisponible */ }
    changer({ ...e, pro: oui });
  }
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
    else if (retour === "abonnement") ouvrir(); // retour du portail Stripe ou lien d'un e-mail d'abonnement
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
    monter, ouvrir, exigerPro, exigerConnexion, relire, etat, pret, appel, proActif,
    /** Ajoute une partie à la boîte d'un compte connecté : `f()` renvoie un élément (ou null). Redessine si ouverte. */
    ajouterSection: f => { sections.push(f); if (dlg?.open) dessiner(); },
    redessiner: () => { if (dlg?.open) dessiner(); },
    /** true si l'API répond (sinon le site reste en mode statique, sans compte). */
    disponible: () => disponible,
    addEventListener: bus.addEventListener.bind(bus),
    removeEventListener: bus.removeEventListener.bind(bus),
  };
}
