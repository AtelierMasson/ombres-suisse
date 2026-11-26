<?php
// POST → supprime la session courante et efface le cookie. Réponse : { ok: true }.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('POST');
$c = $_COOKIE[COOKIE_NOM] ?? '';
if (is_string($c) && preg_match('/^[0-9a-f]{64}$/', $c)) {
    bd()->prepare('DELETE FROM sessions WHERE id = ?')->execute([hache($c)]);
}
poser_cookie('', time() - 3600);
json(200, ['ok' => true]);
