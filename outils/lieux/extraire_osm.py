"""Liste interne des lieux notables de Suisse pour la recherche (cathédrales, hôtels de ville, ponts, châteaux, gares,
musées, stades, universités…), tirée d'OpenStreetMap (© contributeurs OpenStreetMap, ODbL) par l'API Overpass.
Seuls les objets avec un nom et une fiche Wikidata sont gardés (lieux connus). Coordonnées converties en MN95.

   python3 -I outils/lieux/extraire_osm.py public/lieux/lieux-ch.json

Sortie compacte : { "source": "...", "date": "...", "lieux": [[nom, type, E, N, localité, [autres noms]], …] }.
À relancer de temps en temps (les données OSM évoluent ; une fois par trimestre suffit).
"""
import json, sys, time, urllib.parse, urllib.request, math

sortie = sys.argv[1]
FILTRES = [
    'amenity~"^(townhall|place_of_worship|university|college|library|theatre|arts_centre|hospital|courthouse|parliament|marketplace|concert_hall)$"',
    'historic~"^(castle|monument|ruins|church|cathedral|monastery|fort|city_gate|tower|memorial|archaeological_site|manor|palace)$"',
    'tourism~"^(attraction|museum|viewpoint|gallery|zoo|theme_park)$"',
    'man_made~"^(bridge|tower|lighthouse|dam|water_tower|observatory)$"',
    'bridge~"^(yes|viaduct|aqueduct|covered|cantilever|suspension)$"',
    'building~"^(cathedral|church|chapel|civic|government|public|train_station|stadium|castle|palace|museum|university|townhall|monastery)$"',
    'leisure~"^(stadium|sports_centre|park|garden)$"',
    'railway~"^(station)$"',
    'waterway~"^(dam|waterfall)$"', 'natural~"^(waterfall)$"',
    'office~"^(government)$"',
]
corps = "".join(f'nwr[{f}]["name"]["wikidata"](area.ch);' for f in FILTRES)
requete = f'[out:json][timeout:600];area["ISO3166-1"="CH"][admin_level=2]->.ch;({corps});out center tags;'
SERVEURS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]


def overpass(q):
    # serveurs publics parfois surchargés (502, 504) : nouvelles tentatives, puis serveur de secours
    for essai in range(6):
        url = SERVEURS[essai % len(SERVEURS)]
        try:
            r = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "topograph-liste-lieux/1.0"})
            return json.load(urllib.request.urlopen(r, timeout=900))
        except Exception as e:
            print("Overpass", url, e, file=sys.stderr); time.sleep(20 * (essai + 1))
    raise SystemExit("Overpass indisponible")


d = overpass(requete)


def versMn95(lon, lat):  # formules approchées de swisstopo (~1 m)
    p = (lat * 3600 - 169028.66) / 10000; l = (lon * 3600 - 26782.5) / 10000
    E = 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l ** 3
    N = 1200147.07 + 308807.95 * p + 3745.25 * l * l + 76.63 * p * p - 194.56 * l * l * p + 119.79 * p ** 3
    return round(E), round(N)


def type_de(t):
    for k in ("amenity", "historic", "tourism", "man_made", "building", "leisure", "railway", "waterway", "natural", "office"):
        if k in t: return f"{k}={t[k]}"
    return "bridge" if "bridge" in t else ""


# localité la plus proche (ville, bourg, village) : pour distinguer les homonymes (« Hôtel de Ville, Fribourg »)
rq = '[out:json][timeout:300];area["ISO3166-1"="CH"][admin_level=2]->.ch;node[place~"^(city|town|village)$"]["name"](area.ch);out;'
pl = overpass(rq)
places = [(versMn95(x["lon"], x["lat"]), x["tags"]["name"], {"city": 0, "town": 1, "village": 2}[x["tags"]["place"]]) for x in pl["elements"]]
grille = {}
for (pe, pn), nom, rang in places: grille.setdefault((pe // 5000, pn // 5000), []).append((pe, pn, nom, rang))
def localite(E, N):
    best = (1e18, "")
    for i in range(-1, 2):
        for j in range(-1, 2):
            for pe, pn, nom, rang in grille.get((E // 5000 + i, N // 5000 + j), []):
                d = math.hypot(pe - E, pn - N) * (1 + 0.5 * rang)  # préférer la ville au hameau voisin
                if d < best[0]: best = (d, nom)
    return best[1]

vus, lieux = set(), []
for e in d.get("elements", []):
    t = e.get("tags", {}); c = e.get("center") or e
    if "lat" not in c: continue
    cle = t.get("wikidata")
    if cle in vus: continue
    vus.add(cle)
    E, N = versMn95(c["lon"], c["lat"])
    autres = sorted({t[k] for k in ("name:fr", "name:de", "name:it", "name:en", "alt_name", "official_name") if k in t and t[k] != t["name"]})
    lieux.append([t["name"], type_de(t), E, N, localite(E, N), autres])
lieux.sort(key=lambda x: x[0])
json.dump({"source": "© contributeurs OpenStreetMap (ODbL)", "date": time.strftime("%Y-%m-%d"), "lieux": lieux},
          open(sortie, "w"), ensure_ascii=False, separators=(",", ":"))
print(len(lieux), "lieux ->", sortie)
