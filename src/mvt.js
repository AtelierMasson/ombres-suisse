// Lecture minimale d'une tuile vectorielle Mapbox (protobuf, spécification MVT 2.1) : une seule couche, ses polygones
// et leurs attributs. Sans dépendance : seules les surfaces d'eau des tuiles swisstopo (base.vt) en ont besoin.

/** Lecteur protobuf : varints, longueurs, entiers zigzag. */
class Lecteur {
  constructor(octets) { this.b = octets; this.p = 0; }
  varint() {
    let v = 0, m = 1, o;
    do { o = this.b[this.p++]; v += (o & 0x7f) * m; m *= 128; } while (o & 0x80);
    return v;
  }
  sauter(type) {
    if (type === 0) this.varint();
    else if (type === 1) this.p += 8;
    else if (type === 2) this.p += this.varint();
    else if (type === 5) this.p += 4;
    else throw new Error("protobuf : type " + type);
  }
  sous() { const l = this.varint(), r = new Lecteur(this.b.subarray(this.p, this.p + l)); this.p += l; return r; }
  fin() { return this.p >= this.b.length; }
}
const texte = new TextDecoder();
const zigzag = n => (n >>> 1) ^ -(n & 1);

/** Valeur d'attribut (message Value). */
function valeur(L) {
  let v = null;
  while (!L.fin()) {
    const cle = L.varint(), champ = cle >> 3, type = cle & 7;
    if (champ === 1) { const l = L.varint(); v = texte.decode(L.b.subarray(L.p, L.p + l)); L.p += l; }
    else if (champ === 2) { v = new DataView(L.b.buffer, L.b.byteOffset + L.p, 4).getFloat32(0, true); L.p += 4; }
    else if (champ === 3) { v = new DataView(L.b.buffer, L.b.byteOffset + L.p, 8).getFloat64(0, true); L.p += 8; }
    else if (champ === 4 || champ === 5) v = L.varint();
    else if (champ === 6) v = zigzag(L.varint());
    else if (champ === 7) v = !!L.varint();
    else L.sauter(type);
  }
  return v;
}

/** Anneaux d'une géométrie (commandes MoveTo / LineTo / ClosePath), en coordonnées de tuile. */
function anneaux(cmds) {
  const out = [];
  let x = 0, y = 0, cur = null;
  for (let i = 0; i < cmds.length;) {
    const c = cmds[i++], id = c & 7, n = c >> 3;
    if (id === 7) { if (cur) out.push(cur); cur = null; continue; }
    for (let k = 0; k < n; k++) {
      x += zigzag(cmds[i++]); y += zigzag(cmds[i++]);
      if (id === 1) { if (cur) out.push(cur); cur = [[x, y]]; } else cur.push([x, y]);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Entités de la couche `nom` : [{ type (1 point, 2 ligne, 3 polygone), props, anneaux }], `etendue` (souvent 4096).
 * Polygones : anneaux extérieurs (aire signée > 0 en coordonnées de tuile, y vers le bas) suivis de leurs trous.
 */
export function lireCouche(octets, nom) {
  const T = new Lecteur(octets);
  while (!T.fin()) {
    const cle = T.varint();
    if (cle >> 3 !== 3 || (cle & 7) !== 2) { T.sauter(cle & 7); continue; }
    const L = T.sous();
    let nomC = "", etendue = 4096;
    const cles = [], valeurs = [], brutes = [];
    while (!L.fin()) {
      const k = L.varint(), champ = k >> 3;
      if (champ === 1) { const l = L.varint(); nomC = texte.decode(L.b.subarray(L.p, L.p + l)); L.p += l; }
      else if (champ === 2) brutes.push(L.sous());
      else if (champ === 3) { const l = L.varint(); cles.push(texte.decode(L.b.subarray(L.p, L.p + l))); L.p += l; }
      else if (champ === 4) valeurs.push(valeur(L.sous()));
      else if (champ === 5) etendue = L.varint();
      else L.sauter(k & 7);
    }
    if (nomC !== nom) continue;
    const entites = brutes.map(F => {
      let type = 0, tags = [], geom = [];
      while (!F.fin()) {
        const k = F.varint(), champ = k >> 3;
        if (champ === 2 || champ === 4) {
          const S = F.sous(), a = [];
          while (!S.fin()) a.push(S.varint());
          if (champ === 2) tags = a; else geom = a;
        } else if (champ === 3) type = F.varint();
        else F.sauter(k & 7);
      }
      const props = {};
      for (let i = 0; i < tags.length; i += 2) props[cles[tags[i]]] = valeurs[tags[i + 1]];
      return { type, props, anneaux: anneaux(geom) };
    });
    return { entites, etendue };
  }
  return { entites: [], etendue: 4096 };
}
