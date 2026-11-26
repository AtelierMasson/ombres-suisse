<?php
// Webhook Stripe : vérifie la signature (Stripe-Signature, HMAC SHA-256), puis
// checkout.session.completed (payé) ou checkout.session.async_payment_succeeded → compte pro. Idempotent.
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

$ev = json_decode($brut, true);
$type = $ev['type'] ?? '';
if (!in_array($type, ['checkout.session.completed', 'checkout.session.async_payment_succeeded'], true)) {
    json(200, ['ignore' => $type]);
}
$s = $ev['data']['object'] ?? [];
if (($s['payment_status'] ?? '') !== 'paid') json(200, ['attente' => true]); // TWINT : confirmé plus tard

$compteId = (int) ($s['client_reference_id'] ?? 0);
$montant = (int) ($s['amount_total'] ?? 0);
$devise = strtolower((string) ($s['currency'] ?? ''));
if ($compteId <= 0 || empty($s['id'])) json(200, ['ignore' => 'sans_compte']);
if ($montant < PRIX_CENTIMES || $devise !== DEVISE) {
    error_log("Webhook : montant inattendu $montant $devise pour {$s['id']}");
    json(200, ['ignore' => 'montant']);
}

$pdo = bd();
$pdo->beginTransaction();
$pdo->prepare("INSERT INTO achats (id, compte_id, montant, devise, etat) VALUES (?, ?, ?, ?, 'paye')
               ON DUPLICATE KEY UPDATE etat = 'paye', montant = VALUES(montant)")
    ->execute([$s['id'], $compteId, $montant, $devise]);
// achete_le garde la date du premier paiement : rejouer l'événement ne change rien
$pdo->prepare('UPDATE comptes SET pro = 1, achete_le = COALESCE(achete_le, UTC_TIMESTAMP()) WHERE id = ?')
    ->execute([$compteId]);
$pdo->commit();

json(200, ['ok' => true]);
