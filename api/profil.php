<?php
// POST { prenom, nom, societe, adresse, npa, localite, pays, telephone } → 200 { ok } : informations du compte connecté.
// Champs facultatifs, texte libre court (servent aux factures et au contact).
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('POST');
$c = exiger_compte();
$d = corps();
$champs = ['prenom' => 80, 'nom' => 80, 'societe' => 120, 'adresse' => 160, 'npa' => 12, 'localite' => 80, 'pays' => 60, 'telephone' => 40];
$valeurs = [];
foreach ($champs as $k => $max) {
    $v = trim(preg_replace('/\s+/u', ' ', (string) ($d[$k] ?? '')));
    if (mb_strlen($v) > $max) json(400, ['erreur' => 'trop_long', 'champ' => $k]);
    $valeurs[$k] = $v === '' ? null : $v;
}
$q = bd()->prepare('UPDATE comptes SET prenom = ?, nom = ?, societe = ?, adresse = ?, npa = ?, localite = ?, pays = ?, telephone = ? WHERE id = ?');
$q->execute([...array_values($valeurs), $c['id']]);
json(200, ['ok' => true]);
