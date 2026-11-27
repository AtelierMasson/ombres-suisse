<?php
// POST { langue?, cgv, formule: "mois" | "annee" }, connecté → session Stripe Checkout d'abonnement à Topograph Pro :
// CHF 9.– par mois ou CHF 84.– par an, 7 jours d'essai gratuit (un seul essai par compte), carte demandée dès
// l'inscription pour que l'abonnement démarre seul à la fin de l'essai. Prix définis ici (price_data) : rien à créer
// dans Stripe. Réponse : 200 { url } (page Stripe), 401 si déconnecté, 409 { erreur: "deja_pro" }.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('POST');
$c = exiger_compte();
if ((int) $c['pro'] === 1) json(409, ['erreur' => 'deja_pro']);
$d = corps();
$l = langue($d['langue'] ?? null);
// conditions de vente acceptées (abonnement, renouvellement automatique, résiliation, essai)
if (empty($d['cgv'])) json(400, ['erreur' => 'conditions']);
$annee = ($d['formule'] ?? 'mois') === 'annee';
$retour = fn(string $etat) => SITE_URL . '/?' . http_build_query(['achat' => $etat, 'lang' => $l]);

// essai gratuit : seulement pour un compte qui n'a jamais été abonné
$deja = bd()->prepare('SELECT COUNT(*) FROM abonnements WHERE compte_id = ?');
$deja->execute([$c['id']]);
$essai = (int) $deja->fetchColumn() === 0;

$meta = ['compte_id' => (string) $c['id'], 'cgv' => VERSION_CGV, 'langue' => $l];
$abonnement = ['metadata' => $meta];
if ($essai) {
    $abonnement['trial_period_days'] = JOURS_ESSAI;
    // sans moyen de paiement valable à la fin de l'essai : l'abonnement s'arrête, rien n'est dû
    $abonnement['trial_settings'] = ['end_behavior' => ['missing_payment_method' => 'cancel']];
}

$params = [
    'mode' => 'subscription',
    // API Stripe 2026-09-30 : allowed_payment_method_types. TWINT ne permet pas les paiements récurrents : carte seulement
    'allowed_payment_method_types' => ['card'],
    // carte demandée même pendant l'essai : l'abonnement démarre seul au bout de 7 jours
    'payment_method_collection' => 'always',
    'line_items' => [[
        'quantity' => 1,
        'price_data' => [
            'currency' => DEVISE,
            'unit_amount' => $annee ? PRIX_ANNEE_CENTIMES : PRIX_MOIS_CENTIMES,
            'recurring' => ['interval' => $annee ? 'year' : 'month'],
            'product_data' => ['name' => NOM_ABONNEMENT],
        ],
    ]],
    'subscription_data' => $abonnement,
    'client_reference_id' => (string) $c['id'],
    'metadata' => $meta,
    'locale' => $l,
    'success_url' => $retour('ok'),
    'cancel_url' => $retour('annule'),
];
// client Stripe déjà connu (ancien abonnement) : on le reprend, sinon Stripe le crée avec l'adresse du compte
if (!empty($c['stripe_customer'])) $params['customer'] = $c['stripe_customer'];
else $params['customer_email'] = $c['email'];

[$code, $s] = stripe('POST', 'checkout/sessions', $params);
if ($code !== 200 || !is_array($s) || empty($s['url'])) json(502, ['erreur' => 'paiement_indisponible']);
json(200, ['url' => $s['url']]);
