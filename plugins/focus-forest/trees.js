// Trees, drawn: layered, shaded foliage on a tapered trunk, standing on a small
// knoll of grass. Each species has a fixed shape (a seeded random), and a tree
// grows continuously with the session's progress rather than in steps.
;(() => {
  const species = [
    { id: 'oak', name: 'Oak' },
    { id: 'pine', name: 'Pine' },
    { id: 'cherry', name: 'Cherry blossom' },
    { id: 'maple', name: 'Maple' },
    { id: 'cactus', name: 'Cactus' },
  ]
  const stageNames = ['Seed', 'Sprout', 'Sapling', 'Young tree', 'Full tree']
  const STAGE_PROGRESS = [0.03, 0.16, 0.4, 0.75, 1]

  const PALETTE = {
    oak: { leaf: ['#25583a', '#347a46', '#4f9c55', '#86c46e'], trunk: ['#8b5e3c', '#5a3a24'] },
    pine: { leaf: ['#1d4636', '#285f45', '#3c8058', '#68a77a'], trunk: ['#7d5435', '#4f331f'] },
    cherry: { leaf: ['#b8547a', '#d97497', '#ef9fbb', '#ffd3e1'], trunk: ['#7b4a3b', '#4b2c23'] },
    maple: { leaf: ['#9c3a1c', '#c95a26', '#e8853a', '#ffc35c'], trunk: ['#7a5034', '#4b301f'] },
    cactus: { leaf: ['#2a6e4c', '#3a8e60', '#62b583', '#9fd8a8'], trunk: ['#c9a36b', '#9c7a47'] },
  }

  let uid = 0
  const rng = (seed) => {
    let s = seed >>> 0
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 4294967296
    }
  }
  const clamp = (v) => Math.max(0, Math.min(1, v))
  const lerp = (a, b, t) => a + (b - a) * t
  const ease = (t) => 1 - Math.pow(1 - clamp(t), 2.2)
  const f = (n) => Math.round(n * 10) / 10

  // the ground every tree stands on
  function knoll(id, sandy) {
    const top = sandy ? ['#e8cf96', '#cfae6c'] : ['#8fcf72', '#5fa553']
    return `<defs>
      <linearGradient id="kn${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top[0]}"/><stop offset="1" stop-color="${top[1]}"/></linearGradient>
    </defs>
    <ellipse cx="100" cy="186" rx="62" ry="7" fill="#000" opacity=".12"/>
    <path d="M40 178 Q100 158 160 178 Q100 192 40 178 Z" fill="url(#kn${id})"/>
    ${sandy ? '' : '<path d="M62 172 l2 -7 l2 7 M132 171 l2 -6 l2 6 M86 166 l1.6 -6 l1.6 6 M112 165 l1.6 -5 l1.6 5" stroke="#4c8f47" stroke-width="1.6" stroke-linecap="round" fill="none"/>'}`
  }

  // a trunk that narrows towards the top, with a little curve
  function trunk(id, h, wb, wt, colors, lean = 0) {
    const x = 100
    const y = 172
    return `<defs><linearGradient id="tr${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${colors[0]}"/><stop offset=".55" stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/></linearGradient></defs>
    <path d="M${f(x - wb / 2)} ${y} C${f(x - wb / 2)} ${f(y - h * 0.5)} ${f(x - wt / 2 + lean)} ${f(y - h * 0.7)} ${f(x - wt / 2 + lean)} ${f(y - h)} L${f(x + wt / 2 + lean)} ${f(y - h)} C${f(x + wt / 2 + lean)} ${f(y - h * 0.7)} ${f(x + wb / 2)} ${f(y - h * 0.5)} ${f(x + wb / 2)} ${y} Z" fill="url(#tr${id})"/>`
  }

  function branch(x1, y1, x2, y2, w, color) {
    return `<path d="M${f(x1)} ${f(y1)} Q${f((x1 + x2) / 2)} ${f(y1 - 2)} ${f(x2)} ${f(y2)}" stroke="${color}" stroke-width="${f(w)}" stroke-linecap="round" fill="none"/>`
  }

  // a round crown of overlapping blobs, shaded dark below-right and light above-left
  function crown(id, sp, cx, cy, r, t, seed) {
    const pal = PALETTE[sp].leaf
    const rand = rng(seed)
    const blobs = []
    // a fixed count, so the crown swells as it grows instead of reshuffling
    const n = 9
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand() * 0.6
      const d = r * (0.3 + rand() * 0.42)
      blobs.push({ x: cx + Math.cos(a) * d * 1.12, y: cy + Math.sin(a) * d * 0.82, r: r * (0.42 + rand() * 0.22) })
    }
    blobs.push({ x: cx, y: cy, r: r * 0.62 })
    const circles = (list, dx, dy, k, fill, extra = '') => list.map((b) => `<circle cx="${f(b.x + dx)}" cy="${f(b.y + dy)}" r="${f(b.r * k)}" fill="${fill}"${extra}/>`).join('')
    const top = blobs.filter((b) => b.y <= cy + r * 0.05)
    const dots = []
    if (sp === 'cherry' || sp === 'maple') {
      for (let i = 0; i < Math.round(lerp(4, 14, t)); i++) {
        const a = rand() * Math.PI * 2
        const d = r * Math.sqrt(rand()) * 0.95
        dots.push(`<circle cx="${f(cx + Math.cos(a) * d)}" cy="${f(cy + Math.sin(a) * d * 0.8)}" r="${f(r * (0.04 + rand() * 0.04))}" fill="${pal[3]}" opacity=".9"/>`)
      }
    }
    return `<defs>
      <clipPath id="cp${id}">${circles(blobs, 0, 0, 1, '#000')}</clipPath>
      <radialGradient id="lt${id}" cx=".32" cy=".25" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <radialGradient id="dk${id}" cx=".75" cy=".9" r=".7"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset=".7" stop-color="#000" stop-opacity="0"/></radialGradient>
    </defs>
    ${circles(blobs, r * 0.05, r * 0.09, 1, pal[0])}
    ${circles(blobs, 0, 0, 1, pal[1])}
    <g clip-path="url(#cp${id})">
      ${circles(top, -r * 0.07, -r * 0.1, 0.78, pal[2])}
      ${circles(top.slice(0, Math.ceil(top.length / 2)), -r * 0.14, -r * 0.18, 0.42, pal[3], ' opacity=".55"')}
      <rect x="${f(cx - r * 1.6)}" y="${f(cy - r * 1.4)}" width="${f(r * 3.2)}" height="${f(r * 2.8)}" fill="url(#lt${id})"/>
      <rect x="${f(cx - r * 1.6)}" y="${f(cy - r * 1.4)}" width="${f(r * 3.2)}" height="${f(r * 2.8)}" fill="url(#dk${id})"/>
    </g>
    ${dots.join('')}`
  }

  function broadleaf(id, sp, t) {
    const pal = PALETTE[sp]
    const h = lerp(24, 86, t)
    const r = lerp(17, 56, t)
    const cy = 172 - h - r * 0.32
    let out = trunk(id, h, lerp(4, 13, t), lerp(2.6, 6, t), pal.trunk)
    if (t > 0.25) {
      const w = lerp(1.5, 4, t) * clamp((t - 0.25) / 0.2)
      out += branch(100, 172 - h * 0.62, 100 - r * 0.5, 172 - h * 0.92, w, pal.trunk[1])
      out += branch(100, 172 - h * 0.72, 100 + r * 0.52, 172 - h * 1.0, w * 0.9, pal.trunk[1])
    }
    return out + crown(id, sp, 100, cy, r, t, sp === 'oak' ? 7 : sp === 'cherry' ? 19 : 31)
  }

  function pine(id, t) {
    const pal = PALETTE.pine
    const h = lerp(14, 34, t)
    let out = trunk(id, h + 6, lerp(4, 10, t), lerp(3, 5, t), pal.trunk)
    const tiers = t < 0.35 ? 1 : t < 0.7 ? 2 : 3
    const height = lerp(40, 130, t)
    const base = 172 - h
    const width = lerp(26, 92, t)
    out += `<defs><linearGradient id="pn${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${pal.leaf[2]}"/><stop offset=".48" stop-color="${pal.leaf[2]}"/><stop offset=".5" stop-color="${pal.leaf[1]}"/><stop offset="1" stop-color="${pal.leaf[0]}"/></linearGradient></defs>`
    for (let i = 0; i < tiers; i++) {
      const k = i / tiers
      const bottom = base - k * height * 0.55
      const top = bottom - height * (tiers === 1 ? 1 : 0.62)
      const w = width * (1 - k * 0.36)
      // a serrated hem along the bottom of each tier
      const teeth = 6
      let hem = ''
      for (let j = teeth; j >= 0; j--) {
        const x = 100 - w / 2 + (w * j) / teeth
        hem += ` L${f(x)} ${f(bottom - (j % 2 ? 4 : 0))}`
      }
      out += `<path d="M100 ${f(top)} L${f(100 + w / 2)} ${f(bottom)}${hem} Z" fill="url(#pn${id})" stroke="${pal.leaf[0]}" stroke-width=".6" stroke-linejoin="round"/>`
    }
    return out
  }

  function cactus(id, t) {
    const pal = PALETTE.cactus.leaf
    const h = lerp(26, 104, t)
    const w = lerp(14, 26, t)
    const x = 100 - w / 2
    const y = 174 - h
    let out = `<defs><linearGradient id="cc${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${pal[2]}"/><stop offset=".45" stop-color="${pal[1]}"/><stop offset="1" stop-color="${pal[0]}"/></linearGradient></defs>`
    const column = (cx, cy, cw, ch) => `<rect x="${f(cx)}" y="${f(cy)}" width="${f(cw)}" height="${f(ch)}" rx="${f(cw / 2)}" fill="url(#cc${id})"/>`
    if (t > 0.45) {
      const aw = w * 0.62
      out += `<path d="M${f(x + 2)} ${f(y + h * 0.52)} H${f(x - aw * 0.9)} V${f(y + h * 0.22)}" stroke="url(#cc${id})" stroke-width="${f(aw)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
    }
    if (t > 0.7) {
      const aw = w * 0.56
      out += `<path d="M${f(x + w - 2)} ${f(y + h * 0.66)} H${f(x + w + aw * 0.9)} V${f(y + h * 0.4)}" stroke="url(#cc${id})" stroke-width="${f(aw)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`
    }
    out += column(x, y, w, h + 4)
    out += `<path d="M${f(100 - w * 0.18)} ${f(y + 6)} V${f(y + h - 4)} M${f(100 + w * 0.18)} ${f(y + 6)} V${f(y + h - 4)}" stroke="${pal[3]}" stroke-width="1.2" opacity=".55"/>`
    if (t > 0.85) out += `<circle cx="100" cy="${f(y - 1)}" r="${f(lerp(3, 6, t))}" fill="#f0628f"/><circle cx="100" cy="${f(y - 1)}" r="${f(lerp(1.2, 2.2, t))}" fill="#ffd166"/>`
    return out
  }

  function sprout(id, sp, p) {
    const k = clamp((p - 0.06) / 0.16)
    const h = lerp(4, 22, k)
    const leaf = sp === 'cactus' ? PALETTE.cactus.leaf[1] : sp === 'pine' ? PALETTE.pine.leaf[2] : '#5fae5f'
    if (sp === 'cactus') return `<rect x="96" y="${f(172 - h)}" width="8" height="${f(h + 2)}" rx="4" fill="${leaf}"/>`
    const s = lerp(3, 9, k)
    return `<path d="M100 172 Q99 ${f(172 - h * 0.6)} 100 ${f(172 - h)}" stroke="#6b8f3e" stroke-width="${f(lerp(1.4, 2.6, k))}" stroke-linecap="round" fill="none"/>
      <path d="M100 ${f(172 - h)} q${f(-s)} ${f(-s * 0.2)} ${f(-s * 1.4)} ${f(-s * 0.9)} q${f(s * 0.9)} ${f(-s * 0.1)} ${f(s * 1.4)} ${f(s * 0.9)} Z" fill="${leaf}"/>
      <path d="M100 ${f(172 - h * 0.92)} q${f(s)} ${f(-s * 0.1)} ${f(s * 1.3)} ${f(-s * 0.8)} q${f(-s * 0.8)} ${f(0)} ${f(-s * 1.3)} ${f(s * 0.8)} Z" fill="${leaf}" opacity=".85"/>`
  }

  /**
   * A tree at `progress` (0 a seed, 1 full grown). `dead` withers it.
   * `ground: false` leaves out the knoll (for a scene with its own ground);
   * `box: { x, y, size }` places it inside a larger SVG.
   */
  function grow(sp, progress, dead = false, { ground = true, box = null } = {}) {
    const id = `t${++uid}`
    const kind = PALETTE[sp] ? sp : 'oak'
    const p = clamp(progress)
    let body
    if (p < 0.06) body = `<ellipse cx="100" cy="173" rx="16" ry="4.5" fill="#6b4a2e" opacity=".5"/><ellipse cx="100" cy="170" rx="${f(lerp(4, 6, p / 0.06))}" ry="3.6" fill="#8a5d36"/><ellipse cx="98.6" cy="168.9" rx="1.6" ry="1" fill="#c48d5a"/>`
    else if (p < 0.22) body = sprout(id, kind, p)
    else {
      const t = ease((p - 0.22) / 0.78)
      body = kind === 'pine' ? pine(id, t) : kind === 'cactus' ? cactus(id, t) : broadleaf(id, kind, t)
    }
    const place = box ? ` x="${f(box.x)}" y="${f(box.y)}" width="${f(box.size)}" height="${f(box.size)}" overflow="visible"` : ''
    return `<svg class="ff-tree species-${kind}${dead ? ' dead' : ''}"${place} viewBox="0 0 200 200" aria-hidden="true" focusable="false">${ground ? knoll(id, kind === 'cactus') : ''}<g class="ff-crown">${body}</g></svg>`
  }

  /** The tree at one of the five named stages */
  function render(sp, stage, dead = false) {
    const i = Math.max(0, Math.min(4, Math.floor(Number(stage)) || 0))
    return grow(sp, STAGE_PROGRESS[i], dead)
  }

  window.ForestTrees = { species, stageNames, render, grow }
})()
