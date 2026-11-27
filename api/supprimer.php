<?php
// POST { email } (connecté ; l'adresse retapée confirme) → supprime le compte : sessions, lieux, informations.
// S'il y a eu un achat, la ligne du compte est gardée mais anonymisée (pièce comptable, 10 ans), sans e-mail ni profil.
// Réponse : 200 { ok }, 400 { erreur: "confirmation" }.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('POST');
$c = exiger_compte();
$d = corps();
if (strtolower(trim((string) ($d['email'] ?? ''))) !== strtolower($c['email'])) json(400, ['erreur' => 'confirmation']);

$bd = bd();
$bd->beginTransaction();
$bd->prepare('DELETE FROM lieux WHERE compte_id = ?')->execute([$c['id']]);
$bd->prepare('DELETE FROM sessions WHERE compte_id = ?')->execute([$c['id']]);
$n = $bd->prepare('SELECT COUNT(*) FROM achats WHERE compte_id = ?');
$n->execute([$c['id']]);
if ((int) $n->fetchColumn() > 0) {
    // achats : la comptabilité garde montant et date ; le compte devient anonyme (adresse remplacée, profil vidé)
    $bd->prepare('UPDATE comptes SET email = ?, prenom = NULL, nom = NULL, societe = NULL, adresse = NULL, npa = NULL,
                  localite = NULL, pays = NULL, telephone = NULL WHERE id = ?')
        ->execute(['supprime-' . $c['id'] . '@invalid', $c['id']]);
} else {
    $bd->prepare('DELETE FROM comptes WHERE id = ?')->execute([$c['id']]);
}
$bd->commit();
poser_cookie('', time() - 3600);
json(200, ['ok' => true]);
