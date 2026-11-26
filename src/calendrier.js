// Petit calendrier sous le bouton du jour : remplace le sélecteur natif (qui ne se refermait pas toujours).
// Il se ferme dès qu'une date est choisie, au clic à côté, ou avec Échap. La date choisie est écrite dans le champ
// `champ` (input type=date, caché) et un évènement « change » y est envoyé : le reste du site n'a rien à changer.

export function brancherCalendrier(bouton, champ) {
  const boite = document.createElement("div");
  boite.className = "calendrier card shadow";
  boite.hidden = true;
  boite.setAttribute("role", "dialog");
  document.body.append(boite); // par-dessus tout : la colonne du panneau le rognait
  let mois = null; // premier jour du mois affiché (Date locale)

  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const lire = v => { const [a, m, j] = String(v || "").split("-").map(Number); return a ? new Date(a, m - 1, j) : new Date(); };

  function dessiner() {
    const langue = document.documentElement.lang || "fr", choisi = champ.value, auj = iso(new Date());
    const titre = new Intl.DateTimeFormat(langue, { month: "long", year: "numeric" }).format(mois);
    // jours de la semaine, lundi d'abord
    const noms = [...Array(7)].map((_, k) => new Intl.DateTimeFormat(langue, { weekday: "narrow" }).format(new Date(2024, 0, 1 + k)));
    const debut = (mois.getDay() + 6) % 7, nb = new Date(mois.getFullYear(), mois.getMonth() + 1, 0).getDate();
    let h = `<div class="cal-tete"><button type="button" data-pas="-1" aria-label="‹">‹</button><b>${titre}</b><button type="button" data-pas="1" aria-label="›">›</button></div><div class="cal-grille">`;
    h += noms.map(n => `<span class="cal-nom">${n}</span>`).join("");
    h += "<span></span>".repeat(debut);
    for (let j = 1; j <= nb; j++) {
      const d = iso(new Date(mois.getFullYear(), mois.getMonth(), j));
      h += `<button type="button" data-date="${d}" class="${d === choisi ? "choisi" : ""}${d === auj ? " auj" : ""}">${j}</button>`;
    }
    boite.innerHTML = h + "</div>";
  }
  const ouvrir = () => {
    const d = lire(champ.value); mois = new Date(d.getFullYear(), d.getMonth(), 1); dessiner(); boite.hidden = false;
    // sous le bouton, aligné à droite, toujours dans la fenêtre
    const r = bouton.getBoundingClientRect(), w = boite.offsetWidth, h = boite.offsetHeight;
    boite.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w))}px`;
    boite.style.top = `${r.bottom + h + 12 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  };
  const fermer = () => { boite.hidden = true; };

  bouton.addEventListener("click", e => { e.stopPropagation(); boite.hidden ? ouvrir() : fermer(); });
  boite.addEventListener("click", e => {
    e.stopPropagation();
    const pas = e.target.closest("[data-pas]")?.dataset.pas;
    if (pas) { mois = new Date(mois.getFullYear(), mois.getMonth() + +pas, 1); dessiner(); return; }
    const d = e.target.closest("[data-date]")?.dataset.date;
    if (d) { champ.value = d; champ.dispatchEvent(new Event("change", { bubbles: true })); fermer(); }
  });
  // clic à côté (n'importe où, la 3D comprise) ou Échap : fermé
  document.addEventListener("pointerdown", e => { if (!boite.hidden && !boite.contains(e.target) && !bouton.contains(e.target)) fermer(); }, true);
  document.addEventListener("keydown", e => { if (e.key === "Escape") fermer(); });
  return { ouvrir, fermer };
}
