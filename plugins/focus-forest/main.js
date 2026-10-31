;(() => {
  const { species: SPECIES, stageNames, render: renderTreeSvg } = window.ForestTrees

  const DEFAULT_SETTINGS = {
    defaultDuration: 25,
    defaultSpecies: 'oak',
    strictMode: false,
    shortBreak: 5,
    longBreak: 15,
    sound: true,
    lastTag: '',
  }

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

  function timeOfDay(iso) {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) return ''
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date)
  }

  function speciesName(id) {
    const found = SPECIES.find((item) => item.id === id)
    return found ? found.name : 'Oak'
  }

  function stageFor(progress) {
    const value = clamp01(progress)
    if (value >= 1) return 4
    return Math.min(4, Math.floor(value * 5))
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

  function ringMarkup({ progress, className = '', ariaLabel, center }) {
    const offset = 100 - clamp01(progress) * 100
    return `<div class="ring-wrap ${className}" id="ring-timer" role="timer" tabindex="-1" aria-label="${escapeHtml(ariaLabel)}">
      <svg class="ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle class="ring-track" cx="50" cy="50" r="45" pathLength="100"></circle>
        <circle class="ring-progress" cx="50" cy="50" r="45" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${offset}"></circle>
      </svg>
      <div class="ring-center">${center}</div>
    </div>`
  }

  function cacheRefs(root) {
    refs = {
      ring: root.querySelector('#ring-timer'),
      progress: root.querySelector('.ring-progress'),
      time: root.querySelector('#ring-timer .time'),
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
      ${ringMarkup({
        progress: 1,
        ariaLabel: `Focus timer, ${duration} minutes`,
        center: `<div class="tree-holder pop" id="tree-holder">${renderTreeSvg(species, 4)}</div>
          <div class="time" id="ring-time">${formatClock(duration * 60000)}</div>`,
      })}
      <p class="under-ring" id="ring-caption">Ready to plant · ${escapeHtml(speciesName(species))}</p>
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
        <fieldset class="control-group">
          <legend>Tree</legend>
          <div class="species-grid">
            ${SPECIES.map((item) => `<button type="button" class="species" data-species="${item.id}" aria-pressed="${item.id === species}" title="${escapeHtml(item.name)}">
              <span class="species-tree" aria-hidden="true">${renderTreeSvg(item.id, 4)}</span>
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
        holder.innerHTML = renderTreeSvg(state.plant.species, 4)
        holder.classList.remove('pop')
        void holder.offsetWidth
        holder.classList.add('pop')
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
    lastAriaKey = ''
    root.innerHTML = `<div class="focus-screen">
      ${ringMarkup({
        progress,
        className: 'is-growing',
        ariaLabel: `${speciesName(current.species)}, ${stageNames[stage]}, ${Math.max(0, Math.ceil(remaining / 60000))} minutes remaining`,
        center: `<div class="tree-holder pop" id="tree-holder">${renderTreeSvg(current.species, stage)}</div>
          <div class="time" id="ring-time">${formatClock(remaining)}</div>`,
      })}
      <div class="under-ring-stack">
        <p class="under-ring" id="ring-caption">${escapeHtml(current.task ? current.task.title : 'No task')}</p>
        <p class="stage-label" id="stage-label">${escapeHtml(speciesName(current.species))} · ${stageNames[stage]}</p>
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
    if (refs.progress) refs.progress.style.strokeDashoffset = String(100 - elapsed * 100)
    refs.time.textContent = formatClock(remaining)
    const stage = stageFor(elapsed)
    if (stage !== lastStage) {
      lastStage = stage
      if (refs.tree) {
        refs.tree.innerHTML = renderTreeSvg(current.species, stage)
        refs.tree.classList.remove('pop')
        void refs.tree.offsetWidth
        refs.tree.classList.add('pop')
      }
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
    const center = `<div class="tree-holder" id="tree-holder">${renderTreeSvg(session.species, 4, !grown)}</div>
      <div class="time">${formatClock((grown ? session.planned : session.actual) * 60000)}</div>`
    root.innerHTML = `<div class="focus-screen">
      ${ringMarkup({
        progress: grown ? 1 : clamp01(session.actual / Math.max(1, session.planned)),
        className: grown ? 'is-complete' : 'is-dead',
        ariaLabel: grown ? 'Tree grown' : 'Tree withered',
        center,
      })}
      <h2 class="result-title" tabindex="-1">${grown
        ? `Your ${escapeHtml(speciesName(session.species).toLowerCase())} has grown`
        : `Your ${escapeHtml(speciesName(session.species).toLowerCase())} withered`}</h2>
      <p class="under-ring">${grown
        ? `${stats.grown} ${treeWord(stats.grown)} · ${formatMinutes(stats.minutes)} focused today`
        : `${formatMinutes(session.actual)} focused · the tree was lost`}</p>
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
      ${ringMarkup({
        progress,
        className: 'is-break',
        ariaLabel: `Break, ${Math.max(0, Math.ceil(remaining / 60000))} minutes remaining`,
        center: `<div class="ring-label">Break</div>
          <div class="time" id="break-time">${formatClock(remaining)}</div>`,
      })}
      <p class="under-ring">Step away. Your next tree can wait.</p>
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
    if (refs.progress) refs.progress.style.strokeDashoffset = String(100 - elapsed * 100)
    refs.time.textContent = formatClock(remaining)
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
    const garden = sessions.length
      ? `<ul class="garden" aria-label="Trees">${sessions.map((session) => `
        <li>
          <button type="button" class="tree-tile${session.status === 'dead' ? ' is-dead' : ''}" data-session="${escapeHtml(session.id || session.start)}" aria-label="${escapeHtml(tileLabel(session))}">
            <span class="tile-tree" aria-hidden="true">${renderTreeSvg(session.species, 4, session.status === 'dead')}</span>
            <span class="tile-time">${escapeHtml(timeOfDay(session.start))}</span>
          </button>
        </li>`).join('')}</ul>`
      : `<div class="empty"><p>No trees in this range yet.</p><button type="button" class="button primary" id="go-focus">Plant a tree</button></div>`

    root.innerHTML = `<div class="forest-screen">
      <div class="range-tabs" role="group" aria-label="Forest range">
        ${RANGES.map((item) => `<button type="button" class="range-tab" data-range="${item.id}" aria-pressed="${item.id === range}">${item.label}</button>`).join('')}
      </div>
      <div class="totals">
        <div class="total"><span class="total-value">${formatMinutes(focused)}</span><span class="total-label">Focused</span></div>
        <div class="total"><span class="total-value">${grown.length}</span><span class="total-label">Trees grown</span></div>
        <div class="total"><span class="total-value">${lost.length}</span><span class="total-label">Trees lost</span></div>
        <div class="total"><span class="total-value">${streak}</span><span class="total-label">Day streak</span></div>
      </div>
      ${garden}
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

    root.querySelectorAll('[data-session]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.dataset.session
        const session = state.sessions.find((item) => item.id === key || item.start === key)
        if (session) openSessionDialog(session)
      })
    })
    root.querySelector('#go-focus')?.addEventListener('click', () => {
      state.view = 'focus'
      render()
      focusElement(document.querySelector('#plant-button'))
    })
  }

  function tileLabel(session) {
    const status = session.status === 'grown' ? 'grown' : 'withered'
    return `${speciesName(session.species)}, ${status}, ${formatMinutes(session.actual)}, ${formatDateTime(new Date(session.start))}`
  }

  function openSessionDialog(session) {
    els.sessionTitle.textContent = speciesName(session.species)
    els.sessionDetail.innerHTML = `<div class="session-tree">${renderTreeSvg(session.species, 4, session.status === 'dead')}</div>
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
      setStatusText(`🌳 ${formatClock(remaining)}`)
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
