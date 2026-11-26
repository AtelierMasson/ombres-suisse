<?php
// Lieux enregistrés du compte connecté.
//   GET                                   → 200 { lieux: [{ id, nom, lien, cree_le }] } (les plus récents d'abord)
//   POST { action: "ajouter", nom, lien } → 200 { id }   (200 lieux au plus par compte)
//   POST { action: "supprimer", id }      → 200 { ok }
declare(strict_types=1);
require __DIR__ . '/_commun.php';

$methode = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST' ? 'POST' : 'GET';
entree($methode);
$c = exiger_compte();
$bd = bd();
if ($methode === 'GET') {
    $q = $bd->prepare('SELECT id, nom, lien, cree_le FROM lieux WHERE compte_id = ? ORDER BY cree_le DESC, id DESC LIMIT 200');
    $q->execute([$c['id']]);
    json(200, ['lieux' => $q->fetchAll()]);
}
$d = corps();
$action = (string) ($d['action'] ?? '');
if ($action === 'ajouter') {
    $nom = trim(preg_replace('/\s+/u', ' ', (string) ($d['nom'] ?? '')));
    $lien = trim((string) ($d['lien'] ?? ''));
    // lien : seulement le fragment de l'adresse du site (#e=…&n=…), jamais une adresse extérieure
    if ($nom === '' || mb_strlen($nom) > 160 || !preg_match('/^#[A-Za-z0-9_.,~%=&+\-]{3,999}$/', $lien)) json(400, ['erreur' => 'invalide']);
    $n = $bd->prepare('SELECT COUNT(*) FROM lieux WHERE compte_id = ?');
    $n->execute([$c['id']]);
    if ((int) $n->fetchColumn() >= 200) json(409, ['erreur' => 'trop']);
    $bd->prepare('INSERT INTO lieux (compte_id, nom, lien) VALUES (?, ?, ?)')->execute([$c['id'], $nom, $lien]);
    json(200, ['id' => (int) $bd->lastInsertId()]);
}
if ($action === 'supprimer') {
    $bd->prepare('DELETE FROM lieux WHERE id = ? AND compte_id = ?')->execute([(int) ($d['id'] ?? 0), $c['id']]);
    json(200, ['ok' => true]);
}
json(400, ['erreur' => 'action']);
