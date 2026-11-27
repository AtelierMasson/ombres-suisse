<?php
// Newsletter du compte connecté. GET → { accord } ; POST { accord: true|false } → enregistre la décision (registre).
declare(strict_types=1);
require __DIR__ . '/_commun.php';

$m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
entree($m === 'POST' ? 'POST' : 'GET');
$c = exiger_compte();
if ($m === 'POST') {
    $d = corps();
    newsletter_noter($c['email'], !empty($d['accord']), 'compte', langue($d['langue'] ?? null));
}
json(200, ['accord' => newsletter_accord($c['email'])]);
