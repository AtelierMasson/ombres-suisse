# Proche et lointain : un seul rendu (inventaire du 27.11.2026)

Constat : la maquette fine (0–300 m) et le grand périmètre (anneau, paysage) passent par des chemins de code différents. Chaque réglage doit donc être débogué deux fois. Aujourd'hui, il y a :
- **5 matières de sol** : `grainPlatre("sol")`, `materiauLointain` dans l'anneau, `materiauLointain` dans le paysage, `loin.mat` dans `vol.js`, la chaussée des ponts ;
- **5 mécanismes de découpe de zone** ;
- **3 à 4 matériaux de points d'arbres** ;
- **6 fonctions** qui poussent les réglages objet par objet, avec des listes différentes : `appliquerTheme`, `appliquerCalques`, `appliquerCoupe`, `placerSoleil`, `styleArbres` et les `caches` de l'occlusion.

## Écarts relevés

| Fonction | Proche | Lointain |
|---|---|---|
| Couleur selon la hauteur | oui | anneau oui (corrigé le 27.11) ; paysage, ponts et eau de l'anneau non |
| Grain | trame de 0,5 m, fondu quand elle est trop grande | seulement là où le plan est peint (rien avec le fond « uni »), fondu inverse ; deux copies de `bruit3` |
| Fond (cadastre, photo, bruit) | image unique de 2048 px (`fond()`) | `TuilesPlan` (2 nappes), composition du bruit écrite deux fois ; couleurs réelles seulement dans la maquette fine |
| Eau | `matEau` dont `grainPlatre` écrase `onBeforeCompile` (découpe `rayonEau` perdue) | `eauAnneau` sans grain ; paysage : lac peint et opaque ; `eauBord` écrasé et jamais reteinté |
| Sélection, surbrillance, visée | maquette fine | rien |
| Heures de soleil | sol, toits, murs | bâtiments swisstopo seulement |
| Coupe | tout est écrêté | `eauAnneau`, `eauBord` et `pontsAnneau` ne sont pas écrêtés ; le profil de l'anneau a le terrain seul |
| Calques arbres (voir / ombre) | appliqués | sans effet sur les arbres swisstopo de l'anneau |
| Thème | tout | `pontsAnneau`, teintes des points de l'anneau, `eauBord` non reteintés |
| Occlusion | l'eau en est retirée | `eauAnneau` y reste |
| Altitude, visée | `solEn(G)` | `altAnneau`, `solSous` ; `laserVolume` et les poignées ne connaissent que G |

## Architecture visée

1. **`src/matieres.js`** : une seule fabrique de shaders, faite de modules :
   - `grain`, `degrade`, `fondDrape` (la nappe fine plus les 2 nappes de tuiles), `lac` ;
   - `contact` / `sel` / `reel` / `heures` en coordonnées monde (hors de la grille, ils ne font rien) ;
   - `zone` (une seule découpe) et `faces` (toit ou mur selon la normale).

   Il y a **une instance par famille** (sol, bâti, eau, pont, points), partagée par le proche et le lointain. La différence entre les deux se limite à la géométrie et au niveau de détail. Les modules se composent au lieu d'écraser `onBeforeCompile`.
2. **`src/affichage.js`** : registre central des réglages.
   - `enregistrer(objet, famille, { zone })` pose la matière, les calques, l'ombre et la visée. Il sert aussi aux tuiles chargées plus tard ; le retrait se fait au déchargement.
   - `regler(cle, valeur)` change un uniforme commun, ou une matière par famille, ou parcourt le registre.
3. **`monde.js`** (docs/chargement-paysage-plan.md) : les tuiles du monde passent par `enregistrer` ; le terrain quantized-mesh reçoit la même `matiereSol()` que le terrain fin.
4. **Garde-fous** :
   - test d'invariants en Node (`tests/affichage.test.mjs`) : chaque famille a ses modules, et ses uniformes sont *le même objet* ;
   - page de contrôle qui rend proche et lointain côte à côte, pour chaque réglage et chaque thème, et mesure l'écart de teinte de part et d'autre du cercle.

## Ordre

| # | Étape | Effort |
|---|---|---|
| 0 | Test d'invariants et squelette de la page de contrôle | 0,5–1 j |
| 1 | Corrections isolées : calques des arbres de l'anneau, grain avec fond uni, thème (ponts, points, `eauBord`), coupe (eau, ponts), occlusion (`eauAnneau`), bogue `grainPlatre` sur l'eau, dégradé du paysage | ~1 j |
| 2 | `matieres.js`, avec `grainPlatre` et `materiauLointain` gardés comme alias | 1–1,5 j |
| 3 | Sol unique (nappe fine dans le fond drapé) pour la maquette fine, l'anneau, le paysage, la chaussée des ponts et `vol.js` | 1–1,5 j |
| 4 | Registre `affichage.js` ; `Swiss3D` passe par `enregistrer` ; `limiterZone` remplacé par le module de zone | 1,5–2 j |
| 5 | Matières uniques pour le bâti, les ponts et l'eau | 1–1,5 j |
| 6 | Un seul matériau de points d'arbres | 0,5 j |
| 7 | `altitude()` unique, visée par famille, profil de coupe de l'anneau avec les bâtiments | 1–2 j |
| 8 | `monde.js` | voir le plan de chargement |
