<?php
// Boîte à suggestions : un message libre (et un e-mail facultatif pour une réponse), gardé dans un fichier hors du
// dossier du site, et signalé par e-mail à l'adresse de contact. Limite de débit dans la base (table demandes).
declare(strict_types=1);
require __DIR__ . '/_commun.php';

// POST d'une origine admise seulement (une page tierce ne peut pas faire envoyer des suggestions par ses visiteurs),
// et en JSON : un formulaire HTML d'un autre site ne peut pas produire ce type sans contrôle préalable du navigateur
entree('POST');
if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) json(415, ['erreur' => 'type']);
$d = json_decode((string) file_get_contents('php://input', false, null, 0, 20000), true);
if (!is_array($d)) json(400, ['erreur' => 'texte']);
$texte = trim((string) ($d['texte'] ?? ''));
$email = trim((string) ($d['email'] ?? ''));
if ($texte === '' || mb_strlen($texte) > 3000) { http_response_code(400); exit('{"erreur":"texte"}'); }
if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) { http_response_code(400); exit('{"erreur":"email"}'); }
if (!empty($d['piege'])) { exit('{"ok":true}'); } // champ caché rempli : robot

// fichier hors du site (les mises en ligne effacent le dossier du site, pas celui-ci)
$dossier = dirname(__DIR__, 2) . '/donnees-topograph';
if (!is_dir($dossier)) @mkdir($dossier, 0700, true);

// au plus 5 messages par heure et par adresse IP (empreinte seulement), compté dans la base : sans course entre requêtes
if (trop_de_demandes('suggestion', 5)) { http_response_code(429); exit('{"erreur":"trop"}'); }

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
@envoyer_email(defined('CONTACT_EMAIL') ? CONTACT_EMAIL : 'contact@topograph.ch', 'Topograph — suggestion', $corps);

echo '{"ok":true}';
