<?php
// Rapport de bug (comptes administrateurs seulement) : capture de la vue 3D, commentaire et état de l'application en
// JSON, gardés hors du dossier du site (donnees-topograph/rapports/). Les mises en ligne n'y touchent pas.
// POST { commentaire, image: "data:image/jpeg;base64,…", etat: {…} } → 200 { ok, id }
// GET  → 200 { rapports: [{ id, date, commentaire, lieu }] } (les 100 derniers)
declare(strict_types=1);
require __DIR__ . '/_commun.php';

$m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
entree($m === 'POST' ? 'POST' : 'GET');
$moi = exiger_compte();
$admins = array_map('strtolower', defined('ADMIN_EMAILS') ? ADMIN_EMAILS : []);
if (!in_array(strtolower($moi['email']), $admins, true)) json(403, ['erreur' => 'pas_admin']);

$dossier = dirname(__DIR__, 2) . '/donnees-topograph/rapports';
if (!is_dir($dossier)) @mkdir($dossier, 0700, true);

if ($m === 'GET') {
    $liste = [];
    foreach (array_slice(array_reverse(glob("$dossier/*.json") ?: []), 0, 100) as $f) {
        $d = json_decode((string) file_get_contents($f), true) ?: [];
        $liste[] = ['id' => basename($f, '.json'), 'date' => $d['date'] ?? '', 'commentaire' => $d['commentaire'] ?? '', 'lieu' => $d['etat']['adresse'] ?? ''];
    }
    json(200, ['rapports' => $liste]);
}

$brut = (string) file_get_contents('php://input', false, null, 0, 12_000_001);
if (strlen($brut) > 12_000_000) json(413, ['erreur' => 'trop_gros']);
$d = json_decode($brut, true);
if (!is_array($d)) json(400, ['erreur' => 'json']);
$commentaire = mb_substr(trim((string) ($d['commentaire'] ?? '')), 0, 5000);
$etat = is_array($d['etat'] ?? null) ? $d['etat'] : [];

$id = gmdate('Ymd-His') . '-' . bin2hex(random_bytes(3));
$image = (string) ($d['image'] ?? '');
$avecImage = false;
if (preg_match('#^data:image/(jpeg|png);base64,#', $image, $t)) {
    $octets = base64_decode(substr($image, strlen($t[0])), true);
    // contrôle : une vraie image JPEG ou PNG (rien d'autre n'est écrit sur le disque)
    if ($octets !== false && @getimagesizefromstring($octets) !== false) {
        file_put_contents("$dossier/$id." . ($t[1] === 'png' ? 'png' : 'jpg'), $octets, LOCK_EX);
        $avecImage = true;
    }
}
file_put_contents("$dossier/$id.json", json_encode([
    'id' => $id, 'date' => gmdate('c'), 'auteur' => $moi['email'], 'commentaire' => $commentaire,
    'image' => $avecImage, 'etat' => $etat,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), LOCK_EX);
json(200, ['ok' => true, 'id' => $id]);
