# Plan : projets dans le compte, organisations, variantes et pages publiques

Plan de conception, sans code. Rédigé le 27.11.2026 à partir du code actuel.

## 1. Ce qui est demandé

1. Les projets vivent dans le compte, plus seulement dans le navigateur.
2. Un compte Pro peut créer une organisation ou en rejoindre une. Tous les membres voient les projets de l'organisation. Plusieurs personnes peuvent travailler sur le même projet.
3. Un compte Pro peut publier un projet à une adresse publique. La page est presque sans interface. Le visiteur tourne autour, active des variantes et, si l'auteur le permet, fait des coupes.
4. Tout cela est visible mais grisé pour un compte non Pro.

## 2. État actuel (lu dans le code)

**Projet local.** `src/projet.js` enregistre une liste dans `localStorage`, clé `ombres.projets`. Un projet contient :

| Champ | Contenu |
|---|---|
| `id` | identifiant local (heure + aléa) |
| `nom` | nom saisi par l'utilisateur |
| `hash` | lieu : fragment d'adresse `#e=…&n=…&l=…&t=…` |
| `jour`, `rayon` | date du soleil, rayon de la zone |
| `caches` | groupes de bâtiments masqués : `{ id, ids[], visible, nom }` |
| `volumes` | volumes dessinés : `{ id, coins, base, etages, hauteur, toit, pente, sensFaite, unitePente, opacite, couleur, visible }` |
| `coupes` | `{ A, B }` |
| `modifie` | date ISO |

**Limites constatées, à traiter dans ce chantier.**

- Les `id` des volumes sont un compteur local (1, 2, 3…). Deux personnes créeraient chacune le « volume 4 ». Il faut un identifiant stable et unique par élément.
- Les coupes n'ont pas d'identifiant.
- Les `ids` des bâtiments masqués sont des indices dans le relevé chargé (`V.bati`, `V.parBati`). Ils dépendent probablement du rayon et de la version des données. **À vérifier avant tout.** Si ces indices ne sont pas stables, un projet rouvert plus tard ou sur la page publique masquera les mauvais bâtiments. Solution prévue : stocker aussi une empreinte géographique (centre et surface de l'emprise, ou EGID quand il existe) et retrouver le bâtiment par elle.
- Les modèles importés (`P.imports`) ne sont pas gardés dans les projets. Ils ne seront donc pas sur la page publique. Hors périmètre, mais à dire dans l'interface.
- `.pro-verrouille` n'est stylé que pour `#outilsPro` et `#outilsExport` (`src/style.css`, ligne 503). Il faut en faire une classe générale.
- `X-Frame-Options: DENY` et `frame-ancestors 'none'` interdisent d'intégrer le site dans une autre page. Une page publique ne pourra pas être intégrée en `iframe` sans exception ciblée.

**Serveur.** PHP 8 et MySQL, un fichier par ressource, une `action` dans le corps du POST (`api/lieux.php` est le modèle à suivre). `_commun.php` fournit `entree()`, `corps()`, `exiger_compte()`, `hache()`, `json()`. La table `demandes` sert déjà à limiter les abus. Le compte porte un simple drapeau `pro`.

## 3. Principes retenus

- **Un projet = un document JSON versionné.** Variantes comprises. Une seule ligne à verrouiller, une seule version à comparer. C'est le plus simple et le plus sûr en PHP mutualisé.
- **Chaque élément a un `uid`.** Volume, groupe de bâtiments masqués, coupe, variante. Douze caractères aléatoires, créés dans le navigateur. Toute la fusion repose dessus.
- **Le serveur décide des droits.** Le navigateur grise, le serveur refuse. Jamais l'inverse.
- **Rien ne se perd.** Chaque enregistrement crée une version. On peut revenir en arrière.
- **Le navigateur garde une copie.** `localStorage` devient un cache et une file d'attente hors ligne, plus la source de vérité.
- **Même style d'API qu'aujourd'hui.** Fichiers `api/projets.php`, `api/organisations.php`, `api/publications.php`, `api/public.php`. Noms et champs en français.

## 4. Modèle de données serveur

### 4.1 Tables

**`organisations`**

| Colonne | Rôle |
|---|---|
| `id` | clé |
| `nom` | 2 à 80 caractères |
| `proprietaire_id` | compte créateur (un seul propriétaire) |
| `cree_le` | date |

**`membres`**

| Colonne | Rôle |
|---|---|
| `organisation_id`, `compte_id` | clé primaire double |
| `role` | `proprietaire`, `membre` ou `lecteur` |
| `depuis` | date |

**`invitations`**

| Colonne | Rôle |
|---|---|
| `jeton` | haché SHA-256, comme la table `jetons` |
| `organisation_id` | organisation visée |
| `email` | adresse invitée |
| `role` | `membre` ou `lecteur` |
| `invite_par` | compte |
| `expire` | 7 jours |
| `utilise` | usage unique |

**`projets`**

| Colonne | Rôle |
|---|---|
| `id` | clé interne |
| `uid` | identifiant aléatoire, exposé au navigateur à la place de `id` |
| `compte_id` | auteur, et propriétaire si le projet est personnel |
| `organisation_id` | `NULL` si personnel |
| `nom` | 1 à 160 caractères |
| `lieu` | fragment `#e=…&n=…`, même contrôle que `lieux.lien` |
| `version` | entier, augmente de 1 à chaque enregistrement |
| `contenu` | `MEDIUMTEXT`, JSON du projet (voir 4.2) |
| `taille` | octets, pour les quotas |
| `origine_locale` | ancien `id` local, pour une migration sans doublon |
| `modifie_le`, `modifie_par` | dernière écriture |
| `supprime_le` | corbeille de 30 jours, `NULL` sinon |

**`projets_versions`**

| Colonne | Rôle |
|---|---|
| `projet_id`, `version` | clé primaire double |
| `contenu` | JSON complet de cette version |
| `auteur_id`, `cree_le` | qui et quand |
| `etiquette` | nom facultatif (« Envoyé à la commune ») |

Rétention : les 30 dernières versions, puis une par jour pendant 90 jours, plus toutes les versions étiquetées. La purge se fait au moment d'une écriture. Aucune tâche planifiée n'est nécessaire.

**`publications`**

| Colonne | Rôle |
|---|---|
| `id` | clé |
| `projet_id` | projet source |
| `adresse` | 12 caractères aléatoires, unique |
| `alias` | facultatif, lisible, unique (voir décisions) |
| `titre`, `description` | pour la page et le partage |
| `contenu` | **copie figée** du projet au moment de la publication |
| `version_source` | version du projet copiée |
| `reglages` | JSON (voir 8.2) |
| `apercu` | nom du fichier image de partage |
| `active` | interrupteur |
| `expire_le` | `NULL` = sans fin |
| `publie_par`, `publie_le`, `mis_a_jour_le` | traçabilité |
| `vues` | compteur simple, sans donnée personnelle |

**`presences`** (étape « édition à plusieurs »)

| Colonne | Rôle |
|---|---|
| `projet_id`, `compte_id` | clé primaire double |
| `vu_le` | dernier signe de vie |
| `element` | `uid` de l'élément sélectionné, facultatif |

**Pas de table `variantes`.** Les variantes vivent dans le JSON du projet. Raison : une variante seule n'a pas de sens sans sa base, et deux tables versionnées séparément pourraient se désaccorder. Si un jour il faut des statistiques par variante, on ajoutera une table dérivée.

### 4.2 Le JSON d'un projet (format 2)

```
{
  "format": 2,
  "jour": "2026-06-21", "rayon": 300,
  "base": {
    "volumes": [ { "uid", "rev", …champs actuels… } ],
    "caches":  [ { "uid", "rev", "ids", "empreintes", "visible", "nom" } ],
    "coupes":  [ { "uid", "rev", "A", "B", "nom" } ]
  },
  "variantes": [
    { "uid", "rev", "nom", "couleur", "ordre",
      "ajouts":   { "volumes": […], "caches": […], "coupes": […] },
      "remplace": { "<uid de la base>": { …élément complet… } },
      "retire":   [ "<uid de la base>" ],
      "mesures":  { …voir 7.2… } }
  ],
  "retires": [ { "uid", "rev" } ]
}
```

- `rev` = numéro de version du projet lors de la dernière modification de l'élément. Il sert à la fusion.
- `retires` garde la trace des éléments supprimés (pierres tombales), pour qu'une suppression ne soit pas annulée par une fusion. Purgées après 90 jours.
- `format` permet de lire les anciens projets (format 1 = projet local actuel, converti par une fonction `normaliserProjet`, sur le modèle de `normaliserVolume`).

### 4.3 Droits

| Action | Propriétaire de l'organisation | Membre | Lecteur | Auteur d'un projet personnel |
|---|---|---|---|---|
| Voir, ouvrir, dupliquer chez soi | oui | oui | oui | oui |
| Modifier, créer des variantes | oui | oui | non | oui |
| Créer un projet dans l'organisation | oui | oui | non | sans objet |
| Supprimer ou restaurer un projet | oui | le sien seulement | non | oui |
| Publier, régler, dépublier | oui | oui (voir décisions) | non | oui |
| Inviter, changer un rôle, retirer un membre | oui | non | non | sans objet |
| Renommer ou supprimer l'organisation | oui | non | non | sans objet |

Règles associées :

- Un projet d'organisation appartient à l'organisation. Il reste si son auteur part.
- Un projet personnel peut être « déplacé vers l'organisation ». Le retour en arrière est réservé au propriétaire.
- Un compte peut appartenir à plusieurs organisations. C'est utile à un architecte qui travaille avec plusieurs bureaux. Limite : 10.
- Suppression d'un compte (`api/supprimer.php`) : si le compte possède une organisation avec d'autres membres, il doit d'abord la transmettre ou la supprimer. Les projets personnels et leurs publications sont effacés.
- Perte du statut Pro (rétractation, `api/retractation.php`) : les projets restent lisibles et exportables en JSON. L'édition, les organisations et les pages publiques sont suspendues, pas effacées.

## 5. Migration des projets locaux vers le compte

Les outils de projet sont déjà réservés au Pro. La synchronisation l'est donc aussi.

1. À la connexion d'un compte Pro, le site lit `ombres.projets`.
2. S'il y a des projets non synchronisés, un bandeau propose : « 3 projets sont enregistrés dans ce navigateur. Les ajouter à mon compte ? » Boutons : Ajouter, Plus tard.
3. Chaque projet est converti au format 2 (ajout des `uid`), puis envoyé avec son ancien `id` dans `origine_locale`. Le serveur ignore un projet déjà reçu. Relancer la migration ne crée pas de doublon.
4. La copie locale est gardée et marquée « synchronisée ». Elle n'est jamais effacée automatiquement.
5. Ensuite, `Enregistrer` écrit d'abord en local, puis sur le serveur. Hors ligne, l'envoi attend et repart au retour du réseau. Un indicateur discret montre l'état : Enregistré, En attente, Conflit.
6. Sur un autre appareil, la liste vient du serveur. La liste déroulante `#listeProjets` se sépare en « Mes projets » et un groupe par organisation.

Cas particuliers :

- Compte non connecté ou non Pro : rien ne change, les projets restent locaux.
- Deux navigateurs avec des projets différents : chacun migre les siens, sans collision.
- Projet local plus récent que sa copie serveur : c'est un conflit ordinaire, traité comme au chapitre 6.

## 6. Édition à plusieurs

### 6.1 Contraintes

- PHP mutualisé : pas de WebSocket, pas de processus qui dure. Seulement des requêtes courtes.
- Usage réel : deux à cinq personnes d'un bureau, rarement en même temps sur le même volume.
- L'édition actuelle est par gestes (tirer une face, changer une hauteur), puis `Enregistrer`.

### 6.2 Comparaison

| | Verrou optimiste + fusion par élément | Verrou pessimiste | CRDT |
|---|---|---|---|
| Principe | Chacun travaille. À l'enregistrement, le serveur fusionne ce qui ne se chevauche pas. | Un seul éditeur à la fois. Les autres lisent. | Chaque modification est une opération qui se fusionne toujours. |
| Sans WebSocket | Oui, une requête à l'enregistrement | Oui, mais demande un signe de vie régulier | Possible, mais lourd par interrogation répétée |
| Travail en parallèle | Oui | Non | Oui, en direct |
| Risque principal | Deux personnes sur le même élément | Verrou oublié (onglet ouvert, départ en pause) | Complexité, bibliothèque de 100 ko et plus, stockage binaire opaque en MySQL |
| Hors ligne | Bien géré | Mal géré (le verrou expire) | Très bien géré |
| Effort | Moyen | Faible | Élevé, et tout le modèle de données à réécrire |
| Lisibilité des données | JSON clair, versions comparables | JSON clair | Peu lisible, difficile à déboguer |

### 6.3 Recommandation

**Verrou optimiste avec numéro de version et fusion par élément, complété par un signal de présence.**

- Le CRDT est disproportionné. Il résout la frappe simultanée dans un texte. Ici, les éléments sont peu nombreux et indépendants.
- Le verrou pessimiste seul bloque le bureau dès qu'un onglet reste ouvert. On en garde l'idée utile, l'information « Marie est sur ce projet », sans le blocage.

### 6.4 Fonctionnement

1. Le navigateur ouvre le projet et retient sa `version` (par exemple 12) et une copie de départ.
2. À l'enregistrement, il envoie la version de départ et la liste des éléments ajoutés, modifiés ou retirés. Pas le document entier.
3. Le serveur ouvre une transaction et verrouille la ligne (`SELECT … FOR UPDATE`).
4. Si la version est toujours 12, il applique et passe à 13.
5. Si la version a avancé, il regarde chaque élément envoyé. Si son `rev` est resté inférieur ou égal à 12, personne d'autre n'y a touché : la modification est appliquée. Sinon, c'est un conflit sur cet élément.
6. Le serveur répond avec la nouvelle version, le document fusionné et la liste des conflits. Les modifications sans conflit sont enregistrées dans tous les cas.

Granularité : l'élément entier (un volume, un groupe masqué, une coupe, les réglages d'une variante). Pas de fusion champ par champ. C'est plus simple à comprendre : « ce volume a été modifié par deux personnes ».

Présence : pendant qu'un projet partagé est ouvert, le navigateur interroge le serveur toutes les 20 secondes, seulement si l'onglet est visible. La réponse donne la version courante et les personnes présentes. Coût : une requête légère, sans charger le JSON.

### 6.5 Ce que voit l'utilisateur

- **Personne d'autre.** Rien de nouveau. « Enregistré. »
- **Quelqu'un d'autre a ouvert le projet.** Une pastille avec ses initiales apparaît à côté du nom du projet. Info-bulle : « Marie Dupont est aussi sur ce projet. »
- **L'autre enregistre pendant que je travaille.** Message : « Marie a enregistré des modifications. » Bouton : Mettre à jour. Ses volumes apparaissent, les miens restent.
- **J'enregistre, nous avons touché des éléments différents.** Message : « Enregistré. Les modifications de Marie ont été intégrées. » Aucune question.
- **Nous avons modifié le même volume.** Le reste est enregistré. Le volume concerné est surligné. Une petite fenêtre demande : « Marie a aussi modifié le Volume 3. » Trois choix : Garder ma version, Prendre celle de Marie, Garder les deux (ma version devient « Volume 3, copie »). Un aperçu alterne les deux états sur la maquette.
- **L'un a supprimé ce que l'autre a modifié.** Même fenêtre : « Marie a supprimé le Volume 3 que vous avez modifié. » Choix : Le rétablir avec mes modifications, Accepter la suppression.
- **Lecteur.** Les outils sont visibles mais inactifs, avec la mention « Lecture seule ». Il peut dupliquer le projet chez lui.
- **Filet de sécurité.** Menu « Historique » : liste des versions avec auteur et heure, aperçu, « Restaurer cette version ». Restaurer crée une nouvelle version, on ne réécrit jamais l'histoire.

## 7. Variantes

### 7.1 Structure

- Le projet a une **base** : ce qui est commun (démolitions, volumes voisins, coupes de référence).
- Chaque **variante** surcharge la base : elle ajoute des éléments, en remplace (élément complet, repéré par son `uid`), en retire.
- Une variante sans surcharge est identique à la base. Créer une variante est donc instantané et léger.
- « Dupliquer la variante » copie ses surcharges. « Intégrer à la base » remonte un élément dans la base.
- Limite : 12 variantes par projet.

Dans l'éditeur : une rangée d'onglets au-dessus de la liste des volumes, « Base », « A », « B », « + ». Un volume hérité de la base porte une petite marque. Le modifier dans une variante crée la surcharge, avec un bouton « Revenir à la base ».

### 7.2 Comparaison

Un tableau, une colonne par variante. Les mesures sont calculées dans le navigateur avec le code existant (`ficheVolume.js`, `volumes.js`, `ensoleillement.worker.js`), puis rangées dans `mesures` à l'enregistrement. La page publique les affiche sans recalcul.

| Famille | Mesures |
|---|---|
| Surfaces | emprise au sol, surface de plancher (emprise × étages), volume bâti |
| Hauteurs | corniche la plus haute, faîte le plus haut, nombre d'étages maximal |
| Ensoleillement | heures de soleil sur la parcelle à la date choisie, heures perdues par les voisins par rapport à l'état actuel |
| Distances | plus petite distance à la limite (déjà calculée pour un volume) |

Le calcul d'ensoleillement est long. Il se lance à la demande (« Calculer la comparaison ») et son résultat est marqué périmé dès qu'un volume change.

### 7.3 Classement

- Un clic sur une ligne du tableau trie les variantes selon ce critère. Le rang s'affiche (1er, 2e, 3e).
- Chaque critère a un sens : « plus c'est grand, mieux c'est » (surface de plancher) ou l'inverse (ombre portée sur les voisins).
- Pas de note globale au départ. Une note unique cache des choix de pondération que seul l'architecte peut faire. Voir décisions.

Remarque : la phrase « voir comment ça se classe » peut aussi vouloir dire « voir comment le projet s'insère dans le site ». La page publique couvre ce sens-là par l'orbite et la bascule des variantes. Le sens exact est à confirmer.

## 8. Page publique

### 8.1 Adresse

- Forme : `topograph.ch/p/k7m2q9xw4r8t`. Douze caractères tirés au hasard dans un alphabet de 32 signes sans ambiguïté (pas de 0, O, 1, l). Cela fait 60 bits : impossible à deviner ou à parcourir.
- Alias lisible facultatif : `topograph.ch/p/lutry-grand-rue`. Plus joli, mais devinable. À réserver aux pages volontairement publiques.
- Règle `.htaccess` : `/p/…` est servi par un petit script PHP qui renvoie la page de visionneuse avec les métadonnées du projet. Les robots de partage ne lisent pas le JavaScript, le serveur doit donc écrire le titre et l'image.

### 8.2 Réglages de l'auteur

Stockés dans `publications.reglages` :

| Réglage | Valeurs |
|---|---|
| Variantes visibles | liste d'`uid`, ordre, variante affichée à l'ouverture |
| Comparaison | tableau visible ou non, critères montrés |
| Coupes | interdites ; coupes de l'auteur seulement ; coupes libres |
| Fond de plan | l'un des fonds existants (`fond.js`), changeable ou non par le visiteur |
| Soleil | date et heure fixées ; ou curseur laissé au visiteur |
| Vue de départ | caméra enregistrée (même format que `cam` des lieux) |
| Bâtiments démolis | montrés en transparence ou retirés |
| Texte | titre, description courte, nom du bureau, lien de contact |
| Référencement | indexable par les moteurs ou non (non par défaut) |
| Durée | sans fin, ou date d'expiration |

**La publication est une copie figée.** Travailler sur le projet ne change pas la page publique. Un bouton « Mettre à jour la page publique » la remplace, après confirmation. C'est le comportement attendu pour un document remis à un client ou à une commune.

### 8.3 Interface

- La maquette occupe tout l'écran. Orbite, zoom, déplacement, tactile compris.
- En haut à gauche : titre, lieu, nom du bureau.
- En bas : la rangée des variantes (pastilles à bascule, une ou plusieurs actives selon le réglage).
- À droite, trois boutons au plus : Coupe (si permise), Soleil (si permis), Partager (copier le lien, QR code).
- Un pied discret : « Maquette réalisée avec Topograph », lien vers le site.
- Pas de recherche, pas de panneau latéral, pas de compte, pas de bandeau de connexion.
- Les 4 langues, selon la langue du navigateur.

### 8.4 Chargement rapide

- Seconde entrée Vite (`p.html` et `src/public.js`), sans le code d'édition, d'export, d'impression 3D ni de compte. Le paquet doit rester nettement plus léger que le site.
- Elle réutilise le chargement actuel du lieu (terrain, bâtiments, fond) à partir du `lieu` du projet. **Travail préalable** : ce chargement vit dans `src/main.js`, mêlé à l'interface. Il faut l'extraire dans un module appelable par les deux entrées. C'est le principal risque de cette étape.
- Une seule requête à l'API : `api/public.php?a=…` renvoie contenu figé et réglages. Réponse mise en cache par le navigateur (`ETag`, quelques minutes).
- Ordre d'affichage : image d'aperçu tout de suite, puis terrain, puis bâtiments, puis volumes du projet. Le visiteur voit quelque chose en moins d'une seconde.
- Rayon chargé limité à celui du projet. Pas de paysage lointain par défaut.

### 8.5 Partage, confidentialité, désactivation, expiration

- **Métadonnées** : `<title>`, description, `og:title`, `og:description`, `og:image`, `twitter:card`. L'image est une capture de la maquette faite dans le navigateur de l'auteur au moment de publier (JPEG, 1200 × 630, 300 ko au plus), envoyée au serveur.
- **Confidentialité** : par défaut, la page n'est pas indexable (`noindex` et en-tête `X-Robots-Tag`). Elle n'apparaît dans aucune liste. Seul le lien y donne accès. Aucun e-mail ni nom de compte n'est exposé, seulement le texte choisi par l'auteur.
- **Désactivation** : un interrupteur dans la liste « Mes pages publiques ». Effet immédiat. L'adresse est gardée et peut être réactivée.
- **Expiration** : date facultative. Passée la date, la page répond comme si elle n'existait pas. L'auteur reçoit un e-mail une semaine avant (envoyé lors d'une visite de l'auteur ou d'une écriture, sans tâche planifiée).
- **Régénérer l'adresse** : crée une nouvelle adresse et tue l'ancienne, si le lien a fui.
- **Publicité** : aucune sur les pages publiques (proposition, voir décisions).
- **Mot de passe** : non prévu au départ. Possible plus tard.

## 9. Grisé pour les comptes non Pro

- Généraliser `.pro-verrouille` en classe utilisable partout : opacité .45, niveaux de gris, curseur main, enfants sans interaction. Les deux sélecteurs actuels (`#outilsPro`, `#outilsExport`) deviennent des cas de la règle générale.
- Même comportement qu'aujourd'hui dans `src/pro.js` : `aria-disabled="true"`, clic intercepté en phase de capture, appel de `compte.exigerPro(raison)` avec une raison propre à chaque bloc.
- Dans le panneau du compte (`src/compte.js`), trois blocs nouveaux, toujours visibles : « Organisation » (Créer, Rejoindre), « Mes projets », « Pages publiques ». Grisés sans Pro, avec une ligne d'explication.
- Dans l'éditeur : boutons « Publier », « Variantes », « Partager avec l'organisation » grisés de la même façon.
- Un petit cadenas (`ICONE`) à côté du titre du bloc, pour que le grisé ne ressemble pas à une panne.
- Textes dans les 4 fichiers `src/langues/*.js`, préfixes `org.`, `variante.`, `publication.`.
- Le serveur refuse de toute façon (403 `pro_requis`). Le grisé n'est qu'un affichage.

Cas à trancher : une invitation reçue par un compte non Pro. Le lien fonctionne, la page explique que rejoindre demande un compte Pro et propose l'achat. L'invitation reste valable après l'achat.

## 10. Sécurité

**Contrôle d'accès**

- Une seule fonction dans `_commun.php`, par exemple `acces_projet($compte, $uid, $niveau)`, avec `$niveau` = `lire`, `ecrire` ou `gerer`. Elle renvoie le projet ou termine en 404. Tous les endpoints passent par elle. Aucune requête SQL sur `projets` hors de cette fonction.
- Même réponse 404 pour « n'existe pas » et « pas le droit ». On ne révèle pas l'existence d'un projet.
- Le statut Pro et le rôle sont relus en base à chaque requête. Jamais repris du navigateur.
- Les identifiants exposés sont les `uid` aléatoires, pas les `id` numériques qui se suivent.
- `entree()` est appelée partout, avec son contrôle d'origine pour les POST. `public.php` est en GET seulement, sans cookie, sans CORS ouvert.

**Limites de taille**

| Objet | Limite proposée |
|---|---|
| Corps d'une requête | 600 ko, contrôlé sur `Content-Length` avant lecture |
| JSON d'un projet | 500 ko |
| Projets par compte, par organisation | 200, 500 |
| Volumes, coupes, variantes par projet | 500, 50, 12 |
| Sommets par volume | 64 |
| Membres par organisation | 25 |
| Invitations en attente | 20 par organisation, 10 envois par heure |
| Publications actives par compte | 20 |
| Image d'aperçu | 300 ko, JPEG vérifié et réencodé |

**Validation du contenu**

- Le serveur valide la structure du JSON : clés connues seulement, nombres bornés (coordonnées dans l'emprise de la Suisse, hauteurs de 0 à 300 m), chaînes limitées en longueur, couleurs au format `#rrggbb`.
- Les noms (projet, variante, organisation, titre public) sont du texte brut. Ils sont échappés à l'affichage, avec la fonction `esc` déjà présente dans `pro.js`. La page PHP échappe aussi les métadonnées.
- Le lien de contact d'une page publique n'accepte que `https:` et `mailto:`.

**Énumération des adresses publiques**

- 60 bits d'aléa, tirés avec `random_bytes`.
- Limite par adresse IP sur `public.php`, avec la table `demandes` : par exemple 60 adresses inconnues par heure, puis 429.
- Réponse identique (404, même corps, même délai) pour inexistante, désactivée, expirée.
- Aucun endpoint ne liste les publications, sauf celles du compte connecté.
- Alias lisibles : longueur minimale de 6 caractères, liste de mots réservés, et avertissement « cette adresse peut être devinée ».

**Invitations**

- Jeton haché en base, usage unique, 7 jours.
- L'invitation est liée à une adresse e-mail. Elle ne s'accepte qu'avec le compte de cette adresse.
- Le message d'invitation ne confirme pas si l'adresse a déjà un compte.

**Divers**

- Journal minimal des actions sensibles (invitation, changement de rôle, publication, suppression) dans une table `journal`, 12 mois.
- Mise à jour de la politique de confidentialité et de `docs/audit-legal-securite.md` : les projets sont désormais des données stockées sur le serveur, partagées avec d'autres comptes.
- Sauvegarde : vérifier la fréquence des sauvegardes MySQL d'Infomaniak. Les projets deviennent un bien du client.

## 11. Étapes livrables

Chaque étape est utile seule et peut être mise en ligne sans les suivantes. Les tailles sont des ordres de grandeur pour une personne.

| N° | Étape | Contenu | Utile parce que | Taille |
|---|---|---|---|---|
| 0 | Préparation | `uid` sur tous les éléments, format 2, `normaliserProjet`. Vérification de la stabilité des identifiants de bâtiments masqués. `.pro-verrouille` général. | Aucun changement visible, mais tout le reste en dépend. | S, 2 jours |
| 1 | Projets dans le compte | Tables `projets` et `projets_versions`, `api/projets.php`, migration, cache local et file hors ligne, numéro de version (refus simple en cas de conflit), historique et restauration, corbeille. | Mes projets me suivent sur tous mes appareils et ne se perdent plus. | M, 5 à 6 jours |
| 2 | Variantes | Base et surcharges, onglets dans l'éditeur, tableau de comparaison, tri par critère. | Comparer A, B et C dans un même projet, sans page publique. | M, 5 à 7 jours |
| 3 | Page publique | Extraction du chargement du lieu, entrée `p.html`, table `publications`, `api/publications.php` et `api/public.php`, réglages, aperçu, métadonnées, désactivation, expiration. | Envoyer un lien à un client ou à une commune. | L, 8 à 10 jours |
| 4 | Organisations | Tables `organisations`, `membres`, `invitations`. Panneau du compte, rôles, déplacement d'un projet vers l'organisation, cas de suppression de compte. | Le bureau partage ses projets. | M, 5 à 6 jours |
| 5 | Édition à plusieurs | Envoi par éléments, fusion côté serveur, fenêtre de conflit, présence, mise à jour en cours de travail. | Deux personnes sur le même projet sans s'écraser. | M, 5 à 7 jours |

Total : environ 30 à 38 jours de travail.

Notes sur l'ordre :

- L'étape 1 est obligatoire avant tout.
- Les étapes 2, 3 et 4 sont indépendantes entre elles. La page publique sans variantes fonctionne (elle montre le projet seul). L'ordre proposé suit la valeur perçue : comparer, puis montrer, puis partager en interne.
- L'étape 4 sans l'étape 5 est acceptable : en cas d'enregistrement simultané, le second reçoit « Marie a enregistré entre-temps » et choisit entre recharger ou enregistrer une copie. L'étape 5 supprime cette gêne.
- Chaque étape ajoute ses tables par des `CREATE TABLE IF NOT EXISTS` à la fin de `api/schema.sql`, comme aujourd'hui.

Tests : fusion et validation du JSON sont des fonctions pures. Elles se testent sans navigateur ni base, dans `tests/`.

## 12. Points à trancher par le propriétaire

1. **Prix de l'organisation.** Chaque membre doit-il avoir son propre Pro à 39 CHF, ou un Pro suffit-il pour inviter des collègues ? Proposition : chaque membre qui modifie est Pro, les lecteurs sont gratuits.
2. **Rejoindre une organisation.** Par invitation e-mail seulement (proposé), ou aussi par un code que l'on saisit ?
3. **Qui publie.** Tout membre, ou le propriétaire de l'organisation seulement ?
4. **Page publique figée ou vivante.** Copie figée avec bouton « Mettre à jour » (proposé), ou reflet direct du projet ?
5. **Adresse.** Aléatoire seulement, ou alias lisible en plus (`/p/lutry-grand-rue`) ?
6. **Sens de « voir comment ça se classe ».** Classement chiffré des variantes, insertion visuelle dans le site, ou les deux ?
7. **Note globale des variantes.** Aucune (proposé), ou une note pondérée réglable ?
8. **Publicité et marque sur la page publique.** Sans AdSense et avec une mention « Réalisé avec Topograph » (proposé) ? Mention retirable ?
9. **Intégration dans un autre site.** Autoriser l'`iframe` pour les pages publiques ? Cela demande une exception aux en-têtes de sécurité.
10. **Fin du Pro ou suppression du compte.** Pages publiques suspendues immédiatement (proposé), ou délai de grâce ?
11. **Durée de l'historique.** 90 jours (proposé) ou plus ?
12. **Ordre des étapes.** Variantes, page publique, organisations (proposé), ou organisations d'abord comme dans la demande ?
