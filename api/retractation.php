<?php
// POST { langue? } (connecté) → rétractation de l'achat Pro dans les 14 jours suivant le paiement, sans motif, même
// après usage : remboursement intégral par Stripe, Pro retiré, e-mail de confirmation de réception.
// Réponse : 200 { ok }, 404 { erreur: "aucun_achat" } (rien de remboursable), 409 { erreur: "delai_depasse" },
// 502 { erreur: "remboursement" } (Stripe indisponible : écrire à contact@topograph.ch).
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('POST');
$c = exiger_compte();
$d = corps();
$pdo = bd();
$q = $pdo->prepare("SELECT id, montant, devise, payment_intent, COALESCE(paye_le, cree_le) AS paye_le, langue FROM achats
                    WHERE compte_id = ? AND etat = 'paye' ORDER BY paye_le DESC LIMIT 1");
$q->execute([$c['id']]);
$a = $q->fetch();
if (!$a || empty($a['payment_intent'])) json(404, ['erreur' => 'aucun_achat']);
if (strtotime($a['paye_le'] . ' UTC') + JOURS_RETRACTATION * 86400 < time()) json(409, ['erreur' => 'delai_depasse']);

// remboursement intégral ; la clé d'idempotence évite un double remboursement si la demande est envoyée deux fois
[$code, $r] = stripe_post('refunds', ['payment_intent' => $a['payment_intent'], 'reason' => 'requested_by_customer',
    'metadata' => ['motif' => 'retractation', 'compte_id' => (string) $c['id']]]);
if ($code < 200 || $code >= 300 || empty($r['id'])) {
    // déjà remboursé (par exemple depuis Stripe) : on aligne simplement l'état
    if (($r['error']['code'] ?? '') !== 'charge_already_refunded') json(502, ['erreur' => 'remboursement']);
}

$pdo->beginTransaction();
$pdo->prepare("UPDATE achats SET etat = 'rembourse', rembourse_le = UTC_TIMESTAMP(), remboursement = ? WHERE id = ?")
    ->execute([$r['id'] ?? null, $a['id']]);
$pdo->prepare('UPDATE comptes SET pro = 0 WHERE id = ?')->execute([$c['id']]);
$pdo->commit();

$l = langue($d['langue'] ?? $a['langue'] ?? null);
$T = textes_achat($l);
email_sobre($c['email'], $l, $T['retractSujet'], array_map(fn($p) => strtr($p, ['{montant}' => montant_texte((int) $a['montant'], $a['devise'])]), $T['retract']));
json(200, ['ok' => true]);
