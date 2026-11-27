# Audit légal et sécurité — topograph.ch (27 novembre 2026)

Audit en lecture seule (code, site public, en-têtes, DNS, `npm audit`). Pas un avis juridique : faire relire CGV et TVA
par un fiduciaire ou un juriste.

**Socle de sécurité de l'API sain** : SQL préparé, jetons et sessions de 256 bits hachés, lien unique 15 min validé
par POST, cookie HttpOnly/Secure/SameSite=Lax, webhook Stripe vérifié (HMAC), fichiers internes refusés, 0 vulnérabilité npm.

## Bloquant (avant vente ou publicité)
- **B1 Mentions légales** : champs `[adresse]`, `[NPA localité]`, `[email]`, `[localité]` encore en ligne (fr.js ~508-525,
  et les 3 autres langues). Il faut raison sociale, adresse, e-mail, IDE (CHE-…) et n° TVA s'il y a lieu (LCD art. 3 al. 1 let. s).
- **B2 Confidentialité fausse et incomplète** : cite GitHub Pages au lieu d'Infomaniak, dit qu'aucune donnée n'est
  envoyée ; manquent comptes, profil, lieux, Stripe, suggestions, journaux, cookies, transferts, durées, droits (nLPD
  art. 19-21, RGPD art. 13).
- **B3 CGV de l'offre Pro absentes** ; « à vie » ambigu ; pas de case d'acceptation ni de renonciation au droit de
  rétractation (clients UE, directive 2011/83 art. 16 m) ; garder la trace (date, version) dans `achats`.
- **B4 TVA** : services électroniques aux consommateurs UE/UK taxables dès le 1er euro (OSS non-Union) ; choisir :
  vente limitée à la Suisse, OSS + Stripe Tax, ou Merchant of Record (Paddle, Lemon Squeezy) ; factures conformes.
- **B5 Suppression de compte** absente (nLPD art. 32, RGPD art. 17) ; `achats.compte_id` sans `ON DELETE CASCADE`.

## Important
- I1 Suggestions envoyées par `mail()` sans enveloppe alignée : rejet DMARC (p=reject) → passer par `envoyer_email()`,
  activer DKIM, ajouter `rua` au DMARC.
- I2 Aucun en-tête de sécurité HTML (CSP, frame-ancestors, nosniff, Referrer-Policy, Permissions-Policy, HSTS 1 an).
- I3 Données externes dans `innerHTML` non échappées : pro.js (nom de parcelle, nom de fichier importé), fiche.js
  (`geoportal_url` sans contrôle du schéma).
- I4 Sessions fixes de 180 jours, sans « fermer toutes les sessions » ni rotation ; préfixe `__Host-` conseillé.
- I5 Administration liée à la boîte mail expéditrice : adresse dédiée avec 2FA, journal des actions.
- I6 IP hachées sans sel secret (réversibles) ; suggestions conservées sans limite.
- I7 Déploiement : `ssh-keyscan` à chaque exécution, `inputs.version` interpolé dans le shell, actions non épinglées par SHA.
- I8 Attributions : citer MO Vaud / geodienste.ch et les sources de Terrain Tiles (Mapzen, SRTM, ETOPO1…).

## Souhaitable
`ORIGINE_DEV` vide en production ; suggestion.php sans `_commun.php` ; pas de limite sur evenement.php ; CSRF de
connexion (lien transféré) ; version.txt public ; aperçu GitHub Pages obsolète (noindex) ; webhook : remboursements ;
stockage local à lister (nécessaire, sans consentement) ; représentant UE (art. 27) à évaluer ; registre des traitements.

## Avant AdSense
CMP certifiée TCF v2.2 (module « Confidentialité et messages » d'AdSense), rien de Google avant le choix, lien pour
revenir sur le choix ; déclaration mise à jour (Google, cookies, consentement) ; `public/ads.txt` avec l'identifiant
d'éditeur ; un bloc manuel hors du canevas 3D (pas d'annonces automatiques) ; pages de contenu (risque « faible
valeur ») ; CSP élargie aux domaines Google ; pas d'annonces pour les comptes Pro (« sans publicité »).

## 10 actions dans l'ordre
1. Mentions légales et contact complets, hébergeur corrigé (4 langues). 2. Déclaration de confidentialité réécrite.
3. CGV Pro + case d'acceptation et de renonciation, trace en base. 4. TVA UE tranchée, factures. 5. Suppression de
compte. 6. En-têtes de sécurité. 7. Suggestions par SMTP, DKIM, DMARC rua. 8. Échappement pro.js / fiche.js.
9. Administration et déploiement renforcés. 10. AdSense : CMP, déclaration, ads.txt, bloc manuel, Pro sans pub, CSP.
