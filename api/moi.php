<?php
// GET → 200 { email, pro } si connecté, sinon 401 { erreur: "non_connecte" }.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('GET');
$c = exiger_compte();
json(200, ['email' => $c['email'], 'pro' => (bool) $c['pro']]);
