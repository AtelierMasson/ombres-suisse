<?php
// POST { langue? }, connecté → crée une session Stripe Checkout (paiement unique CHF 39.–, carte et TWINT).
// Réponse : 200 { url } (page de paiement Stripe), 401 si déconnecté, 409 { erreur: "deja_pro" }.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('POST');
$c = exiger_compte();
if ((int) $c['pro'] === 1) json(409, ['erreur' => 'deja_pro']);
$d = corps();
$l = langue($d['langue'] ?? null);
// conditions de vente acceptées et accès immédiat demandé (rétractation possible 14 jours, remboursement intégral)
if (empty($d['cgv'])) json(400, ['erreur' => 'conditions']);
$versionCgv = '2026-11-27-r14';
$retour = fn(string $etat) => SITE_URL . '/?' . http_build_query(['achat' => $etat, 'lang' => $l]);

$params = [
    'mode' => 'payment',
    'payment_method_types' => ['card', 'twint'],
    'line_items' => [[
        'quantity' => 1,
        'price_data' => [
            'currency' => DEVISE,
            'unit_amount' => PRIX_CENTIMES,
            'product_data' => ['name' => NOM_PRODUIT],
        ],
    ]],
    'client_reference_id' => (string) $c['id'],
    'customer_email' => $c['email'],
    'payment_intent_data' => ['receipt_email' => $c['email']],
    'metadata' => ['compte_id' => (string) $c['id'], 'cgv' => $versionCgv],
    'locale' => $l,
    'success_url' => $retour('ok'),
    'cancel_url' => $retour('annule'),
];

$ch = curl_init('https://api.stripe.com/v1/checkout/sessions');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => http_build_query($params),
    CURLOPT_USERPWD => STRIPE_CLE_SECRETE . ':',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 20,
]);
$rep = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$s = is_string($rep) ? json_decode($rep, true) : null;
if ($code !== 200 || !is_array($s) || empty($s['url'])) {
    error_log('Stripe Checkout : ' . $code . ' ' . (is_string($rep) ? $rep : curl_error($ch)));
    json(502, ['erreur' => 'paiement_indisponible']);
}

bd()->prepare('INSERT INTO achats (id, compte_id, montant, devise, etat, cgv_version, cgv_le) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())')
    ->execute([$s['id'], $c['id'], PRIX_CENTIMES, DEVISE, 'ouvert', $versionCgv]);

json(200, ['url' => $s['url']]);
