<?php
// Tableau d'administration, réservé aux comptes listés dans ADMIN_EMAILS (config.php).
// GET  → 200 { resume, inscriptions, ventes, comptes, usage } ; 401 non connecté ; 403 pas administrateur.
// POST { action: "pro", email, pro: true|false } → offre ou retire le Pro offert (geste commercial, test), indépendant
// de l'abonnement.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

$m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
entree($m === 'POST' ? 'POST' : 'GET');
$moi = exiger_compte();
$admins = array_map('strtolower', defined('ADMIN_EMAILS') ? ADMIN_EMAILS : []);
if (!in_array(strtolower($moi['email']), $admins, true)) json(403, ['erreur' => 'pas_admin']);
$bd = bd();

if ($m === 'POST') {
    $d = corps();
    if (($d['action'] ?? '') !== 'pro') json(400, ['erreur' => 'action']);
    $email = strtolower(trim((string) ($d['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) json(400, ['erreur' => 'email_invalide']);
    $pro = !empty($d['pro']) ? 1 : 0;
    // le compte est créé s'il n'existe pas encore : il deviendra Pro à sa première connexion
    $bd->prepare('INSERT INTO comptes (email, pro, achete_le) VALUES (?, ?, IF(? = 1, UTC_TIMESTAMP(), NULL))
                  ON DUPLICATE KEY UPDATE pro = VALUES(pro), achete_le = IF(VALUES(pro) = 1, COALESCE(achete_le, UTC_TIMESTAMP()), achete_le)')
        ->execute([$email, $pro, $pro]);
    json(200, ['ok' => true, 'email' => $email, 'pro' => (bool) $pro]);
}

$un = fn(string $sql, array $p = []) => (function () use ($bd, $sql, $p) { $q = $bd->prepare($sql); $q->execute($p); return $q->fetchColumn(); })();
$tous = fn(string $sql, array $p = []) => (function () use ($bd, $sql, $p) { $q = $bd->prepare($sql); $q->execute($p); return $q->fetchAll(); })();

$resume = [
    'comptes'        => (int) $un('SELECT COUNT(*) FROM comptes'),
    'pro'            => (int) $un('SELECT COUNT(*) FROM comptes c WHERE c.pro = 1 OR ' . SQL_PRO_ABONNEMENT),
    'offerts'        => (int) $un('SELECT COUNT(*) FROM comptes WHERE pro = 1'),
    'essais'         => (int) $un("SELECT COUNT(*) FROM abonnements WHERE statut = 'trialing'"),
    'abonnes'        => (int) $un("SELECT COUNT(*) FROM abonnements WHERE statut IN ('active', 'past_due')"),
    'annuels'        => (int) $un("SELECT COUNT(*) FROM abonnements WHERE statut IN ('trialing', 'active', 'past_due') AND intervalle = 'year'"),
    'resilies'       => (int) $un("SELECT COUNT(*) FROM abonnements WHERE statut IN ('trialing', 'active') AND resilie = 1"),
    'inscrits30'     => (int) $un('SELECT COUNT(*) FROM comptes WHERE cree_le > UTC_TIMESTAMP() - INTERVAL 30 DAY'),
    'ventes'         => (int) $un("SELECT COUNT(*) FROM achats WHERE etat = 'paye'"),
    'chiffre'        => (int) $un("SELECT COALESCE(SUM(montant), 0) FROM achats WHERE etat = 'paye'"),
    'chiffre30'      => (int) $un("SELECT COALESCE(SUM(montant), 0) FROM achats WHERE etat = 'paye' AND cree_le > UTC_TIMESTAMP() - INTERVAL 30 DAY"),
    'sessions'       => (int) $un('SELECT COUNT(*) FROM sessions WHERE expire > UTC_TIMESTAMP()'),
];
json(200, [
    'resume'       => $resume,
    // 90 derniers jours
    'inscriptions' => $tous('SELECT DATE(cree_le) AS jour, COUNT(*) AS n FROM comptes WHERE cree_le > UTC_TIMESTAMP() - INTERVAL 90 DAY GROUP BY jour ORDER BY jour'),
    'ventesJour'   => $tous("SELECT DATE(cree_le) AS jour, COUNT(*) AS n, SUM(montant) AS montant FROM achats WHERE etat = 'paye' AND cree_le > UTC_TIMESTAMP() - INTERVAL 90 DAY GROUP BY jour ORDER BY jour"),
    'usage'        => $tous('SELECT jour, evenement, n FROM compteurs WHERE jour > UTC_DATE() - INTERVAL 90 DAY ORDER BY jour'),
    'ventes'       => $tous('SELECT a.id, c.email, a.montant, a.devise, a.etat, a.cree_le FROM achats a JOIN comptes c ON c.id = a.compte_id ORDER BY a.cree_le DESC LIMIT 100'),
    'comptes'      => $tous('SELECT c.email, c.pro, c.achete_le, c.cree_le, c.prenom, c.nom, c.societe, c.adresse, c.npa, c.localite, c.pays, c.telephone,
                        (SELECT CONCAT(a.statut, IF(a.intervalle IS NULL, \'\', CONCAT(\' \', a.intervalle)), IF(a.resilie, \' (résilié)\', \'\'))
                         FROM abonnements a WHERE a.compte_id = c.id ORDER BY a.cree_le DESC LIMIT 1) AS abonnement
                      FROM comptes c ORDER BY c.cree_le DESC LIMIT 500'),
    // boîte à suggestions (suggestion.php) : les 200 dernières, la plus récente d'abord
    'suggestions'  => (function () {
        $f = dirname(__DIR__, 2) . '/donnees-topograph/suggestions.jsonl';
        if (!is_file($f)) return [];
        $lignes = array_slice(file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [], -200);
        return array_reverse(array_values(array_filter(array_map(fn($l) => json_decode($l, true), $lignes))));
    })(),
]);
