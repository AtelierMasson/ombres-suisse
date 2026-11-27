<?php
// GET → 200 { email, pro, proOffert, admin, profil, abonnement, essaiPossible } si connecté, sinon 401 { erreur: "non_connecte" }.
// abonnement : dernier abonnement du compte { statut, intervalle: "month"|"year", montant, periodeFin, essaiFin,
// resilie, impaye } (dates ISO) ou null ; essaiPossible : le compte n'a jamais été abonné (7 jours gratuits).
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('GET');
$c = exiger_compte();
$q = bd()->prepare('SELECT prenom, nom, societe, adresse, npa, localite, pays, telephone FROM comptes WHERE id = ?');
$q->execute([$c['id']]);
$admins = array_map('strtolower', defined('ADMIN_EMAILS') ? ADMIN_EMAILS : []);
$profil = $q->fetch() ?: [];
try {
    $a = abonnement_du_compte((int) $c['id']);
} catch (PDOException $e) {
    $a = null; // migration de l'abonnement pas encore appliquée
}
$iso = fn($d) => $d ? gmdate('c', strtotime($d . ' UTC')) : null;
json(200, [
    'email' => $c['email'],
    'pro' => (bool) $c['pro'],
    'proOffert' => (int) $c['pro_offert'] === 1,
    'admin' => in_array(strtolower($c['email']), $admins, true),
    'profil' => $profil,
    'newsletter' => newsletter_accord($c['email']),
    'abonnement' => $a ? [
        'statut' => $a['statut'],
        'intervalle' => $a['intervalle'],
        'montant' => $a['montant'] !== null ? (int) $a['montant'] : null,
        'periodeFin' => $iso($a['periode_fin']),
        'essaiFin' => $iso($a['essai_fin']),
        'resilie' => (bool) $a['resilie'],
        'impaye' => $a['statut'] === 'past_due' || $a['impaye_depuis'] !== null,
    ] : null,
    'essaiPossible' => $a === null,
]);
