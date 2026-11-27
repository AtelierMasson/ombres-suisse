# Modéliser un pont (v3) : relevé laser + photos, un peu plus précis

But : qu'on reconnaisse le pont au premier coup d'œil, comme sur une photo, à environ 0,5–1 m près. Plus précis
que la v2 (pont Bessières) : on décrit aussi les garde-corps, la forme du tablier (caisson), les goussets sur appuis,
les nervures d'un arc, l'espacement des montants, les piles doubles, les pylônes et les haubans.

## Ce que tu as déjà (ne le recherche pas)
Un résumé du relevé laser swisstopo autour du pont (fichier indiqué dans ta mission) : l'axe mesuré du tablier (bouts
en MN95), sa longueur et sa largeur, puis tous les 4 m le dessus et le dessous du tablier, le terrain, l'eau, et les
points trouvés sous le tablier (piles, arcs). C'est la source de vérité pour la géométrie et les altitudes.
Limites : le laser vient d'en haut ; sous un tablier large, les arcs et piles fines sont peu ou pas touchés. La
« largeur mesurée » peut inclure des trottoirs en encorbellement, une chaussée voisine ou de la végétation : vérifie
avec les sources.

## Ce que tu cherches
Structure, dimensions publiées (portées, hauteur, largeur, nombre de piles ou d'arches, forme des piles, type de
garde-corps), et l'aspect. Fais quelques recherches web (Wikipedia FR/DE, structurae.net, sites des cantons, OFROU),
puis **regarde 2 à 4 photos** : télécharge chaque image (jpg/png, < 3 Mo, Wikimedia Commons de préférence) avec curl
dans le dossier indiqué dans ta mission, puis ouvre-la avec l'outil Read. Garde la meilleure vue d'ensemble sous le nom
`photo.jpg` dans ce dossier (c'est elle qu'on montrera au propriétaire à côté du modèle 3D), et note sa page source et
son auteur et sa licence. N'installe rien.

## Sortie : un seul fichier JSON
Coordonnées MN95 (EPSG:2056), altitudes en m (NF02). `s` = distance le long de l'axe depuis son premier point.

```json
{
  "nom": "Pont de …, Ville",
  "axe": [[E, N, Z_chaussee], ...],     // 2 à 8 points sur le dessus de la chaussée, d'une culée à l'autre (suis les courbes)
  "largeur": 12.0,                      // largeur totale du tablier, garde-corps compris (m)
  "largeur_dessous": 8.0,               // facultatif : largeur du dessous (caisson ou poutres en retrait) ; sinon = largeur
  "epaisseur": 1.2,                     // épaisseur du tablier en travée (chaussée -> dessous)
  "epaisseur_appuis": 3.0,              // facultatif : épaisseur au droit des piles (tablier à hauteur variable)
  "gousset": 25,                        // facultatif : longueur (m) de part et d'autre d'une pile où l'épaisseur varie
  "garde_corps": {"hauteur": 1.1, "plein": true, "epaisseur": 0.4},   // plein = parapet ; sinon ajouré ("pas": 2.5)
  "appuis": [
    {"type": "culee", "s": 0},
    {"type": "pile", "s": 45.0, "forme": "rect", "long": 3.0, "larg": 10.0, "z_bas": 480.0, "fruit": 0.02},
    {"type": "pile", "s": 90.0, "forme": "double", "long": 2.5, "larg": 12.0, "larg_colonne": 3.0, "z_bas": 478.0},
    {"type": "culee", "s": 170.0}
  ],                                    // forme : "rect" | "rond" | "double" (deux colonnes) ; long = le long de l'axe ;
                                        // larg = en travers (pour "double" : de bord à bord des deux colonnes) ;
                                        // fruit = élargissement par mètre de descente (de chaque côté)
  "arches": [
    {"s0": 3.0, "s1": 45.0, "z_naissance": 490.0, "z_cle": 505.0, "epaisseur": 1.5, "larg": 10.0, "plein": false,
     "nervures": 2, "larg_nervure": 2.5, "montants_pas": 6, "montant_ep": 0.8}
  ],                                    // plein=true : maçonnerie pleine jusqu'au tablier (voûte en pierre) ;
                                        // false : arc porteur et montants ; nervures = nombre d'arcs parallèles ;
                                        // "forme": "cintre" = arc de cercle (plein cintre, surhaussé si flèche > ouverture/2,
                                        // ou surbaissé), sinon parabole ; arc asymétrique : "s_cle" (clé décentrée) et
                                        // "z_naissance_fin" (altitude de la seconde naissance) ; "montants_pas": 9999 = pas
                                        // de montants réguliers (voiles posés comme des piles)
  "pylones": [
    {"s": 300.0, "forme": "mat", "z_bas": 560.0, "z_haut": 680.0, "epaisseur": 4.0, "ecart": 28.0}
  ],                                    // pont à haubans : forme "mat" (un mât dans l'axe), "H" ou "A" ; ecart = entre
                                        // les deux jambes au pied ; sinon []
  "haubans": {"nappe": "axiale", "nombre": 10, "pas": 12, "depart": 15, "epaisseur": 0.3},
                                        // facultatif : pour chaque pylône, de chaque côté, `nombre` haubans ancrés tous
                                        // les `pas` m à partir de `depart` m ; nappe "axiale" (milieu) ou "laterale" (bords)
  "sources": ["url", ...],
  "photo": {"fichier": "photo.jpg", "page": "url de la page", "auteur": "…", "licence": "…"},
  "photos_vues": 3,
  "confiance": "faible|moyenne|bonne",
  "notes": "deux ou trois phrases : ce qui est incertain, ce que le schéma ne sait pas représenter"
}
```

Contrôles avant de rendre le fichier :
- l'axe suit le tablier mesuré (bouts du résumé, courbe éventuelle), altitudes = colonne `chaussee` ;
- chaque pile est à un `s` où le résumé montre des points sous le tablier, ou là où les sources la placent ;
- `z_bas` des piles ≈ terrain mesuré à ce `s` (ou le fond de l'eau) ;
- pour un arc : naissances ≈ terrain près des culées ou des piles, clé sous le tablier ;
- les dimensions publiées et le relevé concordent à ~1 m près ; sinon, le relevé gagne pour les altitudes et la place.
