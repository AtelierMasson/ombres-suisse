<?php
// GET → 200 { email, pro, profil, retractation } si connecté (retractation : fin du délai de 14 jours, date ISO, ou null),
// sinon 401 { erreur: "non_connecte" }.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('GET');
$c = exiger_compte();
$q = bd()->prepare('SELECT prenom, nom, societe, adresse, npa, localite, pays, telephone FROM comptes WHERE id = ?');
$q->execute([$c['id']]);
$admins = array_map('strtolower', defined('ADMIN_EMAILS') ? ADMIN_EMAILS : []);
$profil = $q->fetch() ?: [];
// rétractation possible : dernier achat payé, non remboursé, dans les 14 jours
$a = bd()->prepare("SELECT COALESCE(paye_le, cree_le) FROM achats WHERE compte_id = ? AND etat = 'paye' AND payment_intent IS NOT NULL ORDER BY 1 DESC LIMIT 1");
$a->execute([$c['id']]);
$paye = $a->fetchColumn();
$fin = $paye ? strtotime($paye . ' UTC') + JOURS_RETRACTATION * 86400 : 0;
json(200, ['email' => $c['email'], 'pro' => (bool) $c['pro'], 'admin' => in_array(strtolower($c['email']), $admins, true), 'profil' => $profil,
    'retractation' => $fin > time() ? gmdate('c', $fin) : null]);
