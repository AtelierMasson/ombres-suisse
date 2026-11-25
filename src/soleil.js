// Position du soleil (algorithme NOAA, précision ~0,01°). Azimut depuis le nord, sens horaire ; hauteur au-dessus de l'horizon.
const rad = Math.PI / 180;

export function positionSoleil(date, lat, lon) {
  const jd = date.getTime() / 86400000 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T)
    + Math.sin(3 * M * rad) * 0.000289;
  const omega = 125.04 - 1934.136 * T, lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan(eps * rad / 2) ** 2;
  const eqT = 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad)
    - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const ha = ((minutes + eqT + 4 * lon) / 4 - 180) * rad;
  const phi = lat * rad;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZ)));
  let az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / rad + 180;
  let h = 90 - zen / rad;
  // réfraction atmosphérique (près de l'horizon)
  if (h > -0.575) h += 1.02 / Math.tan((h + 10.3 / (h + 5.11)) * rad) / 60;
  return { azimut: (az + 360) % 360, hauteur: h };
}

/** Direction (x = est, y = haut, z = sud) vers le soleil, pour three.js. */
export function directionSoleil({ azimut, hauteur }) {
  const a = azimut * rad, h = hauteur * rad;
  return [Math.sin(a) * Math.cos(h), Math.sin(h), -Math.cos(a) * Math.cos(h)];
}

/** Date locale (fuseau du navigateur) d'un jour + minutes depuis minuit. */
export function dateA(jour, minutes) {
  const d = new Date(jour + "T00:00:00");
  d.setMinutes(minutes);
  return d;
}
