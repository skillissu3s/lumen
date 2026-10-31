;(() => {
  const { species: SPECIES, stageNames, grow: growTree } = window.ForestTrees

  const DEFAULT_SETTINGS = {
    defaultDuration: 25,
    defaultSpecies: 'oak',
    strictMode: false,
    shortBreak: 5,
    longBreak: 15,
    sound: true,
    lastTag: '',
  }

  // how many times a tree is redrawn over a session
  const GROWTH_STEPS = 400

  const RANGES = [
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'Week' },
    { id: 'month', label: 'Month' },
    { id: 'year', label: 'Year' },
  ]

  const els = {
    tabFocus: document.getElementById('tab-focus'),
    tabForest: document.getElementById('tab-forest'),
    panelFocus: document.getElementById('panel-focus'),
    panelForest: document.getElementById('panel-forest'),
    focusView: document.getElementById('focus-view'),
    forestView: document.getElementById('forest-view'),
    settingsButton: document.getElementById('settings-button'),
    settingsDialog: document.getElementById('settings-dialog'),
    setDuration: document.getElementById('set-duration'),
    setDurationOut: document.getElementById('set-duration-out'),
    setSpecies: document.getElementById('set-species'),
    setShortBreak: document.getElementById('set-short-break'),
    setLongBreak: document.getElementById('set-long-break'),
    setStrict: document.getElementById('set-strict'),
    setSound: document.getElementById('set-sound'),
    confirmDialog: document.getElementById('confirm-dialog'),
    confirmText: document.getElementById('confirm-text'),
    sessionDialog: document.getElementById('session-dialog'),
    sessionTitle: document.getElementById('session-title'),
    sessionDetail: document.getElementById('session-detail'),
    sessionClose: document.getElementById('session-close'),
  }

  const state = {
    settings: { ...DEFAULT_SETTINGS },
    sessions: [],
    tasks: [],
    phase: 'loading',
    view: 'focus',
    plant: {
      duration: DEFAULT_SETTINGS.defaultDuration,
      species: DEFAULT_SETTINGS.defaultSpecies,
      task: null,
      tag: '',
    },
    current: null,
    result: null,
    break: null,
    forestRange: 'today',
    awaySince: null,
  }

  let refs = {}
  let viewCleanup = null
  let lastStage = -1
  let lastGrowth = -1
  let lastAriaKey = ''
  let lastStatus = null
  let audioCtx = null

  function clamp01(value) {
    return Math.min(1, Math.max(0, value))
  }

  function clampDuration(value) {
    if (!Number.isFinite(value)) return DEFAULT_SETTINGS.defaultDuration
    return Math.min(180, Math.max(10, Math.round(value / 5) * 5))
  }

  function clampBreak(value, fallback) {
    if (!Number.isFinite(value)) return fallback
    return Math.min(60, Math.max(1, Math.round(value)))
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]))
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID()
    }
    return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  }

  function formatClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    if (hours) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  function formatMinutes(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0))
    const hours = Math.floor(total / 60)
    const rest = total % 60
    if (hours && rest) return `${hours}h ${rest}m`
    if (hours) return `${hours}h`
    return `${rest}m`
  }

  function localDayKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  function formatDateTime(date) {
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
    } catch {
      return date.toISOString()
    }
  }

  function speciesName(id) {
    const found = SPECIES.find((item) => item.id === id)
    return found ? found.name : 'Oak'
  }

  // the stage names follow the drawing: a seed, a sprout, then a crown that fills out
  function stageFor(progress) {
    const value = clamp01(progress)
    if (value >= 1) return 4
    if (value >= 0.55) return 3
    if (value >= 0.22) return 2
    if (value >= 0.06) return 1
    return 0
  }

  function treeWord(count) {
    return count === 1 ? 'tree' : 'trees'
  }

  function taskTitle(task) {
    return task.label || task.title || 'Untitled task'
  }

  function normalizeSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {}
    const settings = { ...DEFAULT_SETTINGS, ...source }
    settings.defaultDuration = clampDuration(Number(settings.defaultDuration))
    if (!SPECIES.some((item) => item.id === settings.defaultSpecies)) {
      settings.defaultSpecies = DEFAULT_SETTINGS.defaultSpecies
    }
    settings.strictMode = Boolean(settings.strictMode)
    settings.sound = Boolean(settings.sound)
    settings.shortBreak = clampBreak(Number(settings.shortBreak), DEFAULT_SETTINGS.shortBreak)
    settings.longBreak = clampBreak(Number(settings.longBreak), DEFAULT_SETTINGS.longBreak)
    settings.lastTag = typeof settings.lastTag === 'string' ? settings.lastTag : ''
    return settings
  }

  function parseSessions(text) {
    if (!text) return []
    const rows = []
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line)
        if (row && typeof row.start === 'string' && Number.isFinite(Number(row.planned))) {
          rows.push(row)
        }
      } catch {}
    }
    return rows
  }

  function saveSettings() {
    lumen.storage.set('settings', state.settings).catch(() => {})
  }

  function clearCurrent() {
    return lumen.storage.set('current', null).catch(() => {})
  }

  async function recordSession(row) {
    if (state.sessions.some((item) => item.start === row.start)) return
    state.sessions.push(row)
    try {
      await lumen.storage.append('sessions.jsonl', `${JSON.stringify(row)}\n`)
    } catch (error) {
      console.warn('Focus Forest: could not save the session', error)
    }
  }

  function makeRow(current, status, endMs) {
    const actual = status === 'grown'
      ? current.planned
      : Math.max(0, Math.round((endMs - current.startMs) / 60000))
    return {
      id: uid(),
      start: current.start,
      end: new Date(endMs).toISOString(),
      planned: current.planned,
      actual,
      status,
      species: current.species,
      task: current.task
        ? { path: current.task.path, id: current.task.id, title: current.task.title }
        : null,
      tag: current.tag || null,
    }
  }

  function setStatusText(text) {
    if (text === lastStatus) return
    lastStatus = text
    lumen.ui.setStatus(text).catch(() => {})
  }

  function focusElement(element) {
    if (!element || typeof element.focus !== 'function') return
    requestAnimationFrame(() => element.focus({ preventScroll: true }))
  }

  function ensureAudio() {
    if (!audioCtx) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext
        if (AudioContext) audioCtx = new AudioContext()
      } catch {}
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
  }

  function chime() {
    if (!state.settings.sound) return
    ensureAudio()
    if (!audioCtx) return
    const start = audioCtx.currentTime
    const notes = [523.25, 659.25, 783.99]
    notes.forEach((frequency, index) => {
      const oscillator = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      const at = start + index * 0.12
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.14, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5)
      oscillator.connect(gain).connect(audioCtx.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.55)
    })
  }

  function todayStats() {
    const key = localDayKey(new Date())
    const today = state.sessions.filter((session) => localDayKey(new Date(session.start)) === key)
    return {
      grown: today.filter((session) => session.status === 'grown').length,
      minutes: today.reduce((sum, session) => sum + (Number(session.actual) || 0), 0),
    }
  }

  function nextBreakLength() {
    const count = todayStats().grown
    return count > 0 && count % 4 === 0 ? state.settings.longBreak : state.settings.shortBreak
  }

  function sessionsInRange(range) {
    const now = new Date()
    const byStart = (a, b) => new Date(a.start) - new Date(b.start)
    if (range === 'today') {
      const key = localDayKey(now)
      return state.sessions
        .filter((session) => localDayKey(new Date(session.start)) === key)
        .sort(byStart)
    }
    let start
    if (range === 'week') {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const offset = (day.getDay() + 6) % 7
      start = new Date(day.getFullYear(), day.getMonth(), day.getDate() - offset)
    } else if (range === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
    } else {
      start = new Date(now.getFullYear(), 0, 1)
    }
    return state.sessions
      .filter((session) => new Date(session.start) >= start)
      .sort(byStart)
  }

  function currentStreak() {
    const days = new Set(
      state.sessions
        .filter((session) => session.status === 'grown')
        .map((session) => localDayKey(new Date(session.start)))
    )
    const cursor = new Date()
    cursor.setHours(0, 0, 0, 0)
    if (!days.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
    let streak = 0
    while (days.has(localDayKey(cursor))) {
      streak += 1
      cursor.setDate(cursor.getDate() - 1)
    }
    return streak
  }

  function groupBy(sessions, keyFor) {
    const groups = new Map()
    for (const session of sessions) {
      const key = keyFor(session)
      const group = groups.get(key) || { key, minutes: 0, count: 0 }
      group.minutes += Number(session.actual) || 0
      group.count += 1
      groups.set(key, group)
    }
    return [...groups.values()].sort((a, b) => b.minutes - a.minutes)
  }

  function barsMarkup(groups, emptyText) {
    if (!groups.length) return `<p class="empty-note">${escapeHtml(emptyText)}</p>`
    const max = Math.max(...groups.map((group) => group.minutes), 1)
    return `<div class="bars">${groups.map((group) => `
      <div class="bar-row">
        <div class="bar-label"><span>${escapeHtml(group.key)}</span><span>${formatMinutes(group.minutes)}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, (group.minutes / max) * 100)}%"></div></div>
      </div>`).join('')}</div>`
  }

  // the sky follows the clock
  function skyNow(date = new Date()) {
    const hour = date.getHours() + date.getMinutes() / 60
    if (hour >= 5 && hour < 8) return 'dawn'
    if (hour >= 8 && hour < 17.5) return 'day'
    if (hour >= 17.5 && hour < 20.5) return 'dusk'
    return 'night'
  }

  // where the tree stands in the scene: its ground line meets the hill's crest
  const TREE_BOX = { x: 215, y: 52, size: 170 }

  function sceneTree(species, progress, dead = false) {
    return growTree(species, progress, dead, { ground: false, box: TREE_BOX })
  }

  function hasPetals(species, progress, dead) {
    return !dead && progress >= 0.6 && (species === 'cherry' || species === 'maple')
  }

  const STARS = [[52, 30], [118, 62], [160, 22], [236, 48], [300, 18], [352, 70], [392, 34], [508, 26], [548, 74], [584, 40], [86, 96], [462, 98]]
    .map(([x, y], i) => `<circle class="star${i % 3 ? '' : ' twinkle'}" cx="${x}" cy="${y}" r="${i % 4 ? 1.1 : 1.6}"></circle>`)
    .join('')

  const CLOUD = '<ellipse cx="0" cy="0" rx="36" ry="11"></ellipse><circle cx="-13" cy="-7" r="12"></circle><circle cx="7" cy="-12" r="15"></circle><circle cx="24" cy="-4" r="9"></circle>'

  let glowId = 0

  // the sun by day, a crescent moon at night, each with a soft halo
  function sky(radius) {
    const id = `ff-glow-${++glowId}`
    const r = radius
    return `<defs><radialGradient id="${id}"><stop offset="0" style="stop-color:var(--sun-glow);stop-opacity:.75"></stop><stop offset="1" style="stop-color:var(--sun-glow);stop-opacity:0"></stop></radialGradient></defs>
      <g class="stars">${STARS}</g>
      <g class="sun"><circle r="${r * 2.6}" fill="url(#${id})"></circle><circle class="sun-disc" r="${r}"></circle></g>
      <g class="moon"><circle r="${r * 2.4}" fill="url(#${id})" opacity=".6"></circle><path class="moon-disc" d="M4 -${r} A${r} ${r} 0 1 0 4 ${r} A${r * 1.25} ${r * 1.25} 0 0 1 4 -${r} Z"></path></g>`
  }

  function landscape() {
    return `${sky(19)}
      <g transform="translate(0 50)"><g class="cloud drift-a">${CLOUD}</g></g>
      <g transform="translate(0 86) scale(.7)"><g class="cloud drift-b">${CLOUD}</g></g>
      <g transform="translate(0 34) scale(.55)"><g class="cloud drift-c">${CLOUD}</g></g>
      <path class="hill-far" d="M0 160 C60 138 130 136 200 150 C270 164 330 132 410 128 C480 124 540 146 600 140 V260 H0 Z"></path>
      <g class="hill-far-ink">
        <path d="M89 145 L96 125 L103 145 Z"></path><path d="M104 144 L109 130 L114 144 Z"></path>
        <circle cx="122" cy="135" r="7"></circle><rect x="121" y="138" width="2" height="7"></rect>
        <path d="M413 131 L420 111 L427 131 Z"></path><path d="M429 130 L435 116 L441 130 Z"></path>
        <circle cx="508" cy="127" r="8"></circle><rect x="507" y="130" width="2" height="7"></rect>
      </g>
      <path class="hill-mid" d="M0 196 C80 176 160 172 240 184 C320 196 380 178 460 172 C520 168 570 180 600 184 V260 H0 Z"></path>
      <path class="hill-near" d="M0 236 C90 226 190 200 300 196 C410 200 510 224 600 232 V260 H0 Z"></path>
      <ellipse class="mound" cx="300" cy="199" rx="64" ry="7"></ellipse>
      <path class="tufts" d="M140 216 l2 -8 l2 8 M156 212 l1.6 -6 l1.6 6 M440 210 l1.6 -6 l1.6 6 M456 214 l2 -8 l2 8 M236 204 l1.4 -5 l1.4 5 M366 203 l1.4 -5 l1.4 5"></path>
      <g class="flowers"><circle cx="118" cy="224" r="2"></circle><circle cx="186" cy="211" r="1.6"></circle><circle cx="486" cy="222" r="2"></circle></g>`
  }

  const PETALS = [[268, 98, 0], [322, 92, 1.6], [290, 120, 3.1], [340, 116, 4.4], [254, 124, 5.6], [306, 84, 6.8]]
    .map(([x, y, delay]) => `<ellipse class="petal" cx="${x}" cy="${y}" rx="3" ry="1.8" style="animation-delay:${delay}s"></ellipse>`)
    .join('')

  /** The landscape with the tree on its hill; `progress` adds the line along the bottom. */
  function sceneMarkup({ className = '', ariaLabel, tree, progress = null, badge = '', petals = false }) {
    const line = progress === null
      ? ''
      : `<div class="scene-progress"><span class="ring-progress" style="transform:scaleX(${clamp01(progress)})"></span></div>`
    return `<div class="scene sky-${skyNow()} ${className}${petals ? ' has-petals' : ''}" id="ring-timer" role="timer" tabindex="-1" aria-label="${escapeHtml(ariaLabel)}">
      <svg class="scene-art" viewBox="0 0 600 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        ${landscape()}
        <g class="tree-sway"><g class="tree-holder" id="tree-holder">${tree}</g></g>
        <g class="petals">${PETALS}</g>
      </svg>
      ${badge ? `<span class="scene-badge" id="stage-label">${escapeHtml(badge)}</span>` : ''}
      ${line}
    </div>`
  }

  // a new sky when the hour turns while the page stays open
  function syncSky() {
    if (!refs.ring) return
    const sky = `sky-${skyNow()}`
    if (refs.ring.classList.contains(sky)) return
    refs.ring.classList.remove('sky-dawn', 'sky-day', 'sky-dusk', 'sky-night')
    refs.ring.classList.add(sky)
  }

  function pop(element) {
    if (!element) return
    element.classList.remove('pop')
    void element.getBoundingClientRect()
    element.classList.add('pop')
  }

  function cacheRefs(root) {
    refs = {
      ring: root.querySelector('#ring-timer'),
      progress: root.querySelector('.ring-progress'),
      time: root.querySelector('#ring-time'),
      tree: root.querySelector('#tree-holder'),
      stage: root.querySelector('#stage-label'),
    }
  }

  function cleanupView() {
    if (!viewCleanup) return
    viewCleanup()
    viewCleanup = null
  }

  function render() {
    cleanupView()
    const focus = state.view === 'focus'
    els.tabFocus.setAttribute('aria-selected', String(focus))
    els.tabFocus.tabIndex = focus ? 0 : -1
    els.tabForest.setAttribute('aria-selected', String(!focus))
    els.tabForest.tabIndex = focus ? -1 : 0
    els.panelFocus.hidden = !focus
    els.panelForest.hidden = focus
    if (focus) renderFocus()
    else renderForest()
  }

  function renderFocus() {
    cleanupView()
    refs = {}
    lastStage = -1
    lastAriaKey = ''
    if (state.phase === 'idle' || state.phase === 'loading') renderPlant(els.focusView)
    else if (state.phase === 'growing') renderGrowing(els.focusView)
    else if (state.phase === 'result') renderResult(els.focusView)
    else if (state.phase === 'break') renderBreak(els.focusView)
  }

  function renderPlant(root) {
    const duration = state.plant.duration
    const species = state.plant.species
    const selectedTask = state.plant.task
    root.innerHTML = `<div class="focus-screen">
      ${sceneMarkup({
        className: 'is-plant',
        ariaLabel: `Focus timer, ${duration} minutes`,
        tree: sceneTree(species, 1),
      })}
      <div class="readout">
        <div class="time" id="ring-time">${formatClock(duration * 60000)}</div>
        <p class="under-ring" id="ring-caption">Ready to plant · ${escapeHtml(speciesName(species))}</p>
      </div>
      <div class="controls">
        <fieldset class="control-group">
          <legend>Duration</legend>
          <div class="chips" role="group" aria-label="Duration presets">
            ${[15, 25, 45, 60, 90].map((minutes) => `<button type="button" class="chip" data-duration="${minutes}" aria-pressed="${minutes === duration}">${minutes} min</button>`).join('')}
          </div>
          <label class="slider-row">
            <span class="sr-only">Duration in minutes</span>
            <input type="range" id="duration-range" min="10" max="180" step="5" value="${duration}">
            <output id="duration-out" for="duration-range">${duration} min</output>
          </label>
        </fieldset>
        <div class="two-col">
          <div class="control-group">
            <span class="field-label" id="task-heading">Task <span class="hint">optional</span></span>
            <div class="task-select" id="task-select">
              <button type="button" class="select-button" id="task-button" aria-haspopup="listbox" aria-expanded="false" aria-controls="task-popover" aria-labelledby="task-heading task-value">
                <span class="select-value${selectedTask ? '' : ' is-placeholder'}" id="task-value">${escapeHtml(selectedTask ? selectedTask.title : 'No task')}</span>
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg>
              </button>
              <div class="select-popover" id="task-popover" hidden>
                <input type="search" class="search-input" id="task-search" placeholder="Search tasks" aria-label="Search tasks" aria-controls="task-options" aria-autocomplete="list" autocomplete="off">
                <ul class="option-list" id="task-options" role="listbox" aria-label="Tasks"></ul>
              </div>
            </div>
          </div>
          <div class="control-group">
            <label class="field-label" for="tag-input">Tag <span class="hint">optional</span></label>
            <input type="text" id="tag-input" maxlength="40" placeholder="e.g. writing" autocomplete="off" value="${escapeHtml(state.plant.tag)}">
          </div>
        </div>
        <fieldset class="control-group">
          <legend>Tree</legend>
          <div class="species-grid">
            ${SPECIES.map((item) => `<button type="button" class="species" data-species="${item.id}" aria-pressed="${item.id === species}" title="${escapeHtml(item.name)}">
              <span class="species-tree" aria-hidden="true">${growTree(item.id, 1)}</span>
              <span class="species-name">${escapeHtml(item.name)}</span>
            </button>`).join('')}
          </div>
        </fieldset>
        <button type="button" class="button primary big" id="plant-button">Plant</button>
      </div>
    </div>`

    setupDuration(root)
    setupSpecies(root)
    setupTaskSelect(root)
    root.querySelector('#tag-input').addEventListener('input', (event) => {
      state.plant.tag = event.target.value
    })
    root.querySelector('#plant-button').addEventListener('click', () => startSession())
  }

  function setupDuration(root) {
    const range = root.querySelector('#duration-range')
    const output = root.querySelector('#duration-out')
    const chips = [...root.querySelectorAll('[data-duration]')]
    const sync = (value) => {
      state.plant.duration = clampDuration(Number(value))
      range.value = String(state.plant.duration)
      output.textContent = `${state.plant.duration} min`
      chips.forEach((chip) => {
        chip.setAttribute('aria-pressed', String(Number(chip.dataset.duration) === state.plant.duration))
      })
      const time = root.querySelector('#ring-time')
      if (time) time.textContent = formatClock(state.plant.duration * 60000)
      const ring = root.querySelector('#ring-timer')
      if (ring) ring.setAttribute('aria-label', `Focus timer, ${state.plant.duration} minutes`)
    }
    range.addEventListener('input', () => sync(range.value))
    chips.forEach((chip) => chip.addEventListener('click', () => sync(chip.dataset.duration)))
    sync(state.plant.duration)
  }

  function setupSpecies(root) {
    const buttons = [...root.querySelectorAll('[data-species]')]
    buttons.forEach((button) => button.addEventListener('click', () => {
      state.plant.species = button.dataset.species
      buttons.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.species === state.plant.species)))
      const holder = root.querySelector('#tree-holder')
      if (holder) {
        holder.innerHTML = sceneTree(state.plant.species, 1)
        pop(holder)
      }
      const caption = root.querySelector('#ring-caption')
      if (caption) caption.textContent = `Ready to plant · ${speciesName(state.plant.species)}`
    }))
  }

  function setupTaskSelect(root) {
    const select = root.querySelector('#task-select')
    const button = root.querySelector('#task-button')
    const popover = root.querySelector('#task-popover')
    const search = root.querySelector('#task-search')
    const list = root.querySelector('#task-options')
    const today = localDayKey(new Date())
    let active = -1
    let filtered = []

    const sortedTasks = () => [...state.tasks].sort((a, b) => {
      const aToday = a.date === today ? 0 : 1
      const bToday = b.date === today ? 0 : 1
      if (aToday !== bToday) return aToday - bToday
      return taskTitle(a).localeCompare(taskTitle(b))
    })

    const close = ({ focusButton = false } = {}) => {
      popover.hidden = true
      button.setAttribute('aria-expanded', 'false')
      search.removeAttribute('aria-activedescendant')
      if (focusButton) button.focus()
    }

    const updateActive = () => {
      const options = [...list.querySelectorAll('[role="option"]')]
      options.forEach((option, index) => option.classList.toggle('is-active', index === active))
      if (active >= 0 && options[active]) {
        search.setAttribute('aria-activedescendant', options[active].id)
        options[active].scrollIntoView({ block: 'nearest' })
      } else {
        search.removeAttribute('aria-activedescendant')
      }
    }

    const renderOptions = () => {
      const rows = [{ none: true }, ...filtered]
      list.innerHTML = rows.map((task, index) => {
        if (task.none) {
          return `<li role="option" class="option${index === active ? ' is-active' : ''}" id="task-option-${index}" data-index="${index}" aria-selected="${state.plant.task ? 'false' : 'true'}">
            <span class="option-title">No task</span>
            <span class="option-meta">Focus without a task</span>
          </li>`
        }
        return `<li role="option" class="option${index === active ? ' is-active' : ''}" id="task-option-${index}" data-index="${index}" aria-selected="${state.plant.task && state.plant.task.id === task.id ? 'true' : 'false'}">
          <span class="option-title">${escapeHtml(taskTitle(task))}</span>
          <span class="option-meta">${escapeHtml(task.list && task.list.name ? task.list.name : '')}${task.date === today ? ' · Today' : ''}</span>
        </li>`
      }).join('')
      if (!filtered.length) {
        list.insertAdjacentHTML('beforeend', '<li class="option-empty" role="presentation">No matching tasks</li>')
      }
      updateActive()
    }

    const filter = (query) => {
      const needle = query.trim().toLowerCase()
      filtered = sortedTasks().filter((task) => !needle || taskTitle(task).toLowerCase().includes(needle))
      const selectedId = state.plant.task ? state.plant.task.id : null
      const selectedIndex = filtered.findIndex((task) => task.id === selectedId)
      active = selectedIndex >= 0 ? selectedIndex + 1 : 0
      renderOptions()
    }

    const choose = (index) => {
      const rows = [{ none: true }, ...filtered]
      const task = rows[index]
      if (!task) return
      state.plant.task = task.none
        ? null
        : { path: task.path, id: task.id, title: taskTitle(task) }
      const value = root.querySelector('#task-value')
      value.textContent = state.plant.task ? state.plant.task.title : 'No task'
      value.classList.toggle('is-placeholder', !state.plant.task)
      close({ focusButton: true })
    }

    const open = () => {
      popover.hidden = false
      button.setAttribute('aria-expanded', 'true')
      search.value = ''
      filter('')
      search.focus()
    }

    button.addEventListener('click', () => {
      if (popover.hidden) open()
      else close({ focusButton: true })
    })
    button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (popover.hidden) open()
      }
    })
    search.addEventListener('input', () => filter(search.value))
    search.addEventListener('keydown', (event) => {
      const count = filtered.length + 1
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        active = Math.min(count - 1, active + 1)
        updateActive()
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        active = Math.max(0, active - 1)
        updateActive()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        choose(active)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        close({ focusButton: true })
      } else if (event.key === 'Tab') {
        close()
      }
    })
    list.addEventListener('click', (event) => {
      const option = event.target.closest('[role="option"]')
      if (!option) return
      choose(Number(option.dataset.index))
    })

    const onDocumentMouseDown = (event) => {
      if (!select.contains(event.target)) close()
    }
    document.addEventListener('mousedown', onDocumentMouseDown)
    viewCleanup = () => document.removeEventListener('mousedown', onDocumentMouseDown)
  }

  function renderGrowing(root) {
    const current = state.current
    if (!current) {
      state.phase = 'idle'
      renderPlant(root)
      return
    }
    const remaining = current.endMs - Date.now()
    const progress = clamp01((Date.now() - current.startMs) / (current.planned * 60000))
    const stage = stageFor(progress)
    lastStage = stage
    lastGrowth = Math.round(progress * GROWTH_STEPS)
    lastAriaKey = ''
    root.innerHTML = `<div class="focus-screen">
      ${sceneMarkup({
        progress,
        className: 'is-growing',
        ariaLabel: `${speciesName(current.species)}, ${stageNames[stage]}, ${Math.max(0, Math.ceil(remaining / 60000))} minutes remaining`,
        tree: sceneTree(current.species, progress),
        badge: `${speciesName(current.species)} · ${stageNames[stage]}`,
        petals: hasPetals(current.species, progress),
      })}
      <div class="readout">
        <div class="time" id="ring-time">${formatClock(remaining)}</div>
        <p class="under-ring" id="ring-caption">${escapeHtml(current.task ? current.task.title : 'Focusing')}${current.tag ? ` · ${escapeHtml(current.tag)}` : ''}</p>
      </div>
      <button type="button" class="button danger-text" id="give-up">Give up</button>
    </div>`
    cacheRefs(root)
    root.querySelector('#give-up').addEventListener('click', openGiveUpConfirm)
    updateGrowing(remaining)
  }

  function updateGrowing(remaining) {
    if (!refs.time || !state.current) return
    const current = state.current
    const total = current.planned * 60000
    const elapsed = clamp01((total - remaining) / total)
    if (refs.progress) refs.progress.style.transform = `scaleX(${elapsed})`
    refs.time.textContent = formatClock(remaining)
    syncSky()
    // the tree grows a little every few seconds, and settles in with a pop at each stage
    const growth = Math.round(elapsed * GROWTH_STEPS)
    const stage = stageFor(elapsed)
    if (growth !== lastGrowth || stage !== lastStage) {
      lastGrowth = growth
      if (refs.tree) refs.tree.innerHTML = sceneTree(current.species, elapsed)
      refs.ring?.classList.toggle('has-petals', hasPetals(current.species, elapsed))
    }
    if (stage !== lastStage) {
      lastStage = stage
      pop(refs.tree)
      if (refs.stage) refs.stage.textContent = `${speciesName(current.species)} · ${stageNames[stage]}`
    }
    const minutes = Math.max(0, Math.ceil(remaining / 60000))
    const ariaKey = `${stage}|${minutes}`
    if (ariaKey !== lastAriaKey) {
      lastAriaKey = ariaKey
      if (refs.ring) {
        refs.ring.setAttribute('aria-label', `${speciesName(current.species)}, ${stageNames[stage]}, ${minutes} minute${minutes === 1 ? '' : 's'} remaining`)
      }
    }
  }

  function renderResult(root) {
    const result = state.result
    if (!result) {
      state.phase = 'idle'
      renderPlant(root)
      return
    }
    const session = result.session
    const grown = session.status === 'grown'
    const stats = todayStats()
    const breakLength = nextBreakLength()
    // a withered tree stays as big as it had grown
    const reached = grown ? 1 : Math.max(0.3, clamp01(session.actual / Math.max(1, session.planned)))
    root.innerHTML = `<div class="focus-screen">
      ${sceneMarkup({
        className: grown ? 'is-complete' : 'is-withered',
        ariaLabel: grown ? 'Tree grown' : 'Tree withered',
        tree: sceneTree(session.species, reached, !grown),
        badge: `${formatMinutes(grown ? session.planned : session.actual)} focused`,
        petals: grown && hasPetals(session.species, 1),
      })}
      <div class="readout">
        <h2 class="result-title" tabindex="-1">${grown
          ? `Your ${escapeHtml(speciesName(session.species).toLowerCase())} has grown`
          : `Your ${escapeHtml(speciesName(session.species).toLowerCase())} withered`}</h2>
        <p class="under-ring">${grown
          ? `${stats.grown} ${treeWord(stats.grown)} · ${formatMinutes(stats.minutes)} focused today`
          : `${formatMinutes(session.actual)} focused · the tree was lost`}</p>
      </div>
      <div class="result-actions">
        ${grown ? `<button type="button" class="button" id="take-break">Take a ${breakLength} min break</button>` : ''}
        ${grown && session.task ? '<button type="button" class="button" id="mark-done">Mark task done</button>' : ''}
        <button type="button" class="button primary" id="plant-another">Plant another</button>
      </div>
    </div>`
    root.querySelector('#take-break')?.addEventListener('click', () => startBreak(breakLength))
    root.querySelector('#mark-done')?.addEventListener('click', async (event) => {
      const button = event.currentTarget
      button.disabled = true
      button.textContent = 'Marking…'
      try {
        await lumen.tasks.complete(session.task.path, session.task.id)
        button.textContent = 'Task marked done'
        state.tasks = state.tasks.filter((task) => task.id !== session.task.id)
        state.plant.task = null
      } catch {
        button.disabled = false
        button.textContent = 'Mark task done'
      }
    })
    root.querySelector('#plant-another').addEventListener('click', () => {
      state.phase = 'idle'
      state.result = null
      render()
      focusElement(document.querySelector('#plant-button'))
    })
  }

  function renderBreak(root) {
    const breakState = state.break
    if (!breakState) {
      state.phase = 'idle'
      renderPlant(root)
      return
    }
    const remaining = breakState.endMs - Date.now()
    const progress = clamp01((Date.now() - breakState.startMs) / (breakState.planned * 60000))
    lastAriaKey = ''
    root.innerHTML = `<div class="focus-screen">
      ${sceneMarkup({
        progress,
        className: 'is-break',
        ariaLabel: `Break, ${Math.max(0, Math.ceil(remaining / 60000))} minutes remaining`,
        tree: sceneTree(state.plant.species, 1),
        badge: 'Break',
      })}
      <div class="readout">
        <div class="time" id="ring-time">${formatClock(remaining)}</div>
        <p class="under-ring">Step away. Your next tree can wait.</p>
      </div>
      <button type="button" class="button" id="skip-break">Skip break</button>
    </div>`
    cacheRefs(root)
    root.querySelector('#skip-break').addEventListener('click', () => endBreak(false))
    updateBreak(remaining)
  }

  function updateBreak(remaining) {
    if (!refs.time || !state.break) return
    const breakState = state.break
    const total = breakState.planned * 60000
    const elapsed = clamp01((total - remaining) / total)
    if (refs.progress) refs.progress.style.transform = `scaleX(${elapsed})`
    refs.time.textContent = formatClock(remaining)
    syncSky()
    const minutes = Math.max(0, Math.ceil(remaining / 60000))
    const ariaKey = String(minutes)
    if (ariaKey !== lastAriaKey) {
      lastAriaKey = ariaKey
      if (refs.ring) {
        refs.ring.setAttribute('aria-label', `Break, ${minutes} minute${minutes === 1 ? '' : 's'} remaining`)
      }
    }
  }

  function renderForest() {
    cleanupView()
    refs = {}
    lastStage = -1
    lastAriaKey = ''
    const root = els.forestView
    const range = state.forestRange
    const sessions = sessionsInRange(range)
    const grown = sessions.filter((session) => session.status === 'grown')
    const lost = sessions.filter((session) => session.status === 'dead')
    const focused = sessions.reduce((sum, session) => sum + (Number(session.actual) || 0), 0)
    const streak = currentStreak()
    const empty = sessions.length
      ? ''
      : `<div class="empty"><p>No trees in this range yet.</p><button type="button" class="button primary" id="go-focus">Plant a tree</button></div>`

    root.innerHTML = `<div class="forest-screen">
      <div class="range-tabs" role="group" aria-label="Forest range">
        ${RANGES.map((item) => `<button type="button" class="range-tab" data-range="${item.id}" aria-pressed="${item.id === range}">${item.label}</button>`).join('')}
      </div>
      ${groveMarkup(sessions)}
      ${empty}
      <div class="totals">
        <div class="total"><span class="total-value">${formatMinutes(focused)}</span><span class="total-label">Focused</span></div>
        <div class="total"><span class="total-value">${grown.length}</span><span class="total-label">Trees grown</span></div>
        <div class="total"><span class="total-value">${lost.length}</span><span class="total-label">Trees lost</span></div>
        <div class="total"><span class="total-value">${streak}</span><span class="total-label">Day streak</span></div>
      </div>
      <section class="breakdowns">
        <h3>By tag</h3>
        ${barsMarkup(groupBy(sessions, (session) => session.tag || 'No tag'), 'No tagged sessions yet.')}
        <h3>By task</h3>
        ${barsMarkup(groupBy(sessions, (session) => session.task ? session.task.title : 'No task'), 'No task sessions yet.')}
      </section>
    </div>`

    const rangeTabs = [...root.querySelectorAll('.range-tab')]
    rangeTabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        state.forestRange = tab.dataset.range
        renderForest()
      })
      tab.addEventListener('keydown', (event) => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
        if (!keys.includes(event.key)) return
        event.preventDefault()
        let next = index
        if (event.key === 'ArrowLeft') next = (index + rangeTabs.length - 1) % rangeTabs.length
        else if (event.key === 'ArrowRight') next = (index + 1) % rangeTabs.length
        else if (event.key === 'Home') next = 0
        else next = rangeTabs.length - 1
        state.forestRange = rangeTabs[next].dataset.range
        renderForest()
        root.querySelector('.range-tab[aria-pressed="true"]')?.focus()
      })
    })

    root.querySelectorAll('[data-session]').forEach((tree) => {
      const open = () => {
        const key = tree.dataset.session
        const session = state.sessions.find((item) => item.id === key || item.start === key)
        if (session) openSessionDialog(session)
      }
      tree.addEventListener('click', open)
      tree.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        open()
      })
    })
    root.querySelector('#go-focus')?.addEventListener('click', () => {
      state.view = 'focus'
      render()
      focusElement(document.querySelector('#plant-button'))
    })
  }

  // the most a grove shows at once; older trees still count in the totals
  const GROVE_MAX = 160

  // Every session is a tree in one meadow. Trees spread out along golden-ratio
  // steps so any number of them fill it evenly; ones further back stand higher
  // and smaller, and a longer session grows a bigger tree.
  function groveMarkup(sessions) {
    const shown = sessions.slice(-GROVE_MAX)
    const few = shown.length <= 3
    const trees = shown.map((session, i) => {
      const depth = few ? 0.8 : (0.12 + i * 0.7548776) % 1
      const across = few ? 0.5 + (i - (shown.length - 1) / 2) * 0.2 : (0.5 + i * 0.618034) % 1
      const base = 148 + depth * 74
      const size = (52 + depth * 64) * (0.72 + 0.28 * Math.min(1, (Number(session.planned) || 25) / 60))
      return { session, x: 48 + across * 504, base, size }
    }).sort((a, b) => a.base - b.base)
    return `<div class="grove sky-${skyNow()}">
      <svg class="grove-art" viewBox="0 0 600 240" preserveAspectRatio="xMidYMax meet" role="group" aria-label="Trees">
        <g aria-hidden="true">
          ${sky(16)}
          <g transform="translate(0 40) scale(.8)"><g class="cloud drift-a">${CLOUD}</g></g>
          <g transform="translate(0 70) scale(.55)"><g class="cloud drift-b">${CLOUD}</g></g>
          <path class="hill-far" d="M0 140 C70 118 150 116 230 128 C310 140 380 112 460 110 C520 108 570 122 600 120 V240 H0 Z"></path>
          <path class="hill-mid" d="M0 160 C120 146 220 150 300 154 C380 158 480 144 600 150 V240 H0 Z"></path>
          <path class="hill-near" d="M0 176 C150 164 450 164 600 176 V240 H0 Z"></path>
        </g>
        ${trees.map(({ session, x, base, size }) => {
          const dead = session.status === 'dead'
          const label = tileLabel(session)
          return `<g class="grove-tree${dead ? ' is-dead' : ''}" role="button" tabindex="0" data-session="${escapeHtml(session.id || session.start)}" aria-label="${escapeHtml(label)}">
            <title>${escapeHtml(label)}</title>
            <ellipse cx="${x.toFixed(1)}" cy="${base.toFixed(1)}" rx="${(size * 0.2).toFixed(1)}" ry="${(size * 0.035).toFixed(1)}" fill="#000" opacity=".14"></ellipse>
            ${growTree(session.species, 1, dead, { ground: false, box: { x: x - size / 2, y: base - size * 0.86, size } })}
          </g>`
        }).join('')}
      </svg>
      ${sessions.length > GROVE_MAX ? `<span class="scene-badge">Newest ${GROVE_MAX} of ${sessions.length}</span>` : ''}
    </div>`
  }

  function tileLabel(session) {
    const status = session.status === 'grown' ? 'grown' : 'withered'
    return `${speciesName(session.species)}, ${status}, ${formatMinutes(session.actual)}, ${formatDateTime(new Date(session.start))}`
  }

  function openSessionDialog(session) {
    els.sessionTitle.textContent = speciesName(session.species)
    els.sessionDetail.innerHTML = `<div class="session-tree">${growTree(session.species, 1, session.status === 'dead')}</div>
      <dl class="detail-grid">
        <dt>When</dt><dd>${escapeHtml(formatDateTime(new Date(session.start)))}</dd>
        <dt>Planned</dt><dd>${formatMinutes(session.planned)}</dd>
        <dt>Focused</dt><dd>${formatMinutes(session.actual)}</dd>
        <dt>Task</dt><dd>${escapeHtml(session.task ? session.task.title : 'No task')}</dd>
        <dt>Tag</dt><dd>${escapeHtml(session.tag || 'No tag')}</dd>
        <dt>Status</dt><dd><span class="badge${session.status === 'dead' ? ' dead' : ''}">${session.status === 'grown' ? 'Grown' : 'Withered'}</span></dd>
      </dl>`
    if (!els.sessionDialog.open) els.sessionDialog.showModal()
  }

  async function startSession(options = {}) {
    if (state.phase === 'growing') return
    const duration = clampDuration(Number(options.duration ?? state.plant.duration))
    const requestedSpecies = options.species ?? state.plant.species
    const species = SPECIES.some((item) => item.id === requestedSpecies)
      ? requestedSpecies
      : state.settings.defaultSpecies
    const task = options.task === undefined ? state.plant.task : options.task
    const rawTag = options.tag === undefined ? state.plant.tag : options.tag
    const tag = typeof rawTag === 'string' ? rawTag.trim().slice(0, 40) : ''
    const startMs = Date.now()
    const current = {
      start: new Date(startMs).toISOString(),
      planned: duration,
      species,
      task: task ? { path: task.path, id: task.id, title: task.title } : null,
      tag: tag || null,
    }
    state.current = { ...current, startMs, endMs: startMs + duration * 60000 }
    state.phase = 'growing'
    state.result = null
    state.break = null
    state.awaySince = null
    state.plant = { duration, species, task: current.task, tag }
    state.settings.lastTag = tag
    saveSettings()
    ensureAudio()
    render()
    tick()
    lumen.storage.set('current', current).catch(() => {})
    focusElement(refs.ring)
  }

  async function endSession(status, { notify = false } = {}) {
    if (state.phase !== 'growing' || !state.current) return
    const current = state.current
    const endMs = status === 'grown' ? current.startMs + current.planned * 60000 : Date.now()
    const row = makeRow(current, status, endMs)
    state.current = null
    state.awaySince = null
    state.phase = 'result'
    state.result = { status, session: row }
    if (els.confirmDialog.open) els.confirmDialog.close('cancel')
    await recordSession(row)
    await clearCurrent()
    render()
    setStatusText('')
    if (status === 'grown') {
      lumen.notify({
        title: 'Your tree has grown',
        body: `${formatMinutes(row.planned)} focused${row.task ? ` on ${row.task.title}` : ''}.`,
      }).catch(() => {})
      chime()
    } else if (notify) {
      lumen.notify({
        title: 'Your tree withered',
        body: 'You were away from Lumen for more than 10 seconds.',
      }).catch(() => {})
    }
    focusElement(document.querySelector('.result-title'))
  }

  function giveUp() {
    endSession('dead')
  }

  function wither() {
    endSession('dead', { notify: true })
  }

  function openGiveUpConfirm() {
    const current = state.current
    if (!current) return
    const elapsed = Math.max(0, Math.round((Date.now() - current.startMs) / 60000))
    els.confirmText.textContent = `Your ${speciesName(current.species).toLowerCase()} will wither. You have focused ${formatMinutes(elapsed)} so far.`
    els.confirmDialog.returnValue = ''
    if (!els.confirmDialog.open) els.confirmDialog.showModal()
  }

  function startBreak(minutes) {
    const planned = clampBreak(Number(minutes), state.settings.shortBreak)
    const now = Date.now()
    state.phase = 'break'
    state.break = { startMs: now, endMs: now + planned * 60000, planned }
    state.result = null
    state.current = null
    render()
    tick()
    focusElement(refs.ring)
  }

  function endBreak(announce) {
    if (state.phase !== 'break') return
    state.phase = 'idle'
    state.break = null
    render()
    setStatusText('')
    if (announce) {
      lumen.notify({ title: 'Break over', body: 'Ready to plant your next tree?' }).catch(() => {})
      chime()
    }
    focusElement(document.querySelector('#plant-button'))
  }

  function tick() {
    if (state.phase === 'growing' && state.current) {
      const now = Date.now()
      const remaining = state.current.endMs - now
      if (remaining <= 0) {
        endSession('grown')
        return
      }
      if (state.settings.strictMode && state.awaySince && now - state.awaySince > 10000) {
        wither()
        return
      }
      updateGrowing(remaining)
      setStatusText(`Focus ${formatClock(remaining)}`)
    } else if (state.phase === 'break' && state.break) {
      const now = Date.now()
      const remaining = state.break.endMs - now
      if (remaining <= 0) {
        endBreak(true)
        return
      }
      updateBreak(remaining)
      setStatusText(`Break ${formatClock(remaining)}`)
    } else {
      setStatusText('')
    }
  }

  function onCommand(event = {}) {
    if (event.id === 'start') {
      if (state.phase === 'growing') return
      if (state.phase === 'break') {
        state.break = null
        state.phase = 'idle'
      }
      state.result = null
      startSession({
        duration: state.settings.defaultDuration,
        species: state.settings.defaultSpecies,
        task: null,
        tag: state.settings.lastTag,
      })
    } else if (event.id === 'stop') {
      if (state.phase === 'growing') endSession('dead')
    }
  }

  function onAppFocus(event = {}) {
    if (!state.settings.strictMode) {
      state.awaySince = null
      return
    }
    if (state.phase !== 'growing') return
    if (event.focused === false) {
      if (state.awaySince) return
      state.awaySince = Date.now()
      lumen.notify({
        title: 'Come back to keep your tree alive',
        body: 'Strict mode gives you 10 seconds away.',
      }).catch(() => {})
    } else if (event.focused === true) {
      if (state.awaySince && Date.now() - state.awaySince > 10000) wither()
      else state.awaySince = null
    }
  }

  async function resumeCurrent(raw) {
    const startMs = Date.parse(raw.start)
    if (!Number.isFinite(startMs)) {
      await clearCurrent()
      state.phase = 'idle'
      return
    }
    const planned = clampDuration(Number(raw.planned))
    const species = SPECIES.some((item) => item.id === raw.species)
      ? raw.species
      : state.settings.defaultSpecies
    const task = raw.task && raw.task.path && raw.task.id
      ? { path: raw.task.path, id: raw.task.id, title: raw.task.title || 'Task' }
      : null
    const tag = typeof raw.tag === 'string' && raw.tag ? raw.tag : null
    const endMs = startMs + planned * 60000
    const current = { start: raw.start, planned, species, task, tag, startMs, endMs }
    if (Date.now() >= endMs) {
      const row = makeRow(current, 'grown', endMs)
      state.phase = 'result'
      state.result = { status: 'grown', session: row }
      await recordSession(row)
      await clearCurrent()
      lumen.notify({
        title: 'Your tree has grown',
        body: 'The session finished while Lumen was closed.',
      }).catch(() => {})
      return
    }
    state.current = current
    state.phase = 'growing'
  }

  function setupTabs() {
    const tabs = [els.tabFocus, els.tabForest]
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        state.view = tab === els.tabFocus ? 'focus' : 'forest'
        render()
      })
      tab.addEventListener('keydown', (event) => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
        if (!keys.includes(event.key)) return
        event.preventDefault()
        let next = index
        if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length
        else if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
        else if (event.key === 'Home') next = 0
        else next = tabs.length - 1
        const target = tabs[next]
        state.view = target === els.tabFocus ? 'focus' : 'forest'
        render()
        target.focus()
      })
    })
  }

  function fillSpeciesSelect() {
    els.setSpecies.innerHTML = SPECIES
      .map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`)
      .join('')
  }

  function fillSettings() {
    els.setDuration.value = String(state.settings.defaultDuration)
    els.setDurationOut.textContent = `${state.settings.defaultDuration} min`
    els.setSpecies.value = state.settings.defaultSpecies
    els.setShortBreak.value = String(state.settings.shortBreak)
    els.setLongBreak.value = String(state.settings.longBreak)
    els.setStrict.checked = state.settings.strictMode
    els.setSound.checked = state.settings.sound
  }

  function settingsChanged({ duration = false, species = false } = {}) {
    if (duration && state.phase === 'idle') state.plant.duration = state.settings.defaultDuration
    if (species && state.phase === 'idle') state.plant.species = state.settings.defaultSpecies
    saveSettings()
    if (state.view === 'focus' && (state.phase === 'idle' || state.phase === 'result')) renderFocus()
  }

  function setupSettingsDialog() {
    fillSpeciesSelect()
    els.setDuration.addEventListener('input', () => {
      state.settings.defaultDuration = clampDuration(Number(els.setDuration.value))
      els.setDurationOut.textContent = `${state.settings.defaultDuration} min`
      settingsChanged({ duration: true })
    })
    els.setSpecies.addEventListener('change', () => {
      state.settings.defaultSpecies = els.setSpecies.value
      settingsChanged({ species: true })
    })
    els.setShortBreak.addEventListener('change', () => {
      state.settings.shortBreak = clampBreak(Number(els.setShortBreak.value), DEFAULT_SETTINGS.shortBreak)
      els.setShortBreak.value = String(state.settings.shortBreak)
      saveSettings()
      if (state.view === 'focus' && state.phase === 'result') renderFocus()
    })
    els.setLongBreak.addEventListener('change', () => {
      state.settings.longBreak = clampBreak(Number(els.setLongBreak.value), DEFAULT_SETTINGS.longBreak)
      els.setLongBreak.value = String(state.settings.longBreak)
      saveSettings()
      if (state.view === 'focus' && state.phase === 'result') renderFocus()
    })
    els.setStrict.addEventListener('change', () => {
      state.settings.strictMode = els.setStrict.checked
      if (!state.settings.strictMode) state.awaySince = null
      saveSettings()
    })
    els.setSound.addEventListener('change', () => {
      state.settings.sound = els.setSound.checked
      saveSettings()
    })
    els.settingsButton.addEventListener('click', () => {
      fillSettings()
      if (!els.settingsDialog.open) els.settingsDialog.showModal()
    })
  }

  function setupConfirmDialog() {
    els.confirmDialog.addEventListener('close', () => {
      if (els.confirmDialog.returnValue === 'confirm') giveUp()
    })
  }

  function setupSessionDialog() {
    els.sessionClose.addEventListener('click', () => els.sessionDialog.close())
    els.sessionDialog.addEventListener('click', (event) => {
      if (event.target === els.sessionDialog) els.sessionDialog.close()
    })
  }

  async function init() {
    setupTabs()
    setupSettingsDialog()
    setupConfirmDialog()
    setupSessionDialog()

    let settingsRaw = null
    let sessionsText = null
    let currentRaw = null
    let tasks = []
    try {
      const loaded = await Promise.all([
        lumen.storage.get('settings').catch(() => null),
        lumen.storage.read('sessions.jsonl').catch(() => null),
        lumen.storage.get('current').catch(() => null),
        lumen.tasks.list({ open: true }).catch(() => []),
      ])
      settingsRaw = loaded[0]
      sessionsText = loaded[1]
      currentRaw = loaded[2]
      tasks = loaded[3]
    } catch {}

    state.settings = normalizeSettings(settingsRaw)
    state.sessions = parseSessions(sessionsText)
    state.tasks = Array.isArray(tasks) ? tasks : []
    state.plant = {
      duration: state.settings.defaultDuration,
      species: state.settings.defaultSpecies,
      task: null,
      tag: state.settings.lastTag || '',
    }

    if (currentRaw && typeof currentRaw.start === 'string') {
      if (state.sessions.some((session) => session.start === currentRaw.start)) {
        await clearCurrent()
        state.phase = 'idle'
      } else {
        await resumeCurrent(currentRaw)
      }
    } else {
      state.phase = 'idle'
    }

    lumen.on('command', onCommand)
    lumen.on('app-focus', onAppFocus)
    lumen.on('task.completed', (event = {}) => {
      state.tasks = state.tasks.filter((task) => task.id !== event.id)
      if (state.plant.task && state.plant.task.id === event.id) state.plant.task = null
      if (state.phase === 'idle' && state.view === 'focus') renderFocus()
    })
    render()
    tick()
    setInterval(tick, 1000)
  }

  init()
})()
