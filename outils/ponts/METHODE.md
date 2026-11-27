# Méthode : modéliser un pont célèbre et le vérifier sur photo

Méthode réutilisable, pont après pont. Chaque étape a son outil dans `outils/ponts/`. Données lourdes et photos hors
dépôt : `~/Downloads/ombres-suisse-donnees/` (ponts-photos/<nom>/, ponts-calage/, ponts-comparaisons/).

## 0. Choisir le pont et vérifier les données
- Coordonnées : `api3.geo.admin.ch/rest/services/api/SearchServer?searchText=<nom>&type=locations&sr=2056`
  (gazetteer : rues « Pont de … », « …brücke »). Ne pas convertir WGS84 à la main.
- Relevé laser au format COPC (lisible par morceaux) : STAC **v1** `ch.swisstopo.swisssurface3d`, asset `.copc.laz`.
  Berne 2023, Landwasser 2020… n'existent qu'en LAS zippé (120–250 Mo/km²) : à éviter ou à prévoir.
- Le recensement `ponts50.json` (swissTLM3D) ne contient que les routes de la Confédération et des cantons.

## 1. Résumé du relevé
`node outils/ponts/preparer.mjs E N rayon > outils/ponts/resumes/<nom>.txt` (ou `preparer_axe.mjs` avec l'axe TLM).
Contrôler : longueur et largeur plausibles. Un résumé trop court (dernier point encore haut au-dessus du terrain) ou
trop long (rampes, galerie) se corrige en relançant avec un autre centre ou rayon. Une galerie couverte, des courbes
d'accès ou un pont voisin faussent la largeur et la colonne `chaussee`.

## 2. Modèle (agent)
Consigne : `outils/ponts/consigne-v3.md`. Entrées : résumé, nom, coordonnées ; sorties : `outils/ponts/modeles/<nom>.json`,
`photo.jpg` + 2 à 3 autres vues + `calage.json` dans ponts-photos/<nom>/. L'agent cherche les dimensions publiées
(Wikipedia, structurae, cantons, OFROU) et regarde chaque appui **dessous, à côté et au-dessus du tablier**.

Schéma (src/pontsModeles.js) : axe courbe, tablier (caisson, goussets), garde-corps, piles (rect, rond, double,
fruit, haut différent, chapiteau, arrêt `z_haut`), arches (parabole, cintre, surhaussé, surbaissé, asymétrique,
nervures, montants), pylônes (mât, A, H, « aucun ») et haubans (éventail, semi-harpe, nappe axiale ou latérale),
éléments libres (barres effilées).

Extensions du schéma (pont de la Poya) : `pylones[].profil` = pylône sculpté en UN seul volume, sections horizontales
`[[z, demi-largeur extérieure, demi-écart intérieur, longueur], …]` (écart intérieur 0 = fût ou mât, > 0 = fourche ; `chanfrein`
abat les arêtes) ; `section: "poutres"` (+ `dalle`, `poutre_larg`, `traverses {pas, ep, prof}`) = poutres de rive pleines, dalle en
retrait et traverses sous le tablier ; `bords [[s, o_min, o_max]]` = tablier de largeur variable ; `haubans.o_ancrage` = écart
des ancrages ; `galeries [{s0, s1, h | [[s, h]…], ep, bandeau, poteau, pas}]` = toit antibruit ; `parois`, `lampadaires`.
Coupes du nuage au droit d'un pylône : `COUPES=1 node outils/ponts/verifier_nuage.mjs …` ; `CACHE=fichier.json` garde le
nuage lu pour itérer sans retélécharger.

Extensions v5 (formes libres ; tout est facultatif, sans ces champs le maillage est identique au bit près) :
- **Volumes sculptés** `sections: [{ z, forme, long, larg, nez_amont, nez_aval, rayon, chanfrein, o, points }]` sur une
  pile (`appuis[]`), un pylône (`pylones[]`) ou un volume libre (`volumes: [{ s, t, z_bas, sections }]` : pavillon,
  portique, obélisque, pilier de portail). Formes : `rect`, `chanfrein`, `rond`, `ogive`, `poly` (`points [[s, o]…]`) ;
  becs `nez_amont`/`nez_aval` (m au-delà du corps, pointus, arrondis pour `rond`, en ogive pour `ogive` ; `amont: -1` si
  l'amont est côté o négatif). `z` en m ou `"tablier"`, `"chaussee"`, `"sol"` (+ `dz`). Lissé en UN volume (fruit,
  têtes évasées, pyramide), prolongé jusqu'au pied sous la première section.
- **Tablier sculpté** `sections_tablier: [{ s, points: [[o, dz], …] }]` : section en travers de la rive o min à la rive
  o max par le dessous (dz < 0 sous la chaussée : caisson, corniches, consoles, sous-face courbe), interpolée entre les
  stations (même nombre de points : arêtes gardées). Remplace `epaisseur`/`section` pour le dessous.
- **Toits** `toits: [{ s0, s1, faite, egout, larg, avant_toit, ep, croupe, pignons: ["ouvert"|"ferme", …],
  elargissements: [{ s0, s1, larg, egout, faite | pente }] }]` : deux pans en quelques triangles ; `faite`, `egout`,
  `larg` : nombre, [début, fin] ou profil `[[s, v], …]` ; croupe `true` (même pente) ou longueur ; élargissement =
  croupe sur tout le pourtour (pavillon, pyramide).
- **Façades** (`parois[]`) : `dz_bas`, `z_haut` (comme `egout`) + `dz_haut`, `soubassement { h, saillie }`,
  `ouvertures { pas | centres, larg, haut, z | sous_haut, forme: "segment"|"cintre"|"anse" (+ `fleche`, `bandeau`) }`
  (baies en arc découpées dans le bardage).
- **Matériaux** `materiau` : "beton" (défaut, plâtre), "acier", "bois", "pierre", "tuile", "verre" ; sur le modèle
  (défaut de toutes les parties), `materiau_tablier`, et sur chaque partie (`garde_corps`, `appuis[]`, `pylones[]`,
  `arches[]`, `elements[]`, `parois[]`, `toits[]`, `volumes[]`, `galeries[]`, `traverses`, `haubans`, `lampadaires[]`).
  Un maillage par matériau : la ligne de séparation se lit (teintes à peine nuancées) ; couper une partie en deux volumes
  pour changer de matière.
- Voûtes pleines : `s0`/`s1` engagés de quelques dm dans les piles (sinon une fente reste entre tympan et pile).

**Faces depuis le nuage** : `CACHE=… node outils/ponts/sections_nuage.mjs <modele.json> pile <s> [t] [pas] [sommets]
[rayon]` → les `sections` d'une pile (tranches, enveloppes convexes simplifiées) ; `ZMIN/ZMAX` pour garder la pile seule
(sous les naissances des voûtes), `FACES=1` pour des faces planes (RANSAC : fruit, becs). Il dit ce qui n'est pas vu
(tête sous un tablier large, côté masqué) : le compléter sur les photos. `… tablier [pas] [prof]` → `sections_tablier`
(rives et corniches mesurées, sous-face rarement vue). Utile pour les piles en pierre (becs, fruit), les têtes et les
corniches ; inutile pour un appui caché sous le tablier ou dans les arbres. Exemples : `zaehringen.json` (piles et
tablier), `pont-couvert-de-bad-sackingen.json` (toit, façades, becs, pavillons), `passerelle-de-soleure.json`
(matériaux).

## 3. Mise dans la maquette
`python3 outils/ponts/ajouter.py outils/ponts/modeles/<nom>.json` (copie dans public/ponts et index).
Voir : `http://localhost:5174/#e=<E>&n=<N>&t=Voyage` — le mode Voyage garde le centre exact (sinon la maquette se
recentre sur la parcelle la plus proche, parfois à des centaines de mètres). La maquette fine fait 300 m de rayon :
centrer sur la partie la plus caractéristique.

## 4. Calage de la photo et superposition (le contrôle qui compte)
1. Points : `calage.json` (6 à 10 points, pixels ↔ MN95 + altitude), relevés par l'agent ou à la main.
2. Caméra : `python3 -I outils/ponts/caler_photo.py calage.json > camera.json` (position, visée, focale, roulis ;
   erreur moyenne en pixels et résidus par point : > 15 px = point mal repéré, à corriger ou retirer).
3. Rendu : lancer `node outils/ponts/recepteur.mjs ~/Downloads/ombres-suisse-donnees/ponts-calage`, puis dans la page
   de dev : `await import('/outils/ponts/rendu_cale.js'); await renduCale(camera, {E0, N0, largeur, hauteur, nom})`.
4. Superposition : `python3 -I outils/ponts/superposer.py photo.jpg rendu.jpg sortie.jpg "Titre"` → photo, rendu,
   mélange 50 % et contours du rendu en rouge sur la photo.
5. Lire les écarts **par élément** : hauteur et forme des pylônes, têtes et pieds des piles, épaisseur et sous-face du
   tablier, naissances et clés des arcs, garde-corps. Corriger le JSON, `ajouter.py`, nouveau rendu (même caméra),
   nouvelle superposition. Deux ou trois tours suffisent en général.

## 5. Livraison
`ponts-comparaisons/<nom>.jpg` (photo | modèle) et la superposition finale ; crédit de la photo (auteur, licence).

## Coût des agents (mesuré)
Voir `outils/ponts/essais/banc-modeles.md` : même pont, même consigne, modèles d'agent différents, jugés à la
superposition calée. Règle retenue : voir la conclusion de ce fichier.

## Pièges connus
- Arcs : la parabole par défaut est fausse pour les voûtes en pierre (plein cintre) ; une flèche plus grande que la
  demi-ouverture veut un plein cintre surhaussé.
- Arc asymétrique : `s_cle` et `z_naissance_fin`, pas une parabole symétrique dont une branche passe sous le terrain.
- Ponts à haubans : pylônes en losange ou en Y → pile arrêtée (`z_haut`) + éléments ; haubans en semi-harpe.
- Navigateur intégré : un seul onglet partagé ; deux agents qui naviguent en même temps se gênent.
