# Plan — version pro (vente unique CHF 39.–)

Atelier Masson · brouillon du 26.11.2026

## 1. Trois niveaux, sans menu

| | Sans compte | Compte gratuit | Pro — CHF 39.– une fois |
|---|---|---|---|
| Maquette 3D, ombres, course du soleil | ✓ | ✓ | ✓ |
| Coupe à l'écran | ✓ | ✓ | ✓ |
| Heures de soleil — jour | ✓ | ✓ | ✓ |
| Heures de soleil — mois, année | | ✓ | ✓ |
| Lieux enregistrés (liste simple) | | ✓ | ✓ |
| Masquer des bâtiments, maquette jusqu'à 800 m | | | ✓ |
| Exports maquette (DXF, OBJ, glTF, STL) et coupe (DXF, SVG) | | | ✓ |
| Extrait A4 | | | ✓ |
| **Analyse solaire de toute la maquette** : sol, toits et façades ; heures et rayonnement | | | ✓ |
| **Analyse différentielle** : ombre en plus due au projet, où et combien | | | ✓ |
| **Projets** : ajouter ses bâtiments (volume dessiné ou modèle 3D importé), avant / après | | | ✓ |
| Publicité | oui | oui | non |

Il n'y a pas d'abonnement ni de renouvellement. L'achat vaut à vie pour le compte, y compris les mises à jour.

## 2. Compte : un seul écran

- **Connexion** : on saisit son e-mail et on reçoit un lien. Il n'y a pas de mot de passe.
- **Écran unique** : un bouton « Compte » dans la barre du haut ouvre une petite boîte (le même modèle que les pages légales). Elle contient :
  - l'e-mail ;
  - le statut (Gratuit / Pro) ;
  - le bouton « Passer pro — CHF 39.– » ;
  - le bouton « Se déconnecter ».
- **Ce qui n'existe pas** : pas de profil, de paramètres, de factures à l'écran (le reçu part par e-mail) ni de sous-menus.
- **Fonction pro cliquée sans être pro** : la même boîte s'ouvre directement sur l'achat. Il n'y a pas de page de tarifs séparée.

## 2 bis. Projets (cœur de la version pro)

Un **projet** est un lieu sur lequel on ajoute ou retire des bâtiments, pour voir l'effet sur les ombres et le soleil. Il enregistre :
- le lieu et la taille de la maquette ;
- la date et l'heure affichées ;
- les bâtiments masqués ;
- les bâtiments ajoutés ;
- la ligne de coupe.

**Où on les trouve, sans menu**
- L'onglet Pro commence par la liste des projets et un bouton « Nouveau projet sur ce lieu ».
- Ouvrir un projet charge le lieu et son état.
- Le nom du projet s'affiche à la place du nom du lieu en haut du panneau.

**Ajouter un bâtiment : deux boutons, « Dessiner un volume » et « Importer un modèle »**

1. **Dessiner un volume**
   - On clique les coins sur la maquette, en vue plan conseillée. Un rectangle se fait en trois clics (deux pour le côté, un pour la profondeur), un polygone en cliquant chaque coin.
   - Le volume s'oriente automatiquement sur la parcelle et les bâtiments voisins.
   - On règle ensuite :
     - la hauteur à la corniche (ou le nombre d'étages × 3 m) ;
     - le toit : plat, deux pans (faîte et hauteur), quatre pans ou un pan ;
     - la base : posée sur le terrain (point le plus bas ou le plus haut) ou à une altitude donnée.
   - Des poignées permettent de déplacer, tourner et étirer le volume. Les cotes s'affichent pendant le dessin.
   - **Fait (emprise libre)** : bouton « Emprise libre », un clic par coin ; on ferme par un clic sur le premier point,
     un double-clic ou Entrée ; Retour arrière retire le dernier point, Échap annule. Chaque côté s'accroche (à 4° près)
     à l'angle droit sur le premier côté et à l'orientation de la parcelle, des bâtiments voisins et des autres volumes ;
     sa longueur s'arrondit à 10 cm (au mètre avec Maj). Les longueurs sont cotées pendant le dessin (« ⊥ » quand le
     côté est accroché) et un côté qui recoupe le tracé est refusé. Le tracé reste drapé sur le terrain.
   - Les volumes à emprise libre ont les mêmes réglages que les rectangles (étages, corniche, base, opacité, couleur) et
     vont partout (ombres, heures de soleil, coupe, vue plan, exports, impression 3D, projet enregistré). Toit plat
     seulement : les toits à pans restent réservés aux rectangles (options grisées sinon). Format enregistré : mêmes
     `coins` (sens trigonométrique), plus `libre: true` ; les anciens projets s'ouvrent sans changement.
   - **Fait (pousser-tirer)** : sur le volume choisi, tirer un mur le déplace le long de sa normale (les murs voisins
     s'allongent ou se raccourcissent, l'emprise ne peut pas se retourner) ; tirer le toit change la corniche. Pour une
     emprise libre, les coins se tirent (accrochés aux angles droits du volume), le « + » au milieu d'un côté ajoute un
     coin, un double-clic ou Alt + clic sur un coin le retire. Pas de 10 cm (1 m avec Maj, 15° pour la rotation) ; la
     cote du geste s'affiche, et une valeur tapée puis Entrée refait le dernier geste à la cote exacte (distance du mur,
     hauteur de corniche, angle, déplacement). Annuler / rétablir : Ctrl+Z, Ctrl+Maj+Z (ou Ctrl+Y) et boutons ↶ ↷ ; chaque
     changement validé des volumes est une étape.
2. **Importer un modèle**
   - **Formats** : glTF/GLB, OBJ, STL, DXF (faces 3D) et, plus tard, IFC.
   - **Écran d'import, une seule boîte** :
     - « Télécharger la parcelle pour un placement exact » : un DXF et un 3DM/OBJ de référence contenant la limite de parcelle, les bâtiments voisins, les courbes de niveau, le terrain, et un repère d'origine avec ses coordonnées MN95 et son altitude. On modélise dans son logiciel par-dessus, puis on réimporte, et la position tombe juste.
     - Le choix du fichier.
     - Les unités : m, cm ou mm, détectées si possible.
     - Les coordonnées du fichier : origine de la parcelle de référence, ou MN95 complètes.
     - Un aperçu.
   - **Placement automatique par la parcelle** : on importe son modèle avec la limite de parcelle dessinée dedans (celle du DXF de référence, ou la sienne, dans n'importe quel repère local). Le site :
     - reconnaît ce contour (calque nommé « parcelle », ou la polyligne fermée qui ressemble le plus au cadastre) ;
     - calcule la rotation et le déplacement qui le superposent au cadastre officiel, ainsi que l'échelle si les unités diffèrent ;
     - applique cette transformation au bâtiment, qui tombe exactement à sa place ;
     - n'affiche pas le contour importé, qui ne sert que de repère.
     L'écart restant s'affiche (par exemple « ajusté à 3 cm près »). S'il dépasse 50 cm, le site le signale.
     Le placement sert aussi pour l'altitude, si le fichier contient un point coté ou les courbes de référence.
   - Les poignées restent disponibles pour un ajustement manuel (déplacer, tourner, hauteur).
   - **Calque « sections »** : si le fichier importé (DWG, DXF), géoréférencé ou recalé par la parcelle, contient un calque nommé « sections » (ou « coupes », « Schnitte »), chaque ligne de ce calque devient une coupe du projet, avec ses lettres (A–B, C–D…). Si la ligne porte un texte ou un nom de bloc, il devient le nom de la coupe. Les coupes de l'architecte sont ainsi reprises telles quelles, et elles se mettent à jour à chaque nouvel import.

**Supprimer des bâtiments**
- **Bâtiments existants** : on les sélectionne (clic, Majuscule + clic, ou « tous les bâtiments de la parcelle »), puis « Démolir ».
  - Ils disparaissent de la maquette, des ombres, des heures de soleil, de la coupe et des exports.
  - Le terrain sous leur emprise est refait à partir du sol autour.
  - Ils restent listés dans le projet (« 2 bâtiments démolis »), on peut les rétablir un par un, et ils réapparaissent dans la vue « avant ».
- **Bâtiments ajoutés** (volumes ou modèles importés) : sélection, puis « Supprimer » ou la touche Suppr.
- Annuler et rétablir (Cmd+Z, Cmd+Maj+Z) fonctionnent pour toutes les modifications du projet.

**Analyses avec le projet**
- Les bâtiments ajoutés portent des ombres et entrent dans les heures de soleil et dans la coupe.
- Un bouton « Avant / après » bascule entre l'existant et le projet.
- Une carte de différence montre les heures de soleil perdues chez les voisins (utile pour les oppositions et les mises à l'enquête).
- Le projet est inclus dans les exports DXF, OBJ et glTF.

**Analyse solaire de toute la maquette**
- **Couverture** : la version gratuite calcule les heures de soleil sur la parcelle ; la version pro les calcule sur toute la maquette (terrain, toits et façades, existant et projet).
- **Deux mesures** :
  - les **heures de soleil** (jour, mois, année) ;
  - le **rayonnement reçu** en kWh/m², pour l'année ou une saison. Il tient compte de l'inclinaison de chaque surface, du relief lointain et des données climatiques moyennes de MétéoSuisse.
- **Résultats** :
  - une carte de couleurs posée sur la maquette, avec une légende et une valeur au survol ;
  - pour chaque toit, la surface bien exposée et le potentiel solaire estimé en kWh par an, avec la mention « pour orienter une étude, pas pour dimensionner une installation » ;
  - pour chaque façade, les heures de soleil en hiver, utiles pour les vitrages et le confort.
- **Calcul** : dans le navigateur, avec le même moteur que les heures de soleil actuelles, réparti sur plusieurs workers. Une barre de progression s'affiche, et on peut choisir la finesse (1 m ou 0,5 m).
- **Avec un projet** : la même carte en mode avant / après, et la différence (gain ou perte) sur les voisins.
- **Export** : une image ou un PDF de la carte, et un CSV par toit et par façade.

**Analyse différentielle (avant / après)**
Exemple : on ajoute une tour. Où y aura-t-il plus d'ombre, et combien ?
- **Deux sorties** :
  - la **vue dans la maquette 3D** : la carte de différence est posée directement sur le terrain, les toits et les façades ; on tourne autour, on survole un point pour lire sa valeur, et on change de date ;
  - le **rapport** : un document PDF prêt à joindre à un dossier (vues 3D et en plan de la différence, tableau des voisins, courbes avant / après par parcelle, hypothèses et dates). Voir le détail plus bas.
- **Calcul** : les heures de soleil sont calculées deux fois sur toute la maquette, sans le projet puis avec. La différence est faite point par point.
- **Carte** :
  - rouge pour les heures de soleil perdues ;
  - vert pour les heures gagnées, par exemple après une démolition ;
  - gris pour ce qui ne change pas.
- **Période** : un jour (par défaut le 21 décembre, le 21 mars et le 21 juin, les dates usuelles en Suisse), un mois ou l'année.
- **Chiffres** :
  - la surface touchée, en m², au sol et sur les façades ;
  - la perte moyenne et la perte maximale, en heures par jour ;
  - un tableau par parcelle voisine et par bâtiment voisin (numéro de parcelle, adresse, heures perdues sur les façades et les fenêtres principales, part de la parcelle à l'ombre en plus).
- **Ombre portée heure par heure** : la nouvelle ombre seule, superposée en couleur sur l'existant, que l'on peut animer sur la journée.
- **Export** : un PDF A4 (carte, tableau des voisins, dates et heures, mention « indicatif »), utile pour une mise à l'enquête ou pour répondre à une opposition. Aussi en CSV.
- Le calcul se fait dans le navigateur, avec le même moteur que les heures de soleil.

**Stockage**
- Phase 1 : dans le navigateur (IndexedDB), avec la possibilité d'enregistrer ou d'ouvrir un fichier `.projet` qui regroupe l'état et les modèles importés.
- Phase 2 : synchronisé avec le compte, dans MySQL et dans un dossier de fichiers chez Infomaniak, pour retrouver ses projets sur un autre ordinateur.

## 3. Paiement : recommandation

**Stripe Checkout**, en CHF, avec TWINT et les cartes.

- **Pourquoi Stripe** :
  - il propose TWINT en Suisse, une fois l'activation validée par Stripe ;
  - la page de paiement est hébergée, donc aucun formulaire de carte sur le site ;
  - le reçu est automatique ;
  - les webhooks sont fiables et l'intégration avec la base de comptes est documentée.
- **Frais sur CHF 39.–** : de l'ordre de CHF 1.– à 1.50 par vente. À vérifier sur la page de tarifs suisse de Stripe : je n'ai pas pu confirmer le taux TWINT propre à Stripe.
- **Alternative suisse : Payrexx**. TWINT y coûte environ 1,3 % + CHF 0.30, soit environ CHF 0.80 par vente sur l'offre gratuite. Elle est intéressante si l'on veut un prestataire suisse et des frais TWINT plus bas, mais l'intégration est un peu plus manuelle.
- **Écartés** :
  - Lemon Squeezy et Paddle (« merchant of record ») : utiles pour la TVA internationale, inutile ici puisque les ventes sont en Suisse, et pas de TWINT confirmé ;
  - abonnements.
- **TVA** : l'assujettissement n'est obligatoire qu'au-delà de CHF 100 000.– de chiffre d'affaires annuel. À confirmer avec la fiduciaire selon la forme de l'Atelier.

## 4. Technique : tout chez Infomaniak

Le site quitte GitHub Pages pour un hébergement web Infomaniak, sur le domaine .ch choisi. Les données des comptes restent ainsi en Suisse, ce qui simplifie la LPD.

- **Fichiers statiques** : le résultat de `npm run build` (dossier `dist/`), envoyé par SFTP ou par un déploiement Git automatique.
- **Comptes et base** : MySQL d'Infomaniak, avec une table `comptes (id, email, pro, achete_le)` et une table `jetons (email, jeton, expire)` pour les liens de connexion.
- **Petite API en PHP** dans `api/`, environ 200 lignes :
  - `connexion.php` : envoie le lien par e-mail avec le SMTP Infomaniak ;
  - `session.php` : vérifie le jeton et pose un cookie de session ;
  - `moi.php` : renvoie l'e-mail et le statut ;
  - `achat.php` : crée la session Stripe Checkout ;
  - `webhook.php` : quand Stripe confirme le paiement, met `pro = 1`.
- **Achat** : le bouton appelle `achat.php`, Stripe affiche le paiement, `webhook.php` passe le compte en pro, puis au retour sur le site le statut est relu.
- **Côté site** : un module `src/compte.js` d'environ 120 lignes, sans dépendance.
- **Alternative** si l'on ne veut pas de PHP : Supabase, avec des données en Europe mais hors de Suisse.
- **Protection** : tout se calcule dans le navigateur, donc un utilisateur averti peut contourner le verrou. C'est acceptable à CHF 39.– :
  - on ne met pas en place de DRM ;
  - les exports portent la mention « Atelier Masson — licence pro ».
- **Coûts fixes** : l'hébergement web Infomaniak (quelques francs par mois, base MySQL et e-mail compris) et le domaine .ch. Stripe ne facture que par vente.

## 5. Publicité (Google AdSense)

- **Emplacement** : un cadre réservé en bas du panneau principal, visible seulement sans pro.
- **Consentement** : en Suisse, Google exige une plateforme de consentement certifiée (CMP), comme dans l'UE. Il faut afficher un bandeau de cookies, et sans accord on ne charge que des annonces non personnalisées.
- **Déclaration de confidentialité** : il faudra retirer « aucun cookie publicitaire » et ajouter Google comme destinataire.
- **Approbation** : AdSense valide d'abord le site, ce qui demande un domaine à soi plutôt que github.io.

## 6. Textes à ajouter

- **Conditions de vente** : prix TTC, licence personnelle et non transférable, mises à jour comprises, pas de remboursement après utilisation des fonctions pro (il n'y a pas de droit de rétractation légal en Suisse pour l'achat en ligne ; un geste de 14 jours est possible).
- **Confidentialité** : hébergement et e-mail du compte chez Infomaniak (en Suisse), paiement (Stripe), publicité (Google).
- **Mentions légales** : compléter l'adresse, l'e-mail et le numéro IDE de l'Atelier s'il existe.

## 7. Étapes

1. Choisir le nom, puis acheter le domaine .ch et l'hébergement web chez Infomaniak.
2. Mettre le site statique en ligne sur le domaine, puis mettre à jour les mentions légales : l'hébergeur devient Infomaniak Network SA, à Genève.
3. Créer le compte Stripe au nom d'Atelier Masson et demander l'activation de TWINT.
4. Coder `compte.js`, l'API PHP et le webhook, et poser les verrous sur les fonctions pro.
5. Ajouter les conditions de vente et mettre à jour la confidentialité.
6. Tester en mode test Stripe, avec carte et TWINT de test.
7. Faire la demande AdSense et ajouter le CMP, une fois le domaine en ligne.

## À décider

- Le partage gratuit / pro du tableau ci-dessus.
- Stripe ou Payrexx.
- Faut-il un compte pour acheter, ou un simple code de licence par e-mail ? Le compte est plus simple pour retrouver son achat sur un autre ordinateur.
