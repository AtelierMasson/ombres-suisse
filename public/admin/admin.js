const $ = s => document.querySelector(s), api = "/api/admin.php";
const chf = c => `CHF ${(c / 100).toLocaleString("fr-CH", { minimumFractionDigits: 2 })}`;
const date = s => s ? new Date(s.replace(" ", "T") + "Z").toLocaleDateString("fr-CH", { day: "numeric", month: "short", year: "numeric" }) : "—";
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const NOMS = { lieu: "Lieux ouverts", heures: "Calculs d'ensoleillement", coupe: "Coupes", export: "Exports", import: "Imports de modèles", volume: "Volumes dessinés", projet: "Projets enregistrés", pro_ouvert: "Mode pro ouvert" };

/** Barres des 90 derniers jours (une série). */
function barres(lignes, cle, couleur) {
  const jours = [...Array(90)].map((_, k) => { const d = new Date(Date.now() - (89 - k) * 864e5); return d.toISOString().slice(0, 10); });
  const v = Object.fromEntries(lignes.map(l => [l.jour, +l[cle]])), max = Math.max(1, ...jours.map(j => v[j] || 0)), W = 900, H = 120;
  const b = jours.map((j, k) => { const h = (v[j] || 0) / max * (H - 16); return `<rect x="${k * W / 90 + 1}" y="${H - h}" width="${W / 90 - 2}" height="${h}" fill="${couleur}"><title>${j} : ${v[j] || 0}</title></rect>`; }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${b}</svg>`
    + `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--doux)"><span>il y a 90 jours</span><span>aujourd'hui · max ${max} par jour</span></div>`;
}

async function charger() {
  let r;
  try { r = await fetch(api, { credentials: "include" }); } catch { return message("L'API ne répond pas."); }
  if (r.status === 401) return message(`Connectez-vous d'abord sur <a href="/">topograph.ch</a> (bouton « Compte ») avec une adresse administrateur, puis revenez ici.`);
  if (r.status === 403) return message("Ce compte n'est pas administrateur (voir ADMIN_EMAILS dans api/config.php).");
  if (!r.ok) return message(`Erreur ${r.status} de l'API.`);
  afficher(await r.json());
}
function message(html) { $("#contenu").innerHTML = `<p class="message">${html}</p>`; }

function afficher(d) {
  const R = d.resume, usage = {};
  for (const u of d.usage) {
    const k = u.evenement, age = (Date.now() - Date.parse(u.jour)) / 864e5;
    usage[k] ||= { j7: 0, j30: 0, j90: 0 };
    usage[k].j90 += +u.n; if (age < 30) usage[k].j30 += +u.n; if (age < 7) usage[k].j7 += +u.n;
  }
  $("#maj").textContent = "mis à jour " + new Date().toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
  $("#contenu").innerHTML = `
  <div class="tuiles">
    <div class="tuile"><div class="lib">Comptes</div><div class="val">${R.comptes}</div></div>
    <div class="tuile"><div class="lib">Comptes Pro</div><div class="val">${R.pro}</div></div>
    <div class="tuile"><div class="lib">Inscrits (30 jours)</div><div class="val">${R.inscrits30}</div></div>
    <div class="tuile"><div class="lib">En essai</div><div class="val">${R.essais ?? 0}</div></div>
    <div class="tuile"><div class="lib">Abonnés payants</div><div class="val">${R.abonnes ?? 0}</div></div>
    <div class="tuile"><div class="lib">Dont annuels</div><div class="val">${R.annuels ?? 0}</div></div>
    <div class="tuile"><div class="lib">Résiliés (fin de période)</div><div class="val">${R.resilies ?? 0}</div></div>
    <div class="tuile"><div class="lib">Pro offerts</div><div class="val">${R.offerts ?? 0}</div></div>
    <div class="tuile"><div class="lib">Ventes uniques (ancien)</div><div class="val">${R.ventes}</div></div>
    <div class="tuile"><div class="lib">Chiffre d'affaires</div><div class="val">${chf(R.chiffre)}</div></div>
    <div class="tuile"><div class="lib">Chiffre (30 jours)</div><div class="val">${chf(R.chiffre30)}</div></div>
  </div>
  <section class="graphe"><h2>Inscriptions par jour</h2>${barres(d.inscriptions, "n", "var(--accent)")}</section>
  <section class="graphe"><h2>Ventes par jour</h2>${barres(d.ventesJour, "n", "var(--vert)")}</section>
  <section><h2>Utilisation (compteurs anonymes)</h2>
    <table><tr><th>Événement</th><th>7 jours</th><th>30 jours</th><th>90 jours</th></tr>
    ${Object.keys(NOMS).map(k => `<tr><td>${NOMS[k]}</td><td>${usage[k]?.j7 || 0}</td><td>${usage[k]?.j30 || 0}</td><td>${usage[k]?.j90 || 0}</td></tr>`).join("")}</table></section>
  <section><h2>Ventes</h2><div class="defile"><table><tr><th>Date</th><th>Compte</th><th>Montant</th><th>État</th><th>Référence Stripe</th></tr>
    ${d.ventes.map(v => `<tr><td>${date(v.cree_le)}</td><td>${esc(v.email)}</td><td>${chf(v.montant)}</td><td>${esc(v.etat)}</td><td style="font-size:11px;color:var(--doux)">${esc(v.id)}</td></tr>`).join("") || `<tr><td colspan="5" style="color:var(--doux)">Aucune vente pour l'instant.</td></tr>`}
  </table></div></section>
  <section><h2>Comptes</h2>
    <div class="ligne"><input id="filtre" type="search" placeholder="Filtrer (e-mail, nom, société, localité)" style="flex:1;min-width:180px">
      <input id="nouveauPro" type="email" placeholder="email@exemple.ch"><button id="offrir">Offrir le Pro</button></div>
    <div class="defile"><table id="comptes"><tr><th>E-mail</th><th>Nom</th><th>Société</th><th>Adresse</th><th>Téléphone</th><th>Pro offert</th><th>Abonnement</th><th>Inscrit le</th><th>Pro offert depuis</th><th></th></tr>
    ${d.comptes.map(c => `<tr data-email="${esc(c.email)}" data-texte="${esc([c.email, c.prenom, c.nom, c.societe, c.localite].join(" ").toLowerCase())}"><td>${esc(c.email)}</td><td>${esc([c.prenom, c.nom].filter(Boolean).join(" ")) || "—"}</td><td>${esc(c.societe) || "—"}</td>
      <td>${esc([c.adresse, [c.npa, c.localite].filter(Boolean).join(" "), c.pays].filter(Boolean).join(", ")) || "—"}</td><td>${esc(c.telephone) || "—"}</td>
      <td><span class="pastille ${+c.pro ? "pro" : ""}">${+c.pro ? "Pro" : "—"}</span></td><td>${esc(c.abonnement) || "—"}</td><td>${date(c.cree_le)}</td><td>${date(c.achete_le)}</td>
      <td><button data-pro="${+c.pro ? 0 : 1}">${+c.pro ? "Retirer le Pro" : "Offrir le Pro"}</button></td></tr>`).join("") || `<tr><td colspan="10" style="color:var(--doux)">Aucun compte pour l'instant.</td></tr>`}
    </table></div></section>
  <section><h2>Suggestions (${(d.suggestions || []).length})</h2><div class="defile"><table><tr><th>Date</th><th>Message</th><th>E-mail</th><th>Lieu</th><th>Langue</th></tr>
    ${(d.suggestions || []).map(x => `<tr><td>${esc((x.date || "").slice(0, 16).replace("T", " "))}</td><td style="white-space:pre-wrap">${esc(x.texte)}</td><td>${x.email ? `<a href="mailto:${esc(x.email)}">${esc(x.email)}</a>` : "—"}</td><td style="font-size:11px">${esc(x.lieu)}</td><td>${esc(x.langue)}</td></tr>`).join("") || `<tr><td colspan="5" style="color:var(--doux)">Aucune suggestion pour l'instant.</td></tr>`}
  </table></div></section>`;
  $("#filtre").oninput = e => { const q = e.target.value.toLowerCase(); document.querySelectorAll("#comptes tr[data-email]").forEach(tr => tr.hidden = !tr.dataset.texte.includes(q)); };
  $("#offrir").onclick = () => changerPro($("#nouveauPro").value, true);
  document.querySelectorAll("button[data-pro]").forEach(b => b.onclick = () => changerPro(b.closest("tr").dataset.email, b.dataset.pro === "1"));
}

async function changerPro(email, pro) {
  email = (email || "").trim();
  if (!email || !confirm(`${pro ? "Offrir" : "Retirer"} le statut Pro à ${email} ?`)) return;
  const r = await fetch(api, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "pro", email, pro }) });
  if (!r.ok) alert(`Échec (${r.status}).`);
  charger();
}
charger();
