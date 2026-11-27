<?php
// Webhook Stripe : vérifie la signature (Stripe-Signature, HMAC SHA-256), puis
// checkout.session.completed (payé) ou checkout.session.async_payment_succeeded → compte pro et e-mail de confirmation
// (délai de rétractation) ; charge.refunded (remboursement fait aussi depuis Stripe) → Pro retiré. Idempotent.
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
if ($type === 'charge.refunded') {
    // remboursement (rétractation sur le site, ou fait à la main dans Stripe) : l'achat est marqué, le Pro retiré
    $ch = $ev['data']['object'] ?? [];
    $pi = (string) ($ch['payment_intent'] ?? '');
    if ($pi === '' || empty($ch['refunded'])) json(200, ['ignore' => 'partiel']);
    $pdo = bd();
    $q = $pdo->prepare('SELECT id, compte_id FROM achats WHERE payment_intent = ?');
    $q->execute([$pi]);
    $a = $q->fetch();
    if (!$a) json(200, ['ignore' => 'inconnu']);
    $pdo->prepare("UPDATE achats SET etat = 'rembourse', rembourse_le = COALESCE(rembourse_le, UTC_TIMESTAMP()) WHERE id = ?")->execute([$a['id']]);
    $n = $pdo->prepare("SELECT COUNT(*) FROM achats WHERE compte_id = ? AND etat = 'paye'");
    $n->execute([$a['compte_id']]);
    if ((int) $n->fetchColumn() === 0) $pdo->prepare('UPDATE comptes SET pro = 0 WHERE id = ?')->execute([$a['compte_id']]);
    json(200, ['ok' => true]);
}
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
$avant = $pdo->prepare('SELECT etat FROM achats WHERE id = ?');
$avant->execute([$s['id']]);
$dejaPaye = $avant->fetchColumn() === 'paye';
$l = langue(substr((string) ($s['locale'] ?? ''), 0, 2));
$pdo->beginTransaction();
$pdo->prepare("INSERT INTO achats (id, compte_id, montant, devise, etat, payment_intent, paye_le, langue) VALUES (?, ?, ?, ?, 'paye', ?, UTC_TIMESTAMP(), ?)
               ON DUPLICATE KEY UPDATE etat = IF(etat = 'rembourse', etat, 'paye'), montant = VALUES(montant),
               payment_intent = COALESCE(payment_intent, VALUES(payment_intent)), paye_le = COALESCE(paye_le, VALUES(paye_le)), langue = VALUES(langue)")
    ->execute([$s['id'], $compteId, $montant, $devise, (string) ($s['payment_intent'] ?? '') ?: null, $l]);
// achete_le garde la date du premier paiement : rejouer l'événement ne change rien
$pdo->prepare('UPDATE comptes SET pro = 1, achete_le = COALESCE(achete_le, UTC_TIMESTAMP()) WHERE id = ?')
    ->execute([$compteId]);
$pdo->commit();

// confirmation d'achat avec le délai de rétractation (une seule fois)
if (!$dejaPaye) {
    $e = $pdo->prepare('SELECT email FROM comptes WHERE id = ?');
    $e->execute([$compteId]);
    $email = (string) $e->fetchColumn();
    if ($email !== '') {
        $T = textes_achat($l);
        $fin = date('d.m.Y', time() + JOURS_RETRACTATION * 86400);
        $r = ['{montant}' => montant_texte($montant, $devise), '{date}' => $fin];
        email_sobre($email, $l, $T['achatSujet'], array_map(fn($p) => strtr($p, $r), $T['achat']));
    }
}

json(200, ['ok' => true]);
