<?php
// GET → 200 { email, pro, profil } si connecté, sinon 401 { erreur: "non_connecte" }.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('GET');
$c = exiger_compte();
$q = bd()->prepare('SELECT prenom, nom, societe, adresse, npa, localite, pays, telephone FROM comptes WHERE id = ?');
$q->execute([$c['id']]);
$admins = array_map('strtolower', defined('ADMIN_EMAILS') ? ADMIN_EMAILS : []);
json(200, ['email' => $c['email'], 'pro' => (bool) $c['pro'], 'admin' => in_array(strtolower($c['email']), $admins, true), 'profil' => $q->fetch() ?: []]);
