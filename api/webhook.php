<?php
// Webhook Stripe de l'abonnement Topograph Pro. Vérifie la signature (Stripe-Signature, HMAC SHA-256), puis :
//   checkout.session.completed (abonnement)            → lit l'abonnement et l'enregistre (Pro dès le retour de Stripe)
//   customer.subscription.created / updated / deleted  → état de l'abonnement (essai, actif, impayé, résilié, terminé)
//   customer.subscription.trial_will_end               → e-mail de rappel 3 jours avant la fin de l'essai
//   invoice.paid / invoice.payment_failed              → impayé levé, ou noté avec un e-mail (carte à mettre à jour)
// Le statut Pro se déduit de la table abonnements (SQL_PRO_ABONNEMENT). Idempotent : un événement rejoué ou plus
// ancien que l'état connu ne change rien, chaque e-mail part une seule fois.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

const TOLERANCE = 300; // secondes

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') json(405, ['erreur' => 'methode']);
$brut = (string) file_get_contents('php://input');

/** Vérifie l'en-tête « t=…,v1=…[,v1=…] » selon la méthode documentée par Stripe. */
function signature_valide(string $brut, string $entete, string $secret): bool
{
    $t = null;
    $v1 = [];
    foreach (explode(',', $entete) as $partie) {
        [$k, $v] = array_pad(explode('=', trim($partie), 2), 2, '');
        if ($k === 't' && ctype_digit($v)) $t = (int) $v;
        elseif ($k === 'v1') $v1[] = $v;
    }
    if ($t === null || !$v1 || abs(time() - $t) > TOLERANCE) return false;
    $attendu = hash_hmac('sha256', $t . '.' . $brut, $secret);
    foreach ($v1 as $sig) if (hash_equals($attendu, $sig)) return true;
    return false;
}

if (STRIPE_SECRET_WEBHOOK === '' || !signature_valide($brut, $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '', STRIPE_SECRET_WEBHOOK)) {
    json(400, ['erreur' => 'signature']);
}

/** Lit l'abonnement chez Stripe (état à jour) et l'enregistre ; 500 si Stripe ne répond pas (l'événement sera rejoué). */
function relire_abonnement(string $id): ?array
{
    if (!str_starts_with($id, 'sub_')) return null;
    [$code, $s] = stripe('GET', 'subscriptions/' . rawurlencode($id));
    if ($code !== 200 || !is_array($s)) json(500, ['erreur' => 'stripe']);
    abonnement_enregistrer($s, time());
    return ligne($id);
}

function ligne(string $id): ?array
{
    $q = bd()->prepare('SELECT * FROM abonnements WHERE id = ?');
    $q->execute([$id]);
    return $q->fetch() ?: null;
}

/** Pose une date « une seule fois » (bienvenue_le, rappel_essai_le, impaye_depuis) ; true si c'est la première fois. */
function premiere_fois(string $id, string $colonne, string $condition = '1'): bool
{
    $q = bd()->prepare("UPDATE abonnements SET $colonne = UTC_TIMESTAMP() WHERE id = ? AND $colonne IS NULL AND $condition");
    $q->execute([$id]);
    return $q->rowCount() === 1;
}

/** E-mail de bienvenue (essai commencé, ou abonnement actif sans essai), une fois par abonnement. */
function bienvenue(?array $a): void
{
    if ($a && premiere_fois($a['id'], 'bienvenue_le', "statut IN ('trialing', 'active')")) {
        email_abonnement($a['statut'] === 'trialing' ? 'bienvenue' : 'actif', $a);
    }
}

$ev = json_decode($brut, true);
$type = (string) ($ev['type'] ?? '');
$o = $ev['data']['object'] ?? [];
$quand = (int) ($ev['created'] ?? time());
// abonnement d'une facture : API récente (parent.subscription_details) ou ancienne (subscription)
$abonnementFacture = fn(array $f) => (string) ($f['parent']['subscription_details']['subscription'] ?? $f['subscription'] ?? '');

switch ($type) {
    case 'checkout.session.completed':
        if (($o['mode'] ?? '') !== 'subscription') json(200, ['ignore' => 'mode']);
        $sub = is_array($o['subscription'] ?? null) ? (string) ($o['subscription']['id'] ?? '') : (string) ($o['subscription'] ?? '');
        bienvenue(relire_abonnement($sub));
        break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
        if (abonnement_enregistrer($o, $quand) === null) json(200, ['ignore' => 'sans_compte']);
        bienvenue(ligne((string) $o['id']));
        break;

    case 'customer.subscription.trial_will_end':
        abonnement_enregistrer($o, $quand);
        $a = ligne((string) ($o['id'] ?? ''));
        // pas de rappel si l'abonnement est déjà résilié : rien ne sera débité
        if ($a && premiere_fois($a['id'], 'rappel_essai_le', "statut = 'trialing' AND resilie = 0")) email_abonnement('rappel', $a);
        break;

    case 'invoice.paid':
        $a = relire_abonnement($abonnementFacture($o));
        bienvenue($a);
        break;

    case 'invoice.payment_failed':
        $a = relire_abonnement($abonnementFacture($o));
        // seulement un abonnement en retard (un changement de formule refusé, lui, ne change rien à l'abonnement)
        if ($a && premiere_fois($a['id'], 'impaye_depuis', "statut IN ('past_due', 'unpaid')")) email_abonnement('impaye', $a);
        break;

    default:
        json(200, ['ignore' => $type]);
}
json(200, ['ok' => true]);
