<?php
// POST { type } → 204. Compteur d'usage anonyme (jour × événement), pour le tableau d'administration.
// Aucune donnée personnelle : ni adresse, ni lieu, ni compte ; seulement un total par jour.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

const EVENEMENTS = ['lieu', 'heures', 'coupe', 'export', 'import', 'volume', 'projet', 'pro_ouvert'];

entree('POST');
$type = (string) (corps()['type'] ?? ($_GET['type'] ?? ''));
if (!in_array($type, EVENEMENTS, true)) json(400, ['erreur' => 'type']);
bd()->prepare('INSERT INTO compteurs (jour, evenement, n) VALUES (UTC_DATE(), ?, 1) ON DUPLICATE KEY UPDATE n = n + 1')
    ->execute([$type]);
http_response_code(204);
