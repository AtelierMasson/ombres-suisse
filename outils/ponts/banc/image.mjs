// Petit dessin en mémoire (RGBA) et écriture PNG : vues de dessus de diagnostic
import { encode } from "fast-png";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
export class Image {
  constructor(w, h, fond = [255, 255, 255]) { this.w = w; this.h = h; this.d = new Uint8Array(w * h * 4); for (let p = 0; p < w * h; p++) this.d.set([...fond, 255], 4 * p); }
  px(x, y, c, a = 1) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return; const p = 4 * (y * this.w + x); for (let k = 0; k < 3; k++) this.d[p + k] = Math.max(0, Math.min(255, this.d[p + k] * (1 - a) + c[k] * a)); }
  rect(x0, y0, x1, y1, c, a = 1) { for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) this.px(x, y, c, a); }
  ligne(x0, y0, x1, y1, c, ep = 1, a = 1) { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0))); for (let k = 0; k <= n; k++) { const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n; for (let dy = 0; dy < ep; dy++) for (let dx = 0; dx < ep; dx++) this.px(x + dx - (ep >> 1), y + dy - (ep >> 1), c, a); } }
  croix(x, y, c, r = 4) { this.ligne(x - r, y - r, x + r, y + r, c, 2); this.ligne(x - r, y + r, x + r, y - r, c, 2); }
  ecrire(f) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, encode({ width: this.w, height: this.h, data: this.d, channels: 4 })); }
}
