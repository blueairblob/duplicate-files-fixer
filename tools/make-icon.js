#!/usr/bin/env node
// make-icon.js — draws the app icon (two overlapping documents with a check
// mark on a rounded blue tile) and writes build/icon.png at 1024×1024.
// electron-builder converts it to .ico / .icns. No image libraries: shapes are
// rasterised with 4×4 supersampling and encoded as PNG with zlib.
//
//   node tools/make-icon.js [out=build/icon.png] [size=1024]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'build', 'icon.png'));
const SIZE = Number(process.argv[3]) || 1024;
const SS = 4; // supersamples per axis

// Shapes in a 0..1 coordinate space, painted in order.
const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const thickLine = (ax, ay, bx, by, w) => (x, y) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - (ax + t * dx)) ** 2 + (y - (ay + t * dy)) ** 2 <= (w / 2) ** 2;
};

const layers = [
  { hit: roundRect(0.04, 0.04, 0.96, 0.96, 0.2),  rgba: [37, 99, 235, 255] },    // tile
  { hit: roundRect(0.20, 0.16, 0.62, 0.70, 0.05), rgba: [191, 211, 255, 255] },  // back document
  { hit: roundRect(0.36, 0.30, 0.80, 0.84, 0.05), rgba: [255, 255, 255, 255] },  // front document
  { hit: thickLine(0.47, 0.58, 0.55, 0.67, 0.065), rgba: [22, 163, 74, 255] },   // check, short stroke
  { hit: thickLine(0.55, 0.67, 0.70, 0.46, 0.065), rgba: [22, 163, 74, 255] },   // check, long stroke
];

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let py = 0; py < SIZE; py++) {
  const row = py * (SIZE * 4 + 1);
  raw[row] = 0; // filter: none
  for (let px = 0; px < SIZE; px++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const x = (px + (sx + 0.5) / SS) / SIZE;
        const y = (py + (sy + 0.5) / SS) / SIZE;
        let c = [0, 0, 0, 0];
        for (const l of layers) if (l.hit(x, y)) c = l.rgba;
        r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
      }
    }
    const o = row + 1 + px * 4;
    raw[o] = a ? Math.round(r / a) : 0;
    raw[o + 1] = a ? Math.round(g / a) : 0;
    raw[o + 2] = a ? Math.round(b / a) : 0;
    raw[o + 3] = Math.round(a / (SS * SS));
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]));
console.log(`wrote ${out} (${SIZE}×${SIZE})`);
