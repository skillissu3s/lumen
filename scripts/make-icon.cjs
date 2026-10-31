// Generates desktop/icon.png (512x512) — the Lumen mark: a rounded indigo
// square with a white ring, matching client/public/favicon.svg. Also writes
// client/public/favicon.svg if it is missing. No dependencies: PNG is encoded
// with node:zlib and a tiny CRC32.
const zlib = require('node:zlib')
const fs = require('node:fs')
const path = require('node:path')

const SIZE = 512
const SS = 4 // supersample factor for anti-aliased edges

const INDIGO = [0x4f, 0x46, 0xe5]
const WHITE = [0xff, 0xff, 0xff]

// Same proportions as favicon.svg (viewBox 0 0 32 32, rect rx 7, circle r 6.5,
// stroke 2.5), scaled to 512.
const CORNER_R = (SIZE * 7) / 32
const RING_R = (SIZE * 6.5) / 32
const RING_HALF = ((SIZE * 2.5) / 32) / 2

function roundRectInside(px, py) {
  const hw = SIZE / 2
  const qx = Math.abs(px - hw) - (hw - CORNER_R)
  const qy = Math.abs(py - hw) - (hw - CORNER_R)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - CORNER_R < 0
}

function ringInside(px, py) {
  const d = Math.hypot(px - SIZE / 2, py - SIZE / 2)
  return Math.abs(d - RING_R) <= RING_HALF
}

const px = Buffer.alloc(SIZE * SIZE * 4)

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const fx = x + (sx + 0.5) / SS
        const fy = y + (sy + 0.5) / SS
        if (ringInside(fx, fy)) {
          r += WHITE[0]; g += WHITE[1]; b += WHITE[2]; a += 255
        } else if (roundRectInside(fx, fy)) {
          r += INDIGO[0]; g += INDIGO[1]; b += INDIGO[2]; a += 255
        }
      }
    }
    const n = SS * SS
    const o = (y * SIZE + x) * 4
    px[o] = Math.round(r / n)
    px[o + 1] = Math.round(g / n)
    px[o + 2] = Math.round(b / n)
    px[o + 3] = Math.round(a / n)
  }
}

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let c = -1
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

const out = path.join(__dirname, '..', 'desktop', 'icon.png')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, encodePng(SIZE, SIZE, px))
console.log('wrote', out)

const favicon = path.join(__dirname, '..', 'client', 'public', 'favicon.svg')
if (!fs.existsSync(favicon)) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">\n' +
    '  <rect width="32" height="32" rx="7" fill="#4f46e5" />\n' +
    '  <circle cx="16" cy="16" r="6.5" fill="none" stroke="#ffffff" stroke-width="2.5" />\n' +
    '</svg>\n'
  fs.writeFileSync(favicon, svg)
  console.log('wrote', favicon)
}
