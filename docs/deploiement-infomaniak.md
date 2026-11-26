# Déploiement chez Infomaniak — site, comptes et paiement

Hébergement web Infomaniak (PHP 8, MySQL/MariaDB, e-mail), domaine `topograph.ch` à remplacer par le domaine choisi.

## 1. Base de données

1. Manager → Hébergement web → **Bases de données** → Créer une base (ex. `xxxx_ombres`) et un utilisateur avec tous les droits sur cette base. Noter l'hôte (`xxxx.myd.infomaniak.com`).
2. Ouvrir **phpMyAdmin** → base → Importer → `api/schema.sql`. Cinq tables : `comptes`, `jetons`, `sessions`, `achats`, `demandes`.

## 2. Adresse d'envoi (SMTP)

1. Manager → Service Mail → créer `compte@topograph.ch` (mot de passe fort).
2. Paramètres SMTP : `mail.infomaniak.com`, port 465 (SSL), identifiant = l'adresse complète.
3. Ajouter les enregistrements SPF/DKIM proposés par Infomaniak (souvent automatiques si le domaine y est géré), sinon les liens finissent en indésirables.

## 3. Configuration de l'API

1. Copier `api/config.exemple.php` en `api/config.php` **sur le serveur seulement** (le fichier est ignoré par git).
2. Remplir : DSN, utilisateur et mot de passe de la base ; `SITE_URL` (`https://topograph.ch`) ; `API_URL` (`https://topograph.ch/api`) ; SMTP ; clés Stripe (étape 5). En production, `ORIGINE_DEV = ''`.
3. Droits : `chmod 600 api/config.php`. Le `.htaccess` d'`api/` bloque déjà l'accès à `config.php`, `_commun.php` et `schema.sql`.

## 4. Mise en ligne automatique (GitHub Actions → SSH)

Chaque **version** (tag `v…`) est construite par GitHub et envoyée sur l'hébergement par SSH (rsync) : `dist/` à la
racine du site, `api/` à côté. `api/config.php` n'est jamais envoyé ni effacé. Chaque version est aussi gardée comme
« release » GitHub (archive zip du site construit). Fichier : `.github/workflows/infomaniak.yml`.

**Une seule fois :**
1. Manager → Hébergement web → le site **topograph.ch** : noter son dossier (ex. `sites/topograph.ch`) ; PHP **8.2 ou
   plus** ; certificat **Let's Encrypt** activé ; redirection HTTPS forcée.
2. Manager → Hébergement web → **FTP / SSH** : créer (ou choisir) un utilisateur avec l'accès **SSH** ; noter le
   serveur (ex. `xxxx.ftp.infomaniak.com`) et l'utilisateur. Le mot de passe reste chez vous.
3. Sur cet utilisateur : **Clés SSH → Ajouter**, coller la clé publique de déploiement
   (`~/.ssh/topograph_deploiement.pub` sur le Mac).
4. Secrets du dépôt GitHub (Settings → Secrets and variables → Actions), ou en ligne de commande :
   ```
   gh secret set INFOMANIAK_CLE_SSH --repo AtelierMasson/ombres-suisse < ~/.ssh/topograph_deploiement
   gh secret set INFOMANIAK_HOTE --repo AtelierMasson/ombres-suisse --body "xxxx.ftp.infomaniak.com"
   gh secret set INFOMANIAK_UTILISATEUR --repo AtelierMasson/ombres-suisse --body "utilisateur"
   gh secret set INFOMANIAK_DOSSIER --repo AtelierMasson/ombres-suisse --body "sites/topograph.ch"
   ```

**À chaque version :** `npm run publier` (crée le tag du jour, ex. `v2026.11.26`, et l'envoie). Le suivi est dans
l'onglet *Actions* du dépôt ; le site affiche la version publiée dans `https://topograph.ch/version.txt`.

**Revenir à une version précédente :** Actions → « Déployer sur Infomaniak » → *Run workflow* → indiquer le tag.

**Aperçu :** chaque envoi sur `main` reste publié sur GitHub Pages (`ateliermasson.github.io/ombres-suisse`), sans
compte ni paiement ; la production (topograph.ch) ne change qu'à la création d'une version.

Vérifier ensuite : `https://topograph.ch/api/moi.php` doit répondre `{"erreur":"non_connecte"}` (401) ;
`https://topograph.ch/api/config.php` doit répondre 403.

## 5. Stripe — mode test

1. Compte Stripe au nom d'Atelier Masson, pays Suisse, devise CHF. Rester en **mode test**.
2. Paramètres → **Moyens de paiement** : activer les cartes et **TWINT** (TWINT peut demander une validation de Stripe ; en test il est disponible tout de suite).
3. Paramètres → E-mails clients : activer **« Paiements réussis »** (reçu automatique).
4. Développeurs → Clés API : copier `sk_test_…` dans `STRIPE_CLE_SECRETE`. Aucun produit à créer : le prix (CHF 39.–) et le nom viennent de `config.php`.
5. Développeurs → **Webhooks** → Ajouter un point de terminaison :
   - URL : `https://topograph.ch/api/webhook.php` ;
   - événements : `checkout.session.completed` et `checkout.session.async_payment_succeeded` ;
   - copier le secret de signature `whsec_…` dans `STRIPE_SECRET_WEBHOOK`.

## 6. Tests (mode test)

1. Sur le site, « Compte » → saisir son e-mail → lien reçu → connecté, statut **Gratuit**.
2. « Passer pro — CHF 39.– » → page Stripe :
   - carte `4242 4242 4242 4242`, date future, CVC quelconque → retour sur le site, statut **Pro** en quelques secondes ;
   - carte refusée `4000 0000 0000 0002` → message d'erreur chez Stripe, compte inchangé ;
   - 3-D Secure `4000 0025 0000 3155` ;
   - **TWINT** : choisir TWINT, puis « Autoriser » sur la page de test Stripe.
3. Stripe → Webhooks → le point de terminaison : les envois doivent être en **200**. « Renvoyer » un événement ne change rien (idempotent).
4. phpMyAdmin : `comptes.pro = 1`, `achete_le` rempli, ligne `achats` en `paye`.
5. Lien expiré (attendre 15 min) ou déjà utilisé → message « lien expiré » sur le site.

## 7. Passage en réel

1. Stripe : compléter l'activation du compte (IDE ou identité, IBAN), confirmer TWINT actif en mode réel.
2. Refaire l'étape 5 en **mode réel** : `sk_live_…` et un **nouveau** webhook (son secret `whsec_…` est différent).
3. Un achat réel de CHF 39.–, puis remboursement depuis Stripe si souhaité (le statut pro reste ; le retirer à la main dans `comptes` si nécessaire).
4. Mettre à jour les mentions légales (hébergeur : Infomaniak Network SA, Genève), la confidentialité (Infomaniak, Stripe) et les conditions de vente.

## Développement local

- Site : `npm run dev` (http://localhost:5199).
- API : `php -S localhost:8080 -t api` avec un `config.php` local (`SITE_URL = 'http://localhost:5199'`, `API_URL = 'http://localhost:8080'`, `ORIGINE_DEV = 'http://localhost:5199'`) et une base MySQL locale ; brancher le module avec `api: "http://localhost:8080"`.
- Les deux ports sont sur le même site (`localhost`), le cookie SameSite=Lax passe. Chrome et Firefox acceptent le cookie Secure sur `http://localhost` ; pour Safari, mettre `COOKIE_SECURE = false` en local.
- Webhook en local : Stripe CLI, `stripe listen --forward-to localhost:8080/webhook.php`, qui affiche le secret `whsec_…` à utiliser.
- E-mail en local : le SMTP Infomaniak fonctionne aussi depuis chez soi (mêmes réglages) ; seul le haché du jeton est en base, le lien ne peut donc se lire que dans l'e-mail.
