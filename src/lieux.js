// Lieux enregistrés au compte (api/lieux.php) : bouton ☆ à côté de « Lien » (adresse et vue de la caméra), liste
// « Mes lieux » dans la boîte du compte. Sans compte : le bouton propose de se connecter.

/**
 * `compte` : brancherCompte() ; `bouton` : élément où cliquer ; `nomActuel()` : nom du lieu affiché ;
 * `lienActuel()` : fragment « #… » qui rouvre ce lieu avec la vue courante ; `t` : traductions.
 */
export function brancherLieux({ compte, bouton, nomActuel, lienActuel, t }) {
  let lieux = null; // null = pas encore lus

  async function lire() {
    if (!compte.etat().connecte) { lieux = null; return; }
    try {
      const r = await compte.appel("/lieux.php");
      lieux = r.ok ? (await r.json()).lieux : [];
    } catch { lieux = []; }
    compte.redessiner();
    majBouton();
  }
  // même lieu = même position (e, n) dans le fragment, quelle que soit la vue
  const cle = lien => { const h = new URLSearchParams(String(lien).replace(/^#/, "")); return `${h.get("e")}|${h.get("n")}`; };
  const dejaLa = () => lieux?.find(l => cle(l.lien) === cle(location.hash));

  function majBouton() {
    const l = dejaLa();
    bouton.textContent = l ? "★" : "☆";
    bouton.title = t(l ? "lieux.enregistre" : "lieux.enregistrer");
    bouton.classList.toggle("actif", !!l);
  }

  bouton.addEventListener("click", async () => {
    if (!compte.exigerConnexion(t("lieux.raison"))) return;
    if (lieux === null) await lire();
    const l = dejaLa();
    try {
      if (l) await compte.appel("/lieux.php", { method: "POST", body: JSON.stringify({ action: "supprimer", id: l.id }) });
      else await compte.appel("/lieux.php", { method: "POST", body: JSON.stringify({ action: "ajouter", nom: nomActuel(), lien: lienActuel() }) });
    } catch { /* réseau : la liste relue dira l'état réel */ }
    await lire();
  });

  // « Mes lieux » dans la boîte du compte
  compte.ajouterSection(() => {
    const det = document.createElement("details");
    det.className = "compte-lieux";
    det.open = true;
    const s = document.createElement("summary");
    s.textContent = t("lieux.titre") + (lieux?.length ? ` (${lieux.length})` : "");
    det.append(s);
    if (!lieux?.length) {
      const p = document.createElement("p");
      p.className = "compte-doux small mb-1";
      p.textContent = lieux === null ? "…" : t("lieux.vide");
      det.append(p);
      return det;
    }
    const ul = document.createElement("ul");
    for (const l of lieux) {
      const li = document.createElement("li"), a = document.createElement("a"), x = document.createElement("button");
      a.href = l.lien; a.textContent = l.nom;
      a.addEventListener("click", () => document.getElementById("compte")?.close());
      x.type = "button"; x.className = "btn-close btn-sm"; x.title = t("lieux.supprimer");
      x.setAttribute("aria-label", t("lieux.supprimer"));
      x.addEventListener("click", async () => {
        try { await compte.appel("/lieux.php", { method: "POST", body: JSON.stringify({ action: "supprimer", id: l.id }) }); } catch { /* relu ensuite */ }
        await lire();
      });
      li.append(a, x);
      ul.append(li);
    }
    det.append(ul);
    return det;
  });

  compte.addEventListener("compte", () => lire());
  addEventListener("hashchange", majBouton);
  // sans API des comptes (site statique, développement) : pas de bouton
  bouton.hidden = true;
  compte.pret.then(() => { bouton.hidden = !compte.disponible(); return lire(); });
  return { lire, majBouton };
}
