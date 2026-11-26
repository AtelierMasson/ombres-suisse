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

/** Envoie un e-mail texte (UTF-8). SMTP Infomaniak si configuré, sinon mail(). */
function envoyer_email(string $a, string $sujet, string $texte): bool
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
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        'Auto-Submitted: auto-generated',
    ];
    $corps = chunk_split(base64_encode($texte), 76, "\r\n");

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
