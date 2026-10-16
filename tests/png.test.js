'use strict';

const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { cropViewportScreenshot } = require('../src/index.js');
const { cropPng, decodePng, encodePng, crc32 } = require('../src/png.js');

// A PNG of the given pixels, each row written with the filter `filters[y]`,
// so the decoder meets every filter as a browser's encoder may use them.
function pngWith({ width, height, bitDepth = 8, colorType = 6, chunks = [], interlace = 0 }, pixel, filters = []) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bpp = (channels * bitDepth) / 8;
  const stride = width * bpp;
  const rows = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const samples = pixel(x, y);
      for (let c = 0; c < channels; c++) {
        if (bitDepth === 16) rows.writeUInt16BE(samples[c], y * stride + x * bpp + c * 2);
        else rows[y * stride + x * bpp + c] = samples[c];
      }
    }
  }
  const packed = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length] || 0;
    packed[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const v = rows[y * stride + i];
      const a = i >= bpp ? rows[y * stride + i - bpp] : 0;
      const b = y ? rows[(y - 1) * stride + i] : 0;
      const c = y && i >= bpp ? rows[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      packed[y * (stride + 1) + 1 + i] = (v - [0, a, b, (a + b) >> 1, pr][filter]) & 0xff;
    }
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[12] = interlace;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...chunks.map((c) => chunk(c.type, c.data)),
    chunk('IDAT', zlib.deflateSync(packed)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// Each pixel says where it is: red its x, green its y.
const where = (x, y) => [x, y, 7, 255];

function pixelAt(png, x, y) {
  return Array.from(png.rows.subarray(y * png.stride + x * png.bpp, y * png.stride + (x + 1) * png.bpp));
}

test('crc32(): the standard check value', () => {
  assert.strictEqual(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('decodePng(): reads every row filter', () => {
  const png = decodePng(pngWith({ width: 9, height: 10 }, where, [0, 1, 2, 3, 4]));
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) assert.deepStrictEqual(pixelAt(png, x, y), [x, y, 7, 255], `${x},${y}`);
  }
});

test('cropPng(): cuts the box out, in every color type a browser writes', () => {
  const cases = [
    { colorType: 6, bitDepth: 8, pixel: where },
    { colorType: 2, bitDepth: 8, pixel: (x, y) => [x, y, 9] },
    { colorType: 0, bitDepth: 8, pixel: (x, y) => [x * 10 + y] },
    { colorType: 4, bitDepth: 8, pixel: (x, y) => [x, y] },
    { colorType: 6, bitDepth: 16, pixel: (x, y) => [x * 1000, y * 1000, 65535, 1] },
    { colorType: 2, bitDepth: 16, pixel: (x, y) => [x * 300, y * 300, 7] }
  ];
  for (const { colorType, bitDepth, pixel } of cases) {
    const image = pngWith({ width: 12, height: 8, colorType, bitDepth }, pixel, [4, 1, 0, 2, 3]);
    const cut = decodePng(cropPng(image, { x: 3, y: 2, width: 5, height: 4 }));
    assert.deepStrictEqual([cut.width, cut.height, cut.colorType, cut.bitDepth], [5, 4, colorType, bitDepth]);
    const whole = decodePng(image);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 5; x++) assert.deepStrictEqual(pixelAt(cut, x, y), pixelAt(whole, x + 3, y + 2), `type ${colorType}/${bitDepth} at ${x},${y}`);
    }
  }
});

test('cropPng(): keeps a palette and the color chunks', () => {
  const palette = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const srgb = Buffer.from([0]);
  const image = pngWith({ width: 4, height: 4, colorType: 3, chunks: [{ type: 'sRGB', data: srgb }, { type: 'PLTE', data: palette }] }, (x) => [x % 3]);
  const cut = decodePng(cropPng(image, { x: 1, y: 1, width: 2, height: 2 }));
  assert.deepStrictEqual(cut.chunks.map((c) => c.type), ['sRGB', 'PLTE']);
  assert.ok(cut.chunks[1].data.equals(palette));
  assert.deepStrictEqual([pixelAt(cut, 0, 0), pixelAt(cut, 1, 0)], [[1], [2]]);
});

test('cropPng(): clamps the box to the image, and refuses one outside it', () => {
  const image = pngWith({ width: 6, height: 6 }, where);
  const cut = decodePng(cropPng(image, { x: 4, y: -2, width: 10, height: 4 }));
  assert.deepStrictEqual([cut.width, cut.height], [2, 2]);
  assert.deepStrictEqual(pixelAt(cut, 0, 0), [4, 0, 7, 255]);
  assert.throws(() => cropPng(image, { x: 6, y: 0, width: 3, height: 3 }), /outside the 6x6 image/);
});

test('decodePng(): refuses what it cannot read, saying why', () => {
  const good = pngWith({ width: 3, height: 3 }, where);
  assert.throws(() => decodePng(Buffer.from('GIF89a......')), /not a PNG image/);
  assert.throws(() => decodePng(good.subarray(0, 40)), /truncated/);
  const damaged = Buffer.from(good);
  damaged[20] ^= 1;
  assert.throws(() => decodePng(damaged), /IHDR chunk fails its checksum/);
  assert.throws(() => decodePng(pngWith({ width: 3, height: 3, interlace: 1 }, where)), /interlaced/);
  assert.throws(() => decodePng(pngWith({ width: 8, height: 1, colorType: 0, bitDepth: 1 }, () => [1])), /bit depth 1/);
  assert.throws(() => decodePng(42), /a Buffer, a Uint8Array or a base64 string/);
});

test('encodePng(): what it writes decodes to the same pixels, and is smaller than unfiltered rows for a gradient', () => {
  const image = pngWith({ width: 64, height: 64 }, (x, y) => [x * 4, y * 4, (x + y) * 2, 255]);
  const png = decodePng(image);
  const again = encodePng(png, png.rows);
  assert.ok(decodePng(again).rows.equals(png.rows));
  assert.ok(again.length < image.length, `${again.length} < ${image.length}`);
});

test('cropViewportScreenshot(): scales CSS pixels by the image width over the viewport width', () => {
  // A 2x screenshot of a 10x6 CSS px viewport.
  const image = pngWith({ width: 20, height: 12 }, where);
  const cut = decodePng(cropViewportScreenshot(image.toString('base64'), { x: 2, y: 1, width: 3, height: 2 }, { viewport: { width: 10, height: 6 }, devicePixelRatio: 1 }));
  assert.deepStrictEqual([cut.width, cut.height], [6, 4]);
  assert.deepStrictEqual(pixelAt(cut, 0, 0), [4, 2, 7, 255]);
});

test('cropViewportScreenshot(): falls back to devicePixelRatio, and keeps partial pixels whole', () => {
  const image = pngWith({ width: 20, height: 12 }, where);
  const cut = decodePng(cropViewportScreenshot(new Uint8Array(image), { x: 1.25, y: 0.5, width: 2, height: 1 }, { devicePixelRatio: 2 }));
  // 2.5 .. 6.5 device px -> 2 .. 7; 1 .. 3 -> 1 .. 3.
  assert.deepStrictEqual([cut.width, cut.height], [5, 2]);
  assert.deepStrictEqual(pixelAt(cut, 0, 0), [2, 1, 7, 255]);
  assert.throws(() => cropViewportScreenshot(image, { x: 0, y: 0, width: NaN, height: 1 }), TypeError);
});
