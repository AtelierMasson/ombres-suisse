<?php
// POST { email, langue? } → envoie un lien de connexion valable 15 minutes.
// La réponse est la même que le compte existe ou non : { ok: true }.
declare(strict_types=1);
require __DIR__ . '/_commun.php';

entree('POST');
$d = corps();
$email = strtolower(trim((string) ($d['email'] ?? '')));
$l = langue($d['langue'] ?? null);
if (strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) json(400, ['erreur' => 'email_invalide']);

$pdo = bd();

// nettoyage occasionnel des lignes expirées
if (random_int(1, 50) === 1) {
    $pdo->exec('DELETE FROM jetons WHERE expire < UTC_TIMESTAMP() - INTERVAL 1 DAY');
    $pdo->exec('DELETE FROM sessions WHERE expire < UTC_TIMESTAMP()');
    $pdo->exec('DELETE FROM demandes WHERE cree_le < UTC_TIMESTAMP() - INTERVAL 1 DAY');
}

// limitation : par adresse IP (réponse 429) et par e-mail (silencieuse, pour ne rien révéler)
$cleIp = hache('ip:' . ($_SERVER['REMOTE_ADDR'] ?? ''));
$cleEmail = hache('email:' . $email);
$compter = $pdo->prepare('SELECT COUNT(*) FROM demandes WHERE cle = ? AND cree_le > UTC_TIMESTAMP() - INTERVAL 1 HOUR');
$compter->execute([$cleIp]);
if ((int) $compter->fetchColumn() >= LIMITE_PAR_IP) json(429, ['erreur' => 'trop_de_demandes']);
$compter->execute([$cleEmail]);
$tropPourEmail = (int) $compter->fetchColumn() >= LIMITE_PAR_EMAIL;
$noter = $pdo->prepare('INSERT INTO demandes (cle) VALUES (?)');
$noter->execute([$cleIp]);
$noter->execute([$cleEmail]);
if ($tropPourEmail) json(200, ['ok' => true]);

// jeton aléatoire de 32 octets ; seul son haché est conservé
$jeton = bin2hex(random_bytes(32));
$pdo->prepare('INSERT INTO jetons (jeton, email, expire) VALUES (?, ?, UTC_TIMESTAMP() + INTERVAL 15 MINUTE)')
    ->execute([hache($jeton), $email]);

$lien = API_URL . '/session.php?' . http_build_query(['jeton' => $jeton, 'langue' => $l]);
$textes = [
    'fr' => ['Votre lien de connexion — Ombres',
        "Bonjour,\n\nPour vous connecter à Ombres, ouvrez ce lien (valable 15 minutes, une seule fois) :\n\n%s\n\nSi vous n'avez rien demandé, ignorez ce message.\n\nAtelier Masson"],
    'de' => ['Ihr Anmeldelink — Ombres',
        "Guten Tag\n\nUm sich bei Ombres anzumelden, öffnen Sie diesen Link (15 Minuten gültig, nur einmal verwendbar):\n\n%s\n\nFalls Sie nichts angefordert haben, ignorieren Sie diese Nachricht.\n\nAtelier Masson"],
    'it' => ['Il suo link di accesso — Ombres',
        "Buongiorno,\n\nper accedere a Ombres apra questo link (valido 15 minuti, utilizzabile una sola volta):\n\n%s\n\nSe non ha richiesto nulla, ignori questo messaggio.\n\nAtelier Masson"],
    'en' => ['Your sign-in link — Ombres',
        "Hello,\n\nTo sign in to Ombres, open this link (valid for 15 minutes, single use):\n\n%s\n\nIf you did not request this, please ignore this message.\n\nAtelier Masson"],
];
[$sujet, $modele] = $textes[$l];
if (!envoyer_email($email, $sujet, sprintf($modele, $lien))) json(502, ['erreur' => 'envoi']);

json(200, ['ok' => true]);
