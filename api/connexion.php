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
// e-mail sobre : texte et HTML (bouton « Se connecter »), sans nom d'éditeur, juste topograph.ch
$textes = [
    'fr' => ['Votre lien de connexion à Topograph', 'Bonjour,', 'Utilisez ce lien pour vous connecter à Topograph.', 'Se connecter',
        "Ce lien est valable 15 minutes et ne peut être utilisé qu'une seule fois. Si vous n'avez pas demandé ce lien, vous pouvez ignorer ce message.",
        'Si le bouton ne fonctionne pas, copiez ce lien dans la barre d’adresse de votre navigateur :'],
    'de' => ['Ihr Anmeldelink für Topograph', 'Guten Tag', 'Mit diesem Link melden Sie sich bei Topograph an.', 'Anmelden',
        'Dieser Link ist 15 Minuten gültig und nur einmal verwendbar. Falls Sie diesen Link nicht angefordert haben, können Sie diese Nachricht ignorieren.',
        'Falls die Schaltfläche nicht funktioniert, kopieren Sie diesen Link in die Adressleiste Ihres Browsers:'],
    'it' => ['Il suo link di accesso a Topograph', 'Buongiorno,', 'Usi questo link per accedere a Topograph.', 'Accedere',
        'Il link è valido per 15 minuti e può essere utilizzato una sola volta. Se non lo ha richiesto, può ignorare questo messaggio.',
        'Se il pulsante non funziona, copi questo link nella barra degli indirizzi del browser:'],
    'en' => ['Your Topograph sign-in link', 'Hello,', 'Use this link to sign in to Topograph.', 'Sign in',
        'This link is valid for 15 minutes and can only be used once. If you did not request it, you can ignore this message.',
        "If the button does not work, copy this link into your browser's address bar:"],
];
[$sujet, $salut, $phrase, $bouton, $note, $secours] = $textes[$l];
$h = fn(string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
$texte = "$salut\n\n$phrase\n\n$lien\n\n$note\n\n—\ntopograph.ch";
$html = '<!doctype html><html lang="' . $l . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' . $h($sujet) . '</title></head>'
    . '<body style="margin:0;padding:32px 12px;background:#f4f2ee;font-family:Helvetica,Arial,sans-serif;color:#1f2933">'
    . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
    . '<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e2e5e9;border-radius:10px">'
    . '<tr><td style="padding:28px 32px 8px;font-size:18px;font-weight:700">Topograph</td></tr>'
    . '<tr><td style="padding:8px 32px 0;font-size:15px;line-height:1.55">' . $h($salut) . '<br><br>' . $h($phrase) . '</td></tr>'
    . '<tr><td style="padding:24px 32px"><a href="' . $h($lien) . '" style="display:inline-block;background:#1f3b6b;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:7px">' . $h($bouton) . '</a></td></tr>'
    . '<tr><td style="padding:0 32px 16px;font-size:13px;line-height:1.5;color:#66727f">' . $h($note) . '</td></tr>'
    . '<tr><td style="padding:0 32px 24px;font-size:12px;line-height:1.5;color:#66727f">' . $h($secours) . '<br><a href="' . $h($lien) . '" style="color:#1f3b6b;word-break:break-all">' . $h($lien) . '</a></td></tr>'
    . '<tr><td style="padding:16px 32px 24px;border-top:1px solid #e2e5e9;font-size:12px;color:#66727f"><a href="https://topograph.ch" style="color:#66727f">topograph.ch</a></td></tr>'
    . '</table></td></tr></table></body></html>';
if (!envoyer_email($email, $sujet, $texte, $html)) json(502, ['erreur' => 'envoi']);

json(200, ['ok' => true]);
