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

// ---------------------------------------------------------------- Stripe et abonnement Pro

/** Appel à l'API Stripe (GET, POST ou DELETE) ; renvoie [code HTTP, réponse décodée ou null]. */
function stripe(string $methode, string $chemin, array $params = []): array
{
    $url = 'https://api.stripe.com/v1/' . $chemin;
    if ($methode === 'GET' && $params) $url .= '?' . http_build_query($params);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $methode,
        CURLOPT_USERPWD => STRIPE_CLE_SECRETE . ':',
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
    ]);
    if ($methode !== 'GET') curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
    $rep = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    if ($code < 200 || $code >= 300) error_log("Stripe $methode $chemin : $code " . (is_string($rep) ? $rep : curl_error($ch)));
    return [$code, is_string($rep) ? json_decode($rep, true) : null];
}

function stripe_post(string $chemin, array $params): array
{
    return stripe('POST', $chemin, $params);
}

// Abonnement : prix en centimes (config.php peut les redéfinir), essai gratuit, grâce après un paiement refusé
defined('PRIX_MOIS_CENTIMES') || define('PRIX_MOIS_CENTIMES', 900);     // CHF 9.– par mois
defined('PRIX_ANNEE_CENTIMES') || define('PRIX_ANNEE_CENTIMES', 8400);  // CHF 84.– par an (7.– par mois)
defined('NOM_ABONNEMENT') || define('NOM_ABONNEMENT', 'Topograph Pro');
const JOURS_ESSAI = 7;
const JOURS_GRACE = 7;
// version des conditions de vente acceptées au moment de l'abonnement
const VERSION_CGV = '2026-11-27-abo';

/**
 * Condition SQL « ce compte (alias c) a un abonnement qui donne le Pro » : essai ou actif ; paiement en retard
 * (past_due) pendant JOURS_GRACE jours. La fin de période sert de garde-fou si un webhook s'était perdu.
 */
const SQL_PRO_ABONNEMENT = "EXISTS (SELECT 1 FROM abonnements a WHERE a.compte_id = c.id
    AND (a.statut IN ('trialing', 'active')
         OR (a.statut = 'past_due' AND COALESCE(a.impaye_depuis, a.maj_le) > UTC_TIMESTAMP() - INTERVAL " . JOURS_GRACE . " DAY))
    AND (a.periode_fin IS NULL OR a.periode_fin > UTC_TIMESTAMP() - INTERVAL " . JOURS_GRACE . " DAY))";

/**
 * Compte de la session courante, ou null. pro = abonnement en cours ou Pro offert par un administrateur
 * (comptes.pro, admin.php).
 */
function compte_courant(): ?array
{
    $c = $_COOKIE[COOKIE_NOM] ?? '';
    if (!is_string($c) || !preg_match('/^[0-9a-f]{64}$/', $c)) return null;
    $sql = 'SELECT c.id, c.email, c.pro AS pro_offert, c.stripe_customer, ' . SQL_PRO_ABONNEMENT . ' AS pro_abonnement
            FROM sessions s JOIN comptes c ON c.id = s.compte_id WHERE s.id = ? AND s.expire > UTC_TIMESTAMP()';
    try {
        $q = bd()->prepare($sql);
        $q->execute([hache($c)]);
    } catch (PDOException $e) {
        // migration de l'abonnement pas encore appliquée : le site reste utilisable, sans abonnement
        error_log('compte_courant : ' . $e->getMessage());
        $q = bd()->prepare('SELECT c.id, c.email, c.pro AS pro_offert, NULL AS stripe_customer, 0 AS pro_abonnement
                            FROM sessions s JOIN comptes c ON c.id = s.compte_id WHERE s.id = ? AND s.expire > UTC_TIMESTAMP()');
        $q->execute([hache($c)]);
    }
    $r = $q->fetch();
    if (!$r) return null;
    $r['pro'] = (int) $r['pro_offert'] === 1 || (int) $r['pro_abonnement'] === 1 ? 1 : 0;
    return $r;
}

function exiger_compte(): array
{
    $c = compte_courant();
    if ($c === null) json(401, ['erreur' => 'non_connecte']);
    return $c;
}

/** Dernier abonnement du compte (le plus récent), ou null. */
function abonnement_du_compte(int $compteId): ?array
{
    $q = bd()->prepare('SELECT * FROM abonnements WHERE compte_id = ? ORDER BY cree_le DESC LIMIT 1');
    $q->execute([$compteId]);
    return $q->fetch() ?: null;
}

/**
 * Enregistre l'état d'un objet Subscription de Stripe (webhook ou lecture directe). `$quand` = horodatage de l'état
 * (created de l'événement, ou time() pour une lecture) : un événement plus ancien que l'état connu est ignoré, et un
 * abonnement terminé (canceled) ne revient jamais. Renvoie [compte_id, nouveau] ou null (compte introuvable).
 */
function abonnement_enregistrer(array $s, int $quand): ?array
{
    $id = (string) ($s['id'] ?? '');
    if (!str_starts_with($id, 'sub_')) return null;
    $client = is_array($s['customer'] ?? null) ? (string) ($s['customer']['id'] ?? '') : (string) ($s['customer'] ?? '');
    $pdo = bd();
    $avant = $pdo->prepare('SELECT compte_id, statut, evenement_le FROM abonnements WHERE id = ?');
    $avant->execute([$id]);
    $avant = $avant->fetch() ?: null;

    $compteId = (int) ($s['metadata']['compte_id'] ?? 0) ?: (int) ($avant['compte_id'] ?? 0);
    if ($compteId <= 0 && $client !== '') {
        $q = $pdo->prepare('SELECT id FROM comptes WHERE stripe_customer = ?');
        $q->execute([$client]);
        $compteId = (int) $q->fetchColumn();
    }
    $existe = $pdo->prepare('SELECT COUNT(*) FROM comptes WHERE id = ?');
    $existe->execute([$compteId]);
    if ($compteId <= 0 || (int) $existe->fetchColumn() === 0) {
        error_log("Abonnement $id : compte introuvable ($client)");
        return null;
    }
    $statut = (string) ($s['status'] ?? '');
    if ($avant && ((int) $avant['evenement_le'] > $quand || ($avant['statut'] === 'canceled' && $statut !== 'canceled'))) {
        return [$compteId, false];
    }

    // API Stripe récente : période portée par l'élément de l'abonnement ; ancienne : par l'abonnement
    $el = $s['items']['data'][0] ?? [];
    $fin = (int) ($el['current_period_end'] ?? $s['current_period_end'] ?? 0);
    $intervalle = (string) ($el['price']['recurring']['interval'] ?? $el['plan']['interval'] ?? '');
    $montant = $el['price']['unit_amount'] ?? $el['plan']['amount'] ?? null;
    $date = fn($t) => $t ? gmdate('Y-m-d H:i:s', (int) $t) : null;
    $resilie = !empty($s['cancel_at_period_end']) || !empty($s['cancel_at']) ? 1 : 0;
    $l = langue($s['metadata']['langue'] ?? null);

    $pdo->prepare('INSERT INTO abonnements (id, compte_id, stripe_customer, statut, intervalle, montant, devise, periode_fin, essai_fin,
                     resilie, cgv_version, langue, evenement_le)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON DUPLICATE KEY UPDATE stripe_customer = VALUES(stripe_customer), statut = VALUES(statut),
                     intervalle = VALUES(intervalle), montant = VALUES(montant), devise = VALUES(devise),
                     periode_fin = VALUES(periode_fin), essai_fin = VALUES(essai_fin), resilie = VALUES(resilie),
                     impaye_depuis = IF(VALUES(statut) = \'past_due\', impaye_depuis, NULL), evenement_le = VALUES(evenement_le)')
        ->execute([$id, $compteId, $client, $statut, $intervalle ?: null, $montant, strtolower((string) ($s['currency'] ?? DEVISE)),
            $date($fin), $date($s['trial_end'] ?? null), $resilie, (string) ($s['metadata']['cgv'] ?? '') ?: null, $l, $quand]);
    if ($client !== '') $pdo->prepare('UPDATE comptes SET stripe_customer = ? WHERE id = ?')->execute([$client, $compteId]);
    return [$compteId, $avant === null];
}

/** « CHF 9.– » à partir de centimes. */
function montant_texte(int $centimes, string $devise): string
{
    return strtoupper($devise) . ' ' . ($centimes % 100 ? number_format($centimes / 100, 2, '.', "'") : intdiv($centimes, 100) . '.–');
}

/**
 * Textes des e-mails de l'abonnement, par langue. {prix} = « CHF 9.– par mois », {date} = fin de l'essai (jj.mm.aaaa).
 */
function textes_abonnement(string $l): array
{
    $T = [
        'fr' => [
            'mois' => '{m} par mois', 'annee' => '{m} par an',
            'bouton' => 'Gérer mon abonnement',
            'bienvenueSujet' => 'Votre essai de Topograph Pro a commencé',
            'bienvenue' => ['Bonjour,', 'Topograph Pro est activé sur votre compte. Votre essai gratuit dure jusqu\'au {date}.',
                'Sans résiliation de votre part, l\'abonnement démarre ensuite automatiquement : {prix}. Vous pouvez résilier à tout moment dans « Mon compte », puis « Gérer mon abonnement ». Pendant l\'essai, rien n\'est débité.'],
            'actifSujet' => 'Votre abonnement Topograph Pro',
            'actif' => ['Bonjour,', 'Merci. Votre abonnement Topograph Pro est actif : {prix}.',
                'Vous pouvez changer de formule, mettre à jour votre carte ou résilier à tout moment dans « Mon compte », puis « Gérer mon abonnement ».'],
            'rappelSujet' => 'Votre essai de Topograph Pro se termine le {date}',
            'rappel' => ['Bonjour,', 'Votre essai gratuit de Topograph Pro se termine le {date}. L\'abonnement démarre alors automatiquement : {prix}, débité sur la carte enregistrée.',
                'Si vous ne souhaitez pas continuer, résiliez avant cette date dans « Mon compte », puis « Gérer mon abonnement ». Rien ne vous sera débité.'],
            'impayeSujet' => 'Le paiement de votre abonnement n\'a pas abouti',
            'impaye' => ['Bonjour,', 'Le paiement de votre abonnement Topograph Pro n\'a pas abouti. Nous réessaierons dans les prochains jours.',
                'Pour garder l\'accès Pro, mettez à jour votre carte dans « Mon compte », puis « Gérer mon abonnement ».'],
            'note' => 'Les reçus de paiement sont envoyés par Stripe. Conditions de vente : topograph.ch.',
        ],
        'de' => [
            'mois' => '{m} pro Monat', 'annee' => '{m} pro Jahr',
            'bouton' => 'Abonnement verwalten',
            'bienvenueSujet' => 'Ihr Test von Topograph Pro hat begonnen',
            'bienvenue' => ['Guten Tag', 'Topograph Pro ist für Ihr Konto freigeschaltet. Ihr kostenloser Test dauert bis zum {date}.',
                'Wenn Sie nicht kündigen, beginnt danach automatisch das Abonnement: {prix}. Sie können jederzeit unter «Mein Konto» und dann «Abonnement verwalten» kündigen. Während des Tests wird nichts belastet.'],
            'actifSujet' => 'Ihr Abonnement Topograph Pro',
            'actif' => ['Guten Tag', 'Vielen Dank. Ihr Abonnement Topograph Pro ist aktiv: {prix}.',
                'Sie können jederzeit unter «Mein Konto» und dann «Abonnement verwalten» die Variante wechseln, Ihre Karte ändern oder kündigen.'],
            'rappelSujet' => 'Ihr Test von Topograph Pro endet am {date}',
            'rappel' => ['Guten Tag', 'Ihr kostenloser Test von Topograph Pro endet am {date}. Danach beginnt automatisch das Abonnement: {prix}, belastet auf die hinterlegte Karte.',
                'Wenn Sie nicht weitermachen möchten, kündigen Sie vor diesem Datum unter «Mein Konto» und dann «Abonnement verwalten». Es wird Ihnen nichts belastet.'],
            'impayeSujet' => 'Die Zahlung Ihres Abonnements ist fehlgeschlagen',
            'impaye' => ['Guten Tag', 'Die Zahlung Ihres Abonnements Topograph Pro ist fehlgeschlagen. Wir versuchen es in den nächsten Tagen erneut.',
                'Um den Pro-Zugang zu behalten, aktualisieren Sie Ihre Karte unter «Mein Konto» und dann «Abonnement verwalten».'],
            'note' => 'Die Zahlungsquittungen sendet Stripe. Verkaufsbedingungen: topograph.ch.',
        ],
        'it' => [
            'mois' => '{m} al mese', 'annee' => '{m} all\'anno',
            'bouton' => 'Gestire l\'abbonamento',
            'bienvenueSujet' => 'La sua prova di Topograph Pro è iniziata',
            'bienvenue' => ['Buongiorno,', 'Topograph Pro è attivo sul suo conto. La prova gratuita dura fino al {date}.',
                'Se non disdice, l\'abbonamento inizia poi automaticamente: {prix}. Può disdire in qualsiasi momento in «Il mio account», poi «Gestire l\'abbonamento». Durante la prova non viene addebitato nulla.'],
            'actifSujet' => 'Il suo abbonamento Topograph Pro',
            'actif' => ['Buongiorno,', 'Grazie. Il suo abbonamento Topograph Pro è attivo: {prix}.',
                'Può cambiare formula, aggiornare la carta o disdire in qualsiasi momento in «Il mio account», poi «Gestire l\'abbonamento».'],
            'rappelSujet' => 'La sua prova di Topograph Pro termina il {date}',
            'rappel' => ['Buongiorno,', 'La prova gratuita di Topograph Pro termina il {date}. L\'abbonamento inizia allora automaticamente: {prix}, addebitato sulla carta registrata.',
                'Se non desidera continuare, disdica prima di questa data in «Il mio account», poi «Gestire l\'abbonamento». Non le sarà addebitato nulla.'],
            'impayeSujet' => 'Il pagamento del suo abbonamento non è andato a buon fine',
            'impaye' => ['Buongiorno,', 'Il pagamento del suo abbonamento Topograph Pro non è andato a buon fine. Riproveremo nei prossimi giorni.',
                'Per mantenere l\'accesso Pro, aggiorni la carta in «Il mio account», poi «Gestire l\'abbonamento».'],
            'note' => 'Le ricevute di pagamento sono inviate da Stripe. Condizioni di vendita: topograph.ch.',
        ],
        'en' => [
            'mois' => '{m} per month', 'annee' => '{m} per year',
            'bouton' => 'Manage my subscription',
            'bienvenueSujet' => 'Your Topograph Pro trial has started',
            'bienvenue' => ['Hello,', 'Topograph Pro is now active on your account. Your free trial runs until {date}.',
                'Unless you cancel, the subscription then starts automatically: {prix}. You can cancel at any time under "My account", then "Manage my subscription". Nothing is charged during the trial.'],
            'actifSujet' => 'Your Topograph Pro subscription',
            'actif' => ['Hello,', 'Thank you. Your Topograph Pro subscription is active: {prix}.',
                'You can switch plans, update your card or cancel at any time under "My account", then "Manage my subscription".'],
            'rappelSujet' => 'Your Topograph Pro trial ends on {date}',
            'rappel' => ['Hello,', 'Your free Topograph Pro trial ends on {date}. The subscription then starts automatically: {prix}, charged to the card on file.',
                'If you do not wish to continue, cancel before that date under "My account", then "Manage my subscription". Nothing will be charged.'],
            'impayeSujet' => 'Your subscription payment did not go through',
            'impaye' => ['Hello,', 'The payment for your Topograph Pro subscription did not go through. We will try again over the next few days.',
                'To keep Pro access, update your card under "My account", then "Manage my subscription".'],
            'note' => 'Stripe sends the payment receipts. Terms of sale: topograph.ch.',
        ],
    ];
    return $T[langue($l)];
}

/**
 * E-mail d'abonnement ('bienvenue', 'actif', 'rappel', 'impaye') pour une ligne de la table abonnements.
 * Le bouton ouvre la boîte du compte sur le site (le portail Stripe demande d'être connecté).
 */
function email_abonnement(string $quoi, array $abo): bool
{
    $q = bd()->prepare('SELECT email FROM comptes WHERE id = ?');
    $q->execute([$abo['compte_id']]);
    $email = (string) $q->fetchColumn();
    if ($email === '' || str_ends_with($email, '@invalid')) return false;
    $l = langue($abo['langue'] ?? null);
    $T = textes_abonnement($l);
    $annee = ($abo['intervalle'] ?? '') === 'year';
    $montant = (int) ($abo['montant'] ?? ($annee ? PRIX_ANNEE_CENTIMES : PRIX_MOIS_CENTIMES));
    $r = [
        '{prix}' => strtr($T[$annee ? 'annee' : 'mois'], ['{m}' => montant_texte($montant, (string) ($abo['devise'] ?? DEVISE))]),
        '{date}' => $abo['essai_fin'] ? date('d.m.Y', strtotime($abo['essai_fin'] . ' UTC')) : '',
    ];
    $f = fn(string $s) => strtr($s, $r);
    return email_sobre($email, $l, $f($T[$quoi . 'Sujet']), array_map($f, $T[$quoi]),
        [$T['bouton'], SITE_URL . '/?' . http_build_query(['compte' => 'abonnement', 'lang' => $l])], [$T['note']]);
}

// ---------------------------------------------------------------- newsletter : registre des accords
// Une ligne par décision (accord ou retrait), avec la date et la source : la preuve du consentement. Fichier hors du
// dossier du site (les mises en ligne ne l'effacent pas). Seules les adresses de comptes existants (adresse vérifiée par
// le lien de connexion) peuvent recevoir la newsletter : un accord donné sans connexion confirmée reste sans effet.
function newsletter_fichier(): string
{
    $d = dirname(__DIR__, 2) . '/donnees-topograph';
    if (!is_dir($d)) @mkdir($d, 0700, true);
    return "$d/newsletter.jsonl";
}

function newsletter_noter(string $email, bool $accord, string $source, string $langue = 'fr'): void
{
    file_put_contents(newsletter_fichier(), json_encode(['date' => gmdate('c'), 'email' => strtolower(trim($email)),
        'accord' => $accord, 'source' => $source, 'langue' => $langue, 'texte' => 'newsletter-2026-11'], JSON_UNESCAPED_UNICODE) . "\n",
        FILE_APPEND | LOCK_EX);
}

/** Dernière décision pour chaque adresse : [email => ['accord' => bool, 'date' => …, 'langue' => …]]. */
function newsletter_etat(): array
{
    $f = newsletter_fichier(); $etat = [];
    if (!is_file($f)) return $etat;
    foreach (file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $l) {
        $d = json_decode($l, true);
        if (is_array($d) && isset($d['email'])) $etat[$d['email']] = $d;
    }
    return $etat;
}

function newsletter_accord(string $email): bool
{
    return (bool) (newsletter_etat()[strtolower(trim($email))]['accord'] ?? false);
}

