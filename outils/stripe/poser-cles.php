<?php
// Exécuté sur le serveur (Infomaniak), puis effacé : lit la clé secrète Stripe et le secret du webhook sur l'entrée
// standard (jamais en argument ni dans un fichier), les écrit dans api/config.php et vérifie la clé auprès de Stripe.
$f = __DIR__ . '/sites/topograph.ch/api/config.php';
$sk = trim((string) fgets(STDIN));
$skSaisie = $sk !== '';
$wh = trim((string) fgets(STDIN));
// une réponse vide garde la valeur actuelle (on peut poser une clé maintenant, l'autre plus tard)
if ($sk === '' && $wh === '') { echo "Rien de saisi : rien n'a été changé.\n"; exit(1); }
if (($sk !== '' && !preg_match('/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/', $sk)) || ($wh !== '' && !preg_match('/^whsec_[A-Za-z0-9]+$/', $wh))) { echo "Format inattendu : rien n'a été changé.\n"; exit(1); }
$c = file_get_contents($f);
if ($sk !== '') { $c = preg_replace("/const STRIPE_CLE_SECRETE = '[^']*';/", "const STRIPE_CLE_SECRETE = '" . $sk . "';", $c, 1, $a); if (!$a) { echo "Ligne STRIPE_CLE_SECRETE introuvable : rien n'a été changé.\n"; exit(1); } }
if ($wh !== '') { $c = preg_replace("/const STRIPE_SECRET_WEBHOOK = '[^']*';/", "const STRIPE_SECRET_WEBHOOK = '" . $wh . "';", $c, 1, $b); if (!$b) { echo "Ligne STRIPE_SECRET_WEBHOOK introuvable : rien n'a été changé.\n"; exit(1); } }
if ($sk === '' && preg_match("/const STRIPE_CLE_SECRETE = '([^']*)';/", $c, $m)) $sk = $m[1]; // pour la vérification
copy($f, $f . '.avant-stripe');
file_put_contents($f, $c);
// vérification : la clé répond-elle ? (solde du compte, sans rien afficher de la clé)
$ch = curl_init('https://api.stripe.com/v1/balance');
curl_setopt_array($ch, [CURLOPT_USERPWD => $sk . ':', CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15]);
curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
echo ($skSaisie ? "Clé secrète enregistrée. " : "") . ($wh !== '' ? "Secret du webhook enregistré. " : "Secret du webhook : inchangé. ") . ($sk === '' ? "\n" : ($code === 200 ? " La clé Stripe est valide (" . (str_contains($sk, '_test_') ? 'mode test' : 'mode réel') . ").\n" : "Stripe refuse la clé (HTTP $code) : vérifiez-la.\n"));
@unlink($f . '.avant-stripe');
