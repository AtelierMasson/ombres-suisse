// Boîte à suggestions dans la barre du haut : un bouton, un petit panneau (message, e-mail facultatif), envoi à
// /api/suggestion.php. En local (pas de PHP), l'envoi échoue proprement avec un message.
import { t, langue } from "./i18n.js";

export function brancherSuggestion() {
  const bouton = document.getElementById("btnSuggestion"), panneau = document.getElementById("suggestion");
  const texte = document.getElementById("suggestionTexte"), email = document.getElementById("suggestionEmail");
  const piege = document.getElementById("suggestionPiege"), etat = document.getElementById("suggestionEtat"), envoyer = document.getElementById("suggestionEnvoyer");
  const ouvrir = oui => {
    panneau.hidden = !oui;
    bouton.setAttribute("aria-expanded", String(oui));
    if (oui) { etat.textContent = ""; texte.focus(); }
  };
  bouton.addEventListener("click", () => ouvrir(panneau.hidden));
  document.getElementById("suggestionFermer").addEventListener("click", () => ouvrir(false));
  addEventListener("keydown", e => { if (e.key === "Escape" && !panneau.hidden) ouvrir(false); });
  addEventListener("pointerdown", e => { if (!panneau.hidden && !panneau.contains(e.target) && !bouton.contains(e.target)) ouvrir(false); });
  panneau.addEventListener("submit", async e => {
    e.preventDefault();
    if (!texte.value.trim()) return texte.focus();
    envoyer.disabled = true; etat.textContent = t("suggestion.envoi");
    try {
      const r = await fetch("/api/suggestion.php", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texte: texte.value.trim(), email: email.value.trim(), piege: piege.value, lieu: decodeURIComponent(location.hash.slice(1)), langue }),
      });
      if (r.status === 429) throw new Error(t("suggestion.trop"));
      if (!r.ok) throw new Error(t("suggestion.echec"));
      texte.value = ""; etat.textContent = t("suggestion.merci");
      setTimeout(() => ouvrir(false), 1800);
    } catch (err) {
      etat.textContent = err.message || t("suggestion.echec");
    } finally { envoyer.disabled = false; }
  });
}
