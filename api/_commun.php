<?php
// Fonctions communes de l'API des comptes : configuration, base, CORS, JSON, session, e-mail.
declare(strict_types=1);

if (!is_file(__DIR__ . '/config.php')) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    exit('{"erreur":"non_configure"}');
}
require __DIR__ . '/config.php';

const COOKIE_NOM = 'ombres_session';
const DUREE_JETON = 900;              // 15 min
const DUREE_SESSION = 180 * 86400;    // 180 jours

date_default_timezone_set('UTC');
ini_set('display_errors', '0');
// toute erreur imprévue (base indisponible…) → 500, journalisée ; Stripe rejoue alors le webhook plus tard
set_exception_handler(function (Throwable $e): void {
    error_log('API comptes : ' . $e);
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo '{"erreur":"serveur"}';
});
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function bd(): PDO
{
    static $pdo = null;
    if ($pdo === null) {
        $pdo = new PDO(BD_DSN, BD_UTILISATEUR, BD_MOT_DE_PASSE, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}

function json(int $code, array $donnees): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($donnees, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function origine_de(string $url): string
{
    $u = parse_url($url);
    return ($u['scheme'] ?? '') . '://' . ($u['host'] ?? '') . (isset($u['port']) ? ':' . $u['port'] : '');
}

/** Origines admises : le site, l'API elle-même et, si définie, l'origine de développement. */
function origine_admise(string $o): bool
{
    return $o === origine_de(SITE_URL) || $o === origine_de(API_URL) || (ORIGINE_DEV !== '' && $o === ORIGINE_DEV);
}

/**
 * CORS (même domaine attendu ; origine de développement avec cookies) et contrôle de la méthode.
 * Pour un POST, une origine étrangère est refusée (protection CSRF en plus de SameSite=Lax).
 */
function entree(string $methode): void
{
    $o = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($o !== '' && origine_admise($o)) {
        header('Access-Control-Allow-Origin: ' . $o);
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        header('Vary: Origin');
    }
    $m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($m === 'OPTIONS') { http_response_code(204); exit; }
    if ($m !== $methode) { header('Allow: ' . $methode); json(405, ['erreur' => 'methode']); }
    if ($m === 'POST' && $o !== '' && !origine_admise($o)) json(403, ['erreur' => 'origine']);
}

/** Corps JSON ou formulaire. */
function corps(): array
{
    $type = $_SERVER['CONTENT_TYPE'] ?? '';
    if (str_starts_with($type, 'application/json')) {
        $d = json_decode((string) file_get_contents('php://input'), true);
        return is_array($d) ? $d : [];
    }
    return $_POST;
}

function hache(string $valeur): string
{
    return hash('sha256', $valeur);
}

function langue(?string $l): string
{
    return in_array($l, ['fr', 'de', 'it', 'en'], true) ? $l : 'fr';
}

function poser_cookie(string $valeur, int $expire): void
{
    setcookie(COOKIE_NOM, $valeur, [
        'expires' => $expire,
        'path' => '/',
        'secure' => COOKIE_SECURE,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
}

/** Compte de la session courante, ou null. */
function compte_courant(): ?array
{
    $c = $_COOKIE[COOKIE_NOM] ?? '';
    if (!is_string($c) || !preg_match('/^[0-9a-f]{64}$/', $c)) return null;
    $q = bd()->prepare('SELECT c.id, c.email, c.pro FROM sessions s JOIN comptes c ON c.id = s.compte_id
                        WHERE s.id = ? AND s.expire > UTC_TIMESTAMP()');
    $q->execute([hache($c)]);
    $r = $q->fetch();
    return $r ?: null;
}

function exiger_compte(): array
{
    $c = compte_courant();
    if ($c === null) json(401, ['erreur' => 'non_connecte']);
    return $c;
}

// ---------------------------------------------------------------- e-mail

function entete_utf8(string $s): string
{
    return preg_match('/[^\x20-\x7e]/', $s) ? '=?UTF-8?B?' . base64_encode($s) . '?=' : $s;
}

/** Envoie un e-mail (UTF-8) : texte, et HTML en alternative si `$html` est donné. SMTP Infomaniak si configuré, sinon mail(). */
function envoyer_email(string $a, string $sujet, string $texte, ?string $html = null): bool
{
    $de = EXPEDITEUR_EMAIL;
    $domaine = substr(strrchr($de, '@') ?: '@localhost', 1);
    $entetes = [
        'Date: ' . date(DATE_RFC2822),
        'From: ' . entete_utf8(EXPEDITEUR_NOM) . " <$de>",
        "To: <$a>",
        'Subject: ' . entete_utf8($sujet),
        'Message-ID: <' . bin2hex(random_bytes(16)) . "@$domaine>",
        'MIME-Version: 1.0',
        'Auto-Submitted: auto-generated',
    ];
    if ($html === null) {
        $entetes[] = 'Content-Type: text/plain; charset=UTF-8';
        $entetes[] = 'Content-Transfer-Encoding: base64';
        $corps = chunk_split(base64_encode($texte), 76, "\r\n");
    } else {
        // deux versions : texte (lecteurs simples, filtres anti-spam) et HTML (bouton)
        $b = 'b' . bin2hex(random_bytes(12));
        $entetes[] = "Content-Type: multipart/alternative; boundary=\"$b\"";
        $partie = fn(string $type, string $c) => "--$b\r\nContent-Type: $type; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n"
            . chunk_split(base64_encode($c), 76, "\r\n");
        $corps = $partie('text/plain', $texte) . $partie('text/html', $html) . "--$b--\r\n";
    }

    if (SMTP_HOTE === '') {
        $sansToSujet = array_filter($entetes, fn($h) => !str_starts_with($h, 'To:') && !str_starts_with($h, 'Subject:'));
        return mail($a, entete_utf8($sujet), $corps, implode("\r\n", $sansToSujet), '-f' . $de);
    }
    try {
        smtp($de, $a, implode("\r\n", $entetes) . "\r\n\r\n" . $corps);
        return true;
    } catch (Throwable $e) {
        error_log('SMTP : ' . $e->getMessage());
        return false;
    }
}

/** Client SMTP minimal : SSL implicite (465) ou STARTTLS (587), AUTH LOGIN. */
function smtp(string $de, string $a, string $message): void
{
    $ssl = SMTP_PORT === 465;
    $s = stream_socket_client(($ssl ? 'ssl://' : 'tcp://') . SMTP_HOTE . ':' . SMTP_PORT, $errno, $errstr, 15);
    if (!$s) throw new RuntimeException("connexion $errstr");
    stream_set_timeout($s, 15);
    $lire = function (int $attendu) use ($s): void {
        $rep = '';
        while (($l = fgets($s, 515)) !== false) {
            $rep .= $l;
            if (strlen($l) < 4 || $l[3] === ' ') break;
        }
        if ((int) substr($rep, 0, 3) !== $attendu) throw new RuntimeException(trim($rep));
    };
    $dire = function (string $cmd, int $attendu) use ($s, $lire): void {
        fwrite($s, $cmd . "\r\n");
        $lire($attendu);
    };
    $hote = parse_url(SITE_URL, PHP_URL_HOST) ?: 'localhost';
    $lire(220);
    $dire("EHLO $hote", 250);
    if (!$ssl) {
        $dire('STARTTLS', 220);
        if (!stream_socket_enable_crypto($s, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('STARTTLS');
        $dire("EHLO $hote", 250);
    }
    $dire('AUTH LOGIN', 334);
    $dire(base64_encode(SMTP_UTILISATEUR), 334);
    $dire(base64_encode(SMTP_MOT_DE_PASSE), 235);
    $dire("MAIL FROM:<$de>", 250);
    $dire("RCPT TO:<$a>", 250);
    $dire('DATA', 354);
    // le corps est en base64 : aucune ligne ne commence par un point
    $dire($message . "\r\n.", 250);
    fwrite($s, "QUIT\r\n");
    fclose($s);
}

/**
 * E-mail sobre, même graphisme que celui de connexion : paragraphes, bouton facultatif [libellé, lien] et note en petit
 * (gris) sous le bouton. Texte et HTML.
 */
function email_sobre(string $a, string $l, string $sujet, array $paragraphes, ?array $bouton = null, array $notes = []): bool
{
    $h = fn(string $s) => htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    $texte = implode("\n\n", $paragraphes) . ($bouton ? "\n\n{$bouton[0]} : {$bouton[1]}" : '') . ($notes ? "\n\n" . implode("\n\n", $notes) : '') . "\n\n—\ntopograph.ch";
    $corps = implode('', array_map(fn($p) => '<p style="margin:0 0 14px">' . nl2br($h($p)) . '</p>', $paragraphes));
    $html = '<!doctype html><html lang="' . $h($l) . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' . $h($sujet) . '</title></head>'
        . '<body style="margin:0;padding:32px 12px;background:#f4f2ee;font-family:Helvetica,Arial,sans-serif;color:#1f2933">'
        . '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
        . '<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e2e5e9;border-radius:10px">'
        . '<tr><td style="padding:28px 32px 8px;font-size:18px;font-weight:700">Topograph</td></tr>'
        . '<tr><td style="padding:8px 32px 0;font-size:15px;line-height:1.55">' . $corps . '</td></tr>'
        . ($bouton ? '<tr><td style="padding:10px 32px 24px"><a href="' . $h($bouton[1]) . '" style="display:inline-block;background:#1f3b6b;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:7px">' . $h($bouton[0]) . '</a></td></tr>' : '')
        . implode('', array_map(fn($n) => '<tr><td style="padding:0 32px 12px;font-size:12px;line-height:1.5;color:#66727f">' . nl2br($h($n)) . '</td></tr>', $notes))
        . '<tr><td style="padding:16px 32px 24px;border-top:1px solid #e2e5e9;font-size:12px;color:#66727f"><a href="https://topograph.ch" style="color:#66727f">topograph.ch</a></td></tr>'
        . '</table></td></tr></table></body></html>';
    return envoyer_email($a, $sujet, $texte, $html);
}

/** Appel POST à l'API Stripe ; renvoie [code HTTP, réponse décodée ou null]. */
function stripe_post(string $chemin, array $params): array
{
    $ch = curl_init('https://api.stripe.com/v1/' . $chemin);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($params),
        CURLOPT_USERPWD => STRIPE_CLE_SECRETE . ':',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
    ]);
    $rep = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if ($code < 200 || $code >= 300) error_log("Stripe $chemin : $code " . (is_string($rep) ? $rep : curl_error($ch)));
    return [$code, is_string($rep) ? json_decode($rep, true) : null];
}

// Rétractation : 14 jours après le paiement, sans motif, même après usage ; remboursement intégral, Pro retiré.
const JOURS_RETRACTATION = 14;

/** Textes des e-mails d'achat et de rétractation, par langue. {date} = fin du délai, {montant} = « CHF 39.– ». */
function textes_achat(string $l): array
{
    $T = [
        'fr' => [
            'achatSujet' => 'Votre achat de Topograph Pro',
            'achat' => ['Bonjour,', 'Merci pour votre achat. Topograph Pro est activé sur votre compte : paiement unique de {montant}, sans abonnement.'],
            'achatBouton' => 'Ouvrir Topograph',
            'achatNotes' => ['Le reçu de paiement vous est envoyé séparément par Stripe.', "Rétractation : vous pouvez vous rétracter sans motif jusqu'au {date}, même après usage, depuis « Mon compte » sur topograph.ch ou en écrivant à contact@topograph.ch. Le montant est alors remboursé en entier et l'accès Pro retiré."],
            'retractSujet' => 'Votre rétractation est confirmée',
            'retract' => ['Bonjour,', 'Nous avons bien reçu votre rétractation pour Topograph Pro.',
                "Le remboursement de {montant} est lancé sur le moyen de paiement utilisé ; il apparaît en général sous 5 à 10 jours ouvrables. L'accès Pro a été retiré de votre compte ; votre compte gratuit reste ouvert."],
        ],
        'de' => [
            'achatSujet' => 'Ihr Kauf von Topograph Pro',
            'achat' => ['Guten Tag', 'Vielen Dank für Ihren Kauf. Topograph Pro ist für Ihr Konto freigeschaltet: einmalige Zahlung von {montant}, kein Abonnement.'],
            'achatBouton' => 'Topograph öffnen',
            'achatNotes' => ['Die Zahlungsquittung erhalten Sie separat von Stripe.', 'Widerruf: Sie können bis zum {date} ohne Angabe von Gründen widerrufen, auch nach der Nutzung, unter «Mein Konto» auf topograph.ch oder per E-Mail an contact@topograph.ch. Der Betrag wird dann vollständig zurückerstattet und der Pro-Zugang entfernt.'],
            'retractSujet' => 'Ihr Widerruf ist bestätigt',
            'retract' => ['Guten Tag', 'Wir haben Ihren Widerruf für Topograph Pro erhalten.',
                'Die Rückerstattung von {montant} auf das verwendete Zahlungsmittel ist veranlasst; sie erscheint in der Regel innert 5 bis 10 Arbeitstagen. Der Pro-Zugang wurde von Ihrem Konto entfernt; Ihr kostenloses Konto bleibt bestehen.'],
        ],
        'it' => [
            'achatSujet' => 'Il suo acquisto di Topograph Pro',
            'achat' => ['Buongiorno,', 'Grazie per il suo acquisto. Topograph Pro è attivo sul suo conto: pagamento unico di {montant}, senza abbonamento.'],
            'achatBouton' => 'Aprire Topograph',
            'achatNotes' => ['La ricevuta di pagamento le viene inviata separatamente da Stripe.', 'Recesso: può recedere senza indicarne il motivo fino al {date}, anche dopo l’uso, da «Il mio conto» su topograph.ch o scrivendo a contact@topograph.ch. L’importo viene allora rimborsato per intero e l’accesso Pro revocato.'],
            'retractSujet' => 'Il suo recesso è confermato',
            'retract' => ['Buongiorno,', 'Abbiamo ricevuto il suo recesso per Topograph Pro.',
                'Il rimborso di {montant} sul mezzo di pagamento utilizzato è stato avviato; di solito appare entro 5–10 giorni lavorativi. L’accesso Pro è stato revocato; il suo conto gratuito resta attivo.'],
        ],
        'en' => [
            'achatSujet' => 'Your Topograph Pro purchase',
            'achat' => ['Hello,', 'Thank you for your purchase. Topograph Pro is now active on your account: one-time payment of {montant}, no subscription.'],
            'achatBouton' => 'Open Topograph',
            'achatNotes' => ['Stripe sends the payment receipt separately.', 'Withdrawal: you can withdraw without giving a reason until {date}, even after use, from "My account" on topograph.ch or by writing to contact@topograph.ch. The full amount is then refunded and Pro access removed.'],
            'retractSujet' => 'Your withdrawal is confirmed',
            'retract' => ['Hello,', 'We have received your withdrawal for Topograph Pro.',
                'The refund of {montant} to the payment method used has been initiated; it usually appears within 5 to 10 business days. Pro access has been removed from your account; your free account remains open.'],
        ],
    ];
    return $T[langue($l)];
}

/** « CHF 39.– » et date de fin du délai (jj.mm.aaaa) pour un paiement. */
function montant_texte(int $centimes, string $devise): string
{
    return strtoupper($devise) . ' ' . ($centimes % 100 ? number_format($centimes / 100, 2, '.', "'") : intdiv($centimes, 100) . '.–');
}
