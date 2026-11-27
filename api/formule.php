<?php
// POST { formule: "mois" | "annee" }, connecté → change la formule de l'abonnement en cours (CHF 9.– par mois ou
// CHF 84.– par an), sans prix à créer dans Stripe (price_data sur le même produit). Pendant l'essai, rien n'est
// débité ; ensuite, Stripe facture tout de suite la nouvelle période, avec un crédit pour le temps non utilisé.
// Réponse : 200 { ok }, 401 si déconnecté, 404 { erreur: "aucun_abonnement" }, 409 { erreur: "meme_formule" },
// 402 { erreur: "paiement" } (carte refusée : rien n'a changé), 502 si Stripe indisponible.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('POST');
$c = exiger_compte();
$annee = (corps()['formule'] ?? '') === 'annee';
$a = abonnement_du_compte((int) $c['id']);
if (!$a || !in_array($a['statut'], ['trialing', 'active', 'past_due'], true)) json(404, ['erreur' => 'aucun_abonnement']);
if (($a['intervalle'] === 'year') === $annee) json(409, ['erreur' => 'meme_formule']);

[$code, $s] = stripe('GET', 'subscriptions/' . rawurlencode($a['id']));
$el = $s['items']['data'][0] ?? null;
if ($code !== 200 || !$el) json(502, ['erreur' => 'stripe']);
$produit = $el['price']['product'] ?? '';
if (is_array($produit)) $produit = $produit['id'] ?? '';

[$code, $s] = stripe('POST', 'subscriptions/' . rawurlencode($a['id']), [
    'items' => [[
        'id' => $el['id'],
        'price_data' => [
            'currency' => DEVISE,
            'product' => (string) $produit,
            'unit_amount' => $annee ? PRIX_ANNEE_CENTIMES : PRIX_MOIS_CENTIMES,
            'recurring' => ['interval' => $annee ? 'year' : 'month'],
        ],
    ]],
    'proration_behavior' => 'always_invoice',
    // carte refusée : l'abonnement reste tel quel
    'payment_behavior' => 'error_if_incomplete',
]);
if ($code === 402) json(402, ['erreur' => 'paiement']);
if ($code !== 200 || !is_array($s)) json(502, ['erreur' => 'stripe']);
abonnement_enregistrer($s, time());
json(200, ['ok' => true]);
