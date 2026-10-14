// Génère native/build/icon.png (512×512) : carré arrondi indigo et cerveau stylisé blanc.
// Sans dépendance (PNG écrit à la main, zlib de Node). Usage : node native/scripts/make-icon.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const S = 512;
const px = Buffer.alloc(S * S * 4);
const set = (x, y, [r, g, b, a]) => {
  const i = (y * S + x) * 4;
  // composition simple « par-dessus »
  const ia = a / 255, oa = px[i + 3] / 255, na = ia + oa * (1 - ia);
  px[i] = Math.round((r * ia + px[i] * oa * (1 - ia)) / (na || 1));
  px[i + 1] = Math.round((g * ia + px[i + 1] * oa * (1 - ia)) / (na || 1));
  px[i + 2] = Math.round((b * ia + px[i + 2] * oa * (1 - ia)) / (na || 1));
  px[i + 3] = Math.round(na * 255);
};
const cov = (d) => Math.max(0, Math.min(1, 0.5 - d)); // anticrénelage
const roundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.max(x0 + r, Math.min(x1 - r, x)), cy = Math.max(y0 + r, Math.min(y1 - r, y));
  return Math.hypot(x - cx, y - cy) - r;
};
const BRAND = [63, 78, 224], WHITE = [255, 255, 255], PINK = [236, 112, 168];
// lobes du « cerveau » : cercles qui se chevauchent
const lobes = [[206, 214, 78], [306, 214, 78], [176, 300, 74], [256, 312, 84], [336, 300, 74]];
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const bg = cov(roundRect(x + 0.5, y + 0.5, 24, 24, 488, 488, 112));
    if (bg > 0) set(x, y, [...BRAND, Math.round(bg * 255)]);
    let d = Infinity;
    for (const [cx, cy, r] of lobes) d = Math.min(d, Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r);
    const c = cov(d);
    if (c > 0) set(x, y, [...PINK, Math.round(c * 255)]);
    // sillon central
    const groove = cov(Math.abs(x + 0.5 - 256) - 5) * (y > 150 && y < 380 ? 1 : 0) * c;
    if (groove > 0) set(x, y, [...WHITE, Math.round(groove * 200)]);
  }
}
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
mkdirSync("native/build", { recursive: true });
writeFileSync("native/build/icon.png", Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]));
console.log("native/build/icon.png");
