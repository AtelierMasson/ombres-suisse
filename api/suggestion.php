<?php
// Boîte à suggestions : un message libre (et un e-mail facultatif pour une réponse), gardé dans un fichier hors du
// dossier du site, et signalé par e-mail à l'adresse de contact. Ne dépend pas de la base des comptes.
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$origine = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origine, ['https://topograph.ch', 'http://localhost:5199'], true)) {
    header("Access-Control-Allow-Origin: $origine");
    header('Access-Control-Allow-Headers: Content-Type');
    header('Vary: Origin');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') { http_response_code(405); exit('{"erreur":"methode"}'); }

$d = json_decode((string) file_get_contents('php://input', false, null, 0, 20000), true);
$texte = trim((string) ($d['texte'] ?? ''));
$email = trim((string) ($d['email'] ?? ''));
if ($texte === '' || mb_strlen($texte) > 3000) { http_response_code(400); exit('{"erreur":"texte"}'); }
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) { http_response_code(400); exit('{"erreur":"email"}'); }
if (!empty($d['piege'])) { exit('{"ok":true}'); } // champ caché rempli : robot

// fichier hors du site (les mises en ligne effacent le dossier du site, pas celui-ci)
$dossier = dirname(__DIR__, 2) . '/donnees-topograph';
if (!is_dir($dossier)) @mkdir($dossier, 0700, true);

// au plus 5 messages par heure et par adresse IP (empreinte seulement, pas l'adresse elle-même)
$ip = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . 'topograph');
$limites = "$dossier/limites-suggestions.json";
$L = is_file($limites) ? (json_decode((string) file_get_contents($limites), true) ?: []) : [];
$maintenant = time();
$L = array_filter($L, fn($t) => is_array($t) && $maintenant - max($t) < 3600);
$L[$ip] = array_values(array_filter($L[$ip] ?? [], fn($t) => $maintenant - $t < 3600));
if (count($L[$ip]) >= 5) { http_response_code(429); exit('{"erreur":"trop"}'); }
$L[$ip][] = $maintenant;
file_put_contents($limites, json_encode($L), LOCK_EX);

$entree = [
    'date' => gmdate('c'),
    'texte' => $texte,
    'email' => $email,
    'lieu' => mb_substr((string) ($d['lieu'] ?? ''), 0, 300),
    'langue' => mb_substr((string) ($d['langue'] ?? ''), 0, 5),
    'navigateur' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200),
];
file_put_contents("$dossier/suggestions.jsonl", json_encode($entree, JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND | LOCK_EX);

// signalement par e-mail (au mieux : l'enregistrement ci-dessus fait foi)
$corps = $texte . "\n\n—\n" . ($email !== '' ? "Répondre à : $email\n" : '') . "Lieu : {$entree['lieu']}\nLangue : {$entree['langue']}\n";
// par le SMTP authentifié de l'API (aligné SPF/DKIM) : mail() sans enveloppe alignée était rejeté par DMARC
if (is_file(__DIR__ . '/config.php')) {
    require_once __DIR__ . '/_commun.php';
    @envoyer_email(defined('CONTACT_EMAIL') ? CONTACT_EMAIL : 'contact@topograph.ch', 'Topograph — suggestion', $corps);
}

echo '{"ok":true}';
