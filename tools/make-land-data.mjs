// Builds two files from Natural Earth (public domain) via the world-atlas package:
//   public/textures/earth-water.png            white = water, for the globe's seas
//   native/NetLens.Core/countries.json         country code, name and centre point
// Run with: node tools/make-land-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { crc32, deflateSync } from 'node:zlib';
import { feature } from 'topojson-client';
import countriesLib from 'i18n-iso-countries';

const require = createRequire(import.meta.url);
const atlas = (name) => JSON.parse(readFileSync(require.resolve(`world-atlas/${name}`), 'utf8'));
const WIDTH = 1600;
const HEIGHT = 800;

/** Outlines can jump between +180 and -180. Make longitude continuous so the maths holds. */
function unwrap(ring) {
  let offset = 0;
  return ring.map(([x, y], i) => {
    if (i > 0) {
      const step = x - ring[i - 1][0];
      if (step > 180) offset -= 360;
      else if (step < -180) offset += 360;
    }
    return [x + offset, y];
  });
}

function polygonsOf(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return polygons.map((polygon) => polygon.map(unwrap));
}

/** Even-odd scanline fill of one polygon (outer ring plus holes). */
function fill(mask, polygon) {
  for (let y = 0; y < HEIGHT; y++) {
    const lat = 90 - ((y + 0.5) / HEIGHT) * 180;
    const crossings = [];
    for (const ring of polygon) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[i + 1];
        if (y1 > lat !== y2 > lat) crossings.push(x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.round(((crossings[i] + 180) / 360) * WIDTH);
      const to = Math.round(((crossings[i + 1] + 180) / 360) * WIDTH);
      // Some shapes run past the date line, so wrap around.
      for (let x = from; x < to; x++) mask[y * WIDTH + ((x % WIDTH) + WIDTH) % WIDTH] = 0;
    }
  }
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), data.length + 8);
  return out;
}

function writeGrayPng(path, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8; // bit depth
  const rows = Buffer.alloc((WIDTH + 1) * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) pixels.copy(rows, y * (WIDTH + 1) + 1, y * WIDTH, (y + 1) * WIDTH);
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}

// Water mask
const landTopo = atlas('land-50m.json');
const mask = Buffer.alloc(WIDTH * HEIGHT, 255);
for (const f of feature(landTopo, landTopo.objects.land).features) for (const polygon of polygonsOf(f.geometry)) fill(mask, polygon);
writeGrayPng('public/textures/earth-water.png', mask);

// Country centres: area-weighted centre of each country's largest landmass.
function centreOfLargest(polygons) {
  let best = { area: -1, lat: 0, lng: 0 };
  for (const [ring] of polygons) {
    let doubled = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      const cross = x1 * y2 - x2 * y1;
      doubled += cross;
      cx += (x1 + x2) * cross;
      cy += (y1 + y2) * cross;
    }
    const area = Math.abs(doubled / 2);
    if (area > best.area && doubled !== 0) {
      const lng = ((cx / (3 * doubled) + 540) % 360) - 180;
      best = { area, lat: cy / (3 * doubled), lng };
    }
  }
  return best;
}

const round = (v) => Math.round(v * 100) / 100;
const unassigned = { Kosovo: 'XK' }; // no ISO numeric code in the atlas
const topo = atlas('countries-50m.json');
const rows = [];
const skipped = [];
for (const f of feature(topo, topo.objects.countries).features) {
  const cc = unassigned[f.properties.name] ?? (f.id ? countriesLib.numericToAlpha2(f.id) : undefined);
  const { lat, lng, area } = centreOfLargest(polygonsOf(f.geometry));
  if (!cc || area < 0) {
    skipped.push(f.properties.name);
    continue;
  }
  rows.push({ cc, name: f.properties.name, lat: round(lat), lng: round(lng), area });
}
// Small territories can share a parent's code. The largest landmass keeps it.
const byCode = new Map();
for (const r of rows) if (!byCode.has(r.cc) || byCode.get(r.cc).area < r.area) byCode.set(r.cc, r);
const out = [...byCode.values()].map(({ area: _area, ...r }) => r).sort((a, b) => a.cc.localeCompare(b.cc));
writeFileSync('native/NetLens.Core/countries.json', JSON.stringify(out));
console.log(`${out.length} countries; no code: ${skipped.join(', ') || 'none'}`);
