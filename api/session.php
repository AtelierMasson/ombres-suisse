<?php
// Lien magique : GET ?jeton=… affiche une page qui se valide d'elle-même (POST), puis crée la session,
// pose le cookie (HttpOnly, Secure, SameSite=Lax) et redirige vers le site.
// Le passage par POST évite que les antivirus de messagerie, qui ouvrent les liens (GET), consomment le jeton.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

$m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$jeton = (string) ($m === 'POST' ? ($_POST['jeton'] ?? '') : ($_GET['jeton'] ?? ''));
$l = langue($m === 'POST' ? ($_POST['langue'] ?? null) : ($_GET['langue'] ?? null));
$retour = fn(string $etat) => SITE_URL . '/?' . http_build_query(['compte' => $etat, 'lang' => $l]);

if (!preg_match('/^[0-9a-f]{64}$/', $jeton)) {
    header('Location: ' . $retour('lien_invalide'), true, 303);
    exit;
}

if ($m !== 'POST') {
    $textes = [
        'fr' => ['Connexion…', 'Se connecter'],
        'de' => ['Anmeldung…', 'Anmelden'],
        'it' => ['Accesso…', 'Accedi'],
        'en' => ['Signing in…', 'Sign in'],
    ][$l];
    $h = fn(string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-store');
    header("Content-Security-Policy: default-src 'none'; script-src 'sha256-" . base64_encode(hash('sha256', 'document.forms[0].submit()', true)) . "'; style-src 'unsafe-inline'; form-action 'self'");
    echo '<!doctype html><html lang="' . $l . '"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
        . '<meta name="robots" content="noindex"><title>Topograph</title>'
        . '<body style="font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;color:#1f2933">'
        . '<form method="post" action="session.php"><p>' . $h($textes[0]) . '</p>'
        . '<input type="hidden" name="jeton" value="' . $h($jeton) . '"><input type="hidden" name="langue" value="' . $l . '">'
        . '<button type="submit" style="font:inherit;padding:.5em 1.2em">' . $h($textes[1]) . '</button></form>'
        . '<script>document.forms[0].submit()</script></body></html>';
    exit;
}

$o = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($o !== '' && $o !== 'null' && !origine_admise($o)) { http_response_code(403); exit; }

$pdo = bd();
$pdo->beginTransaction();
$q = $pdo->prepare('SELECT email FROM jetons WHERE jeton = ? AND utilise = 0 AND expire > UTC_TIMESTAMP() FOR UPDATE');
$q->execute([hache($jeton)]);
$email = $q->fetchColumn();
if ($email === false) {
    $pdo->rollBack();
    header('Location: ' . $retour('lien_expire'), true, 303);
    exit;
}
$pdo->prepare('UPDATE jetons SET utilise = 1 WHERE jeton = ?')->execute([hache($jeton)]);

// le compte est créé à la première connexion
$pdo->prepare('INSERT INTO comptes (email) VALUES (?) ON DUPLICATE KEY UPDATE id = id')->execute([$email]);
$q = $pdo->prepare('SELECT id FROM comptes WHERE email = ?');
$q->execute([$email]);
$compteId = (int) $q->fetchColumn();

$valeur = bin2hex(random_bytes(32));
$pdo->prepare('INSERT INTO sessions (id, compte_id, expire) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL 180 DAY)')
    ->execute([hache($valeur), $compteId]);
$pdo->commit();

poser_cookie($valeur, time() + DUREE_SESSION);
header('Cache-Control: no-store');
header('Location: ' . $retour('connecte'), true, 303);
