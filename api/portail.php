<?php
// POST { langue? }, connecté → session du portail client Stripe (carte, factures, résiliation) pour le client Stripe
// du compte. Réponse : 200 { url }, 401 si déconnecté, 404 { erreur: "aucun_abonnement" }, 502 si Stripe indisponible.
// Le portail se règle dans Stripe : Paramètres → Facturation → Portail client.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('POST');
$c = exiger_compte();
if (empty($c['stripe_customer'])) json(404, ['erreur' => 'aucun_abonnement']);
$l = langue(corps()['langue'] ?? null);
[$code, $s] = stripe('POST', 'billing_portal/sessions', [
    'customer' => $c['stripe_customer'],
    'locale' => $l,
    'return_url' => SITE_URL . '/?' . http_build_query(['compte' => 'abonnement', 'lang' => $l]),
]);
if ($code !== 200 || empty($s['url'])) json(502, ['erreur' => 'portail_indisponible']);
json(200, ['url' => $s['url']]);
