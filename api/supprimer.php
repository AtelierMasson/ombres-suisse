<?php
// POST { email } (connecté ; l'adresse retapée confirme) → supprime le compte : sessions, lieux, informations.
// Un abonnement en cours est d'abord arrêté chez Stripe (plus aucun débit). S'il y a eu un achat ou un abonnement, la
// ligne du compte est gardée mais anonymisée (pièce comptable, 10 ans), sans e-mail ni profil.
// Réponse : 200 { ok }, 400 { erreur: "confirmation" }, 502 { erreur: "abonnement" } (Stripe indisponible : rien supprimé).
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('POST');
$c = exiger_compte();
$d = corps();
if (strtolower(trim((string) ($d['email'] ?? ''))) !== strtolower($c['email'])) json(400, ['erreur' => 'confirmation']);

$bd = bd();
// abonnements encore vivants : arrêtés tout de suite, sans quoi la carte continuerait d'être débitée
$q = $bd->prepare("SELECT id FROM abonnements WHERE compte_id = ? AND statut NOT IN ('canceled', 'incomplete_expired')");
$q->execute([$c['id']]);
foreach ($q->fetchAll(PDO::FETCH_COLUMN) as $sub) {
    [$code, $r] = stripe('DELETE', 'subscriptions/' . rawurlencode($sub));
    if ($code === 200 && is_array($r)) abonnement_enregistrer($r, time());
    elseif (($r['error']['code'] ?? '') !== 'resource_missing') json(502, ['erreur' => 'abonnement']);
}
$bd->beginTransaction();
$bd->prepare('DELETE FROM lieux WHERE compte_id = ?')->execute([$c['id']]);
$bd->prepare('DELETE FROM sessions WHERE compte_id = ?')->execute([$c['id']]);
$n = $bd->prepare('SELECT (SELECT COUNT(*) FROM achats WHERE compte_id = ?) + (SELECT COUNT(*) FROM abonnements WHERE compte_id = ?)');
$n->execute([$c['id'], $c['id']]);
if ((int) $n->fetchColumn() > 0) {
    // achats, abonnements : la comptabilité garde montant et date ; le compte devient anonyme (adresse remplacée, profil vidé)
    $bd->prepare('UPDATE comptes SET email = ?, prenom = NULL, nom = NULL, societe = NULL, adresse = NULL, npa = NULL,
                  localite = NULL, pays = NULL, telephone = NULL WHERE id = ?')
        ->execute(['supprime-' . $c['id'] . '@invalid', $c['id']]);
} else {
    $bd->prepare('DELETE FROM comptes WHERE id = ?')->execute([$c['id']]);
}
$bd->commit();
poser_cookie('', time() - 3600);
json(200, ['ok' => true]);
