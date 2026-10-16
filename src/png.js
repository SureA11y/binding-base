'use strict';

// Cuts a box out of a PNG image, for drivers whose only screenshot is the
// whole viewport (Selenium, WebdriverIO). It decodes and re-encodes the
// image itself with Node's zlib, so it needs no image library and nothing
// from the page: a canvas there could be blocked by the page's
// Content-Security-Policy or broken by its scripts.
//
// zlib is loaded through Node's own require with the id in a variable,
// which a bundler doesn't follow, as @surea11y/core/pack is in
// A11yCoreBuilderBase.js: a Cypress spec bundles this package for the
// browser, and never crops.
const ZLIB = 'zlib';
function loadZlib() {
  if (typeof module !== 'object' || !module || typeof module.require !== 'function') {
    throw new Error('PNG images are cropped in Node');
  }
  return module.require(ZLIB);
}

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);

// Samples per pixel for each PNG color type: greyscale, RGB, palette,
// greyscale with alpha, RGBA.
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// The chunks a cropped image keeps besides its pixels: the palette and
// transparency, and those that say how its colors and size are meant.
const KEPT_CHUNKS = new Set(['PLTE', 'tRNS', 'cHRM', 'gAMA', 'iCCP', 'sBIT', 'sRGB', 'pHYs']);

let crcTable = null;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function toBuffer(image) {
  if (typeof image === 'string') return Buffer.from(image, 'base64');
  if (Buffer.isBuffer(image)) return image;
  if (image instanceof Uint8Array) return Buffer.from(image.buffer, image.byteOffset, image.byteLength);
  throw new TypeError(`expected a PNG image as a Buffer, a Uint8Array or a base64 string, not ${image === null ? 'null' : typeof image}`);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Reads a PNG into its header, its kept chunks and its unfiltered rows.
 * Takes the 8- and 16-bit images browsers produce, in any color type, and
 * 8-bit palette images; throws for anything else, and for a damaged image.
 */
function decodePng(input) {
  const buf = toBuffer(input);
  if (buf.length < 8 || SIGNATURE.some((byte, i) => buf[i] !== byte)) throw new Error('not a PNG image');

  let header = null;
  const chunks = [];
  const data = [];
  let pos = 8;
  let ended = false;
  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const end = pos + 12 + length;
    if (end > buf.length) throw new Error(`the PNG image is truncated in its ${type} chunk`);
    if (buf.readUInt32BE(end - 4) !== crc32(buf.subarray(pos + 4, end - 4))) {
      throw new Error(`the PNG image is damaged: its ${type} chunk fails its checksum`);
    }
    const body = buf.subarray(pos + 8, end - 4);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        interlace: body[12]
      };
    } else if (type === 'IDAT') {
      data.push(body);
    } else if (type === 'IEND') {
      ended = true;
      break;
    } else if (KEPT_CHUNKS.has(type)) {
      chunks.push({ type, data: Buffer.from(body) });
    }
    pos = end;
  }
  if (!header) throw new Error('the PNG image has no header');
  if (!ended) throw new Error('the PNG image is truncated');

  const { width, height, bitDepth, colorType, interlace } = header;
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`the PNG image has an unknown color type ${colorType}`);
  if (interlace !== 0) throw new Error('interlaced PNG images are not supported');
  if (bitDepth !== 8 && !(bitDepth === 16 && colorType !== 3)) {
    throw new Error(`PNG images of bit depth ${bitDepth} are not supported (a browser's screenshot has 8 or 16)`);
  }

  const bpp = (channels * bitDepth) / 8;
  const stride = width * bpp;
  const packed = loadZlib().inflateSync(Buffer.concat(data));
  if (packed.length < height * (stride + 1)) throw new Error('the PNG image has fewer rows than its header says');

  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = packed[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    const cur = y * stride;
    const prev = cur - stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? rows[cur + i - bpp] : 0;
      const b = y > 0 ? rows[prev + i] : 0;
      const c = y > 0 && i >= bpp ? rows[prev + i - bpp] : 0;
      const x = packed[line + i];
      let value;
      switch (filter) {
        case 0: value = x; break;
        case 1: value = x + a; break;
        case 2: value = x + b; break;
        case 3: value = x + ((a + b) >> 1); break;
        case 4: value = x + paeth(a, b, c); break;
        default: throw new Error(`the PNG image has an unknown filter ${filter} on row ${y}`);
      }
      rows[cur + i] = value & 0xff;
    }
  }
  return { width, height, bitDepth, colorType, bpp, stride, chunks, rows };
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/**
 * Writes rows back into a PNG, choosing each row's filter by the usual
 * heuristic (the smallest sum of its bytes read as signed), which is what
 * keeps a screenshot small.
 */
function encodePng({ width, height, bitDepth, colorType, bpp, chunks = [] }, rows) {
  const stride = width * bpp;
  const packed = Buffer.alloc(height * (stride + 1));
  const candidates = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const cur = y * stride;
    const prev = cur - stride;
    let best = 0;
    let bestSum = Infinity;
    for (let filter = 0; filter < 5; filter++) {
      const line = candidates[filter];
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const x = rows[cur + i];
        const a = i >= bpp ? rows[cur + i - bpp] : 0;
        const b = y > 0 ? rows[prev + i] : 0;
        const c = y > 0 && i >= bpp ? rows[prev + i - bpp] : 0;
        let value;
        switch (filter) {
          case 0: value = x; break;
          case 1: value = x - a; break;
          case 2: value = x - b; break;
          case 3: value = x - ((a + b) >> 1); break;
          default: value = x - paeth(a, b, c);
        }
        value &= 0xff;
        line[i] = value;
        sum += value < 128 ? value : 256 - value;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = filter;
      }
    }
    packed[y * (stride + 1)] = best;
    candidates[best].copy(packed, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', ihdr),
    ...chunks.map((c) => chunk(c.type, c.data)),
    chunk('IDAT', loadZlib().deflateSync(packed)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/**
 * Cuts a box of whole pixels out of a PNG image.
 * @param {Buffer|Uint8Array|string} image a PNG, or one as base64
 * @param {{ x: number, y: number, width: number, height: number }} box in the image's pixels; clamped to the image
 * @returns {Buffer} the PNG of the box
 */
function cropPng(image, box) {
  const png = decodePng(image);
  const x0 = Math.max(0, Math.min(png.width, box.x));
  const y0 = Math.max(0, Math.min(png.height, box.y));
  const x1 = Math.max(x0, Math.min(png.width, box.x + box.width));
  const y1 = Math.max(y0, Math.min(png.height, box.y + box.height));
  const width = x1 - x0;
  const height = y1 - y0;
  if (width < 1 || height < 1) throw new Error(`the box ${JSON.stringify(box)} is outside the ${png.width}x${png.height} image`);

  const stride = width * png.bpp;
  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const from = (y0 + y) * png.stride + x0 * png.bpp;
    png.rows.copy(rows, y * stride, from, from + stride);
  }
  return encodePng({ ...png, width, height }, rows);
}

/**
 * For a binding's `_captureBox(box, view)` when its driver only takes the
 * whole viewport (Selenium's `driver.takeScreenshot()`, WebdriverIO's
 * `browser.takeScreenshot()`): cuts `box`, in CSS pixels relative to the
 * top-level viewport, out of that screenshot. The scale from CSS to image
 * pixels is measured, the image's width over the viewport's (`view.viewport`,
 * which already holds browser zoom and the device pixel ratio), and taken
 * from `view.devicePixelRatio` without one. Partial pixels at the edges are
 * kept whole.
 *
 * @param {Buffer|Uint8Array|string} image the viewport's PNG, or one as base64
 * @param {{ x: number, y: number, width: number, height: number }} box
 * @param {{ devicePixelRatio?: number, viewport?: { width: number, height: number } }} [view]
 *   the second argument `_captureBox()` is given
 * @returns {Buffer} the PNG of the box
 */
function cropViewportScreenshot(image, box, view = {}) {
  if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) {
    throw new TypeError('cropViewportScreenshot(): expected a box of finite { x, y, width, height }.');
  }
  const buf = toBuffer(image);
  const imageWidth = buf.length >= 24 ? buf.readUInt32BE(16) : 0;
  const viewportWidth = view && view.viewport && view.viewport.width;
  const scale = viewportWidth > 0 && imageWidth > 0
    ? imageWidth / viewportWidth
    : (view && view.devicePixelRatio > 0 ? view.devicePixelRatio : 1);
  // A tiny allowance, so floating point doesn't add a pixel row that holds
  // none of the box.
  const EPS = 1e-6;
  const x = Math.floor(box.x * scale + EPS);
  const y = Math.floor(box.y * scale + EPS);
  const right = Math.ceil((box.x + box.width) * scale - EPS);
  const bottom = Math.ceil((box.y + box.height) * scale - EPS);
  return cropPng(buf, { x, y, width: right - x, height: bottom - y });
}

module.exports = { cropPng, cropViewportScreenshot, decodePng, encodePng, crc32 };
