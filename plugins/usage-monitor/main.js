(() => {
  const app = document.getElementById('app')
  const {
    MIN,
    isoDay,
    parseDay,
    addDays,
    addMonths,
    startOfWeek,
    monthStart,
    monthEnd,
    daysBetween,
    formatDuration,
    formatClock,
    escapeHtml,
    formatDateShort,
    formatDateLong,
    formatWeekLabel,
    formatMonthLabel,
    longestFocus,
    timelineHtml,
    rangeChartHtml,
  } = window.UsageCharts

  const CATEGORIES = ['productive', 'neutral', 'distracting']
  const CATEGORY_LABELS = { productive: 'Productive', neutral: 'Neutral', distracting: 'Distracting' }
  const DEFAULT_CATEGORIES = [
    { category: 'productive', apps: ['Code', 'Visual Studio Code', 'Terminal', 'Windows Terminal', 'Figma', 'Lumen', 'Obsidian', 'Notion'] },
    { category: 'neutral', apps: ['Slack', 'Teams', 'Outlook', 'Mail'] },
    { category: 'distracting', apps: ['YouTube', 'Netflix', 'Steam', 'Discord', 'Instagram', 'Reddit', 'TikTok'] },
  ]
  const DEFAULT_APP_NAMES = DEFAULT_CATEGORIES.flatMap((group) => group.apps)
  const ONE_MIN = 60 * 1000
  const FIVE_MIN = 5 * 60 * 1000

  const state = {
    available: false,
    tracking: false,
    current: null,
    anchor: isoDay(new Date()),
    mode: 'day',
    settings: { appCategories: {}, distractingLimit: 0 },
    dayStats: null,
    range: null,
    loading: true,
    settingsOpen: false,
    message: '',
    seenApps: new Set(DEFAULT_APP_NAMES),
    lastDay: isoDay(new Date()),
    refreshTimer: null,
    backgroundTimer: null,
  }

  let loadSeq = 0
  let flashTimer = null
  let limitCheck = null

  function categoryFor(appName) {
    const key = String(appName || '').trim().toLowerCase()
    const override = state.settings.appCategories[key]
    if (override && CATEGORIES.includes(override)) return override
    for (const group of DEFAULT_CATEGORIES) {
      if (group.apps.some((name) => key.includes(name.toLowerCase()))) return group.category
    }
    return 'neutral'
  }

  function applyCategories(stats) {
    const byCategory = { productive: 0, neutral: 0, distracting: 0 }
    for (const [appName, ms] of Object.entries(stats.byApp || {})) {
      const category = categoryFor(appName)
      byCategory[category] += ms
    }
    stats.byCategory = byCategory
    stats.score = stats.activeMs
      ? Math.round((100 * (byCategory.productive + 0.5 * byCategory.neutral)) / stats.activeMs)
      : 0
    stats.longest = stats.segments?.length ? longestFocus(stats.segments, categoryFor) : null
    return stats
  }

  function computeStats(date, data) {
    const segments = (Array.isArray(data.segments) ? data.segments : [])
      .filter((seg) => seg && Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start)
      .slice()
      .sort((a, b) => a.start - b.start)
    const byApp = {}
    let activeMs = 0
    for (const seg of segments) {
      const name = String(seg.app || 'Unknown')
      const duration = seg.end - seg.start
      activeMs += duration
      byApp[name] = (byApp[name] || 0) + duration
      state.seenApps.add(name)
    }
    const stats = {
      date,
      segments,
      activeMs,
      idleMs: Math.max(0, Number(data.idleMs) || 0),
      switches: Number.isFinite(data.switches) ? data.switches : segments.length,
      byApp,
      byCategory: { productive: 0, neutral: 0, distracting: 0 },
      score: 0,
      longest: null,
    }
    return applyCategories(stats)
  }

  function statsFromSummary(summary) {
    const byApp = {}
    for (const [appName, ms] of Object.entries(summary.byApp || {})) {
      const value = Math.max(0, Number(ms) || 0)
      if (value > 0) {
        byApp[appName] = value
        state.seenApps.add(appName)
      }
    }
    const stats = {
      date: summary.date,
      segments: [],
      activeMs: Math.max(0, Number(summary.activeMs) || 0),
      idleMs: Math.max(0, Number(summary.idleMs) || 0),
      switches: Math.max(0, Number(summary.switches) || 0),
      byApp,
      byCategory: { productive: 0, neutral: 0, distracting: 0 },
      score: 0,
      longest: null,
      fromSummary: true,
    }
    return applyCategories(stats)
  }

  function emptyStats(date) {
    return {
      date,
      segments: [],
      activeMs: 0,
      idleMs: 0,
      switches: 0,
      byApp: {},
      byCategory: { productive: 0, neutral: 0, distracting: 0 },
      score: 0,
      longest: null,
    }
  }

  async function loadSettings() {
    let saved = null
    try {
      saved = await lumen.storage.get('settings')
    } catch (e) {
      saved = null
    }
    const result = saved && typeof saved === 'object' ? { ...saved } : {}
    const appCategories = {}
    for (const [key, value] of Object.entries(result.appCategories || {})) {
      if (CATEGORIES.includes(value)) appCategories[String(key).toLowerCase()] = value
    }
    result.appCategories = appCategories
    result.distractingLimit = Math.max(0, Math.round(Number(result.distractingLimit) || 0))
    return result
  }

  async function saveSettings() {
    try {
      await lumen.storage.set('settings', state.settings)
    } catch (e) {
      state.message = 'Could not save settings.'
    }
  }

  async function getSummary(date) {
    try {
      const summary = await lumen.storage.get(`days/${date}`)
      return summary && summary.date === date ? summary : null
    } catch (e) {
      return null
    }
  }

  async function saveSummary(stats) {
    const today = isoDay(new Date())
    if (!state.available || stats.date >= today) return
    if (!(stats.activeMs > 0 || stats.idleMs > 0)) return
    try {
      await lumen.storage.set(`days/${stats.date}`, {
        date: stats.date,
        activeMs: stats.activeMs,
        idleMs: stats.idleMs,
        switches: stats.switches,
        byApp: stats.byApp,
        byCategory: stats.byCategory,
        score: stats.score,
      })
    } catch (e) {
      // History is useful but not worth interrupting the view for.
    }
  }

  async function loadDay(date, purpose = 'day') {
    const today = isoDay(new Date())
    if (date > today) return emptyStats(date)

    const summary = date < today ? await getSummary(date) : null
    if (purpose !== 'day' && summary) return statsFromSummary(summary)
    if (!state.available) return summary ? statsFromSummary(summary) : emptyStats(date)

    let data = null
    try {
      data = await lumen.system.activity.day(date)
    } catch (e) {
      data = null
    }

    const hasSegments = Boolean(data && Array.isArray(data.segments) && data.segments.length)
    if (!hasSegments && summary) return statsFromSummary(summary)

    const stats = computeStats(date, data || {})
    if (date < today) await saveSummary(stats)
    return stats
  }

  function rangeDates() {
    if (state.mode === 'week') {
      const start = startOfWeek(state.anchor)
      return daysBetween(start, addDays(start, 6))
    }
    return daysBetween(monthStart(state.anchor), monthEnd(state.anchor))
  }

  async function loadView() {
    const seq = ++loadSeq
    state.loading = true
    render()
    try {
      if (state.mode === 'day') {
        const stats = await loadDay(state.anchor, 'day')
        if (seq !== loadSeq) return
        state.dayStats = stats
        state.range = null
      } else {
        const dates = rangeDates()
        const results = await Promise.all(dates.map((day) => loadDay(day, 'range')))
        if (seq !== loadSeq) return
        const statsByDate = {}
        for (const stats of results) statsByDate[stats.date] = stats
        state.range = { dates, statsByDate }
        state.dayStats = null
      }
    } catch (e) {
      if (seq === loadSeq) state.message = 'Could not load usage data.'
    } finally {
      if (seq === loadSeq) {
        state.loading = false
        render()
      }
    }
  }

  async function refreshStatus() {
    try {
      const status = await lumen.system.activity.status()
      state.available = Boolean(status && status.available)
      state.tracking = Boolean(status && status.tracking)
      state.current = status?.current || null
    } catch (e) {
      // Keep the last known state if the desktop app cannot answer.
    }
  }

  async function setTracking(next) {
    if (!state.available) return
    try {
      await lumen.system.activity.setTracking(next)
      await refreshStatus()
      flash(next ? 'Tracking resumed.' : 'Tracking paused.')
    } catch (e) {
      flash('Could not change tracking.')
    }
  }

  async function updateCategory(appName, category) {
    if (!CATEGORIES.includes(category)) return
    state.settings.appCategories[String(appName).toLowerCase()] = category
    await saveSettings()
    if (state.dayStats) applyCategories(state.dayStats)
    if (state.range) {
      for (const stats of Object.values(state.range.statsByDate)) applyCategories(stats)
    }
    await persistLoadedSummaries()
    render()
  }

  async function persistLoadedSummaries() {
    const today = isoDay(new Date())
    const all = []
    if (state.dayStats) all.push(state.dayStats)
    if (state.range) all.push(...Object.values(state.range.statsByDate))
    await Promise.all(all.filter((stats) => stats.date < today).map(saveSummary))
  }

  async function updateLimit(value) {
    const minutes = Math.max(0, Math.round(Number(value) || 0))
    state.settings.distractingLimit = minutes
    await saveSettings()
    flash(minutes ? `Daily limit set to ${minutes} min.` : 'Daily limit turned off.')
    checkLimit()
  }

  async function clearSummaries() {
    try {
      const files = await lumen.storage.list('days/')
      for (const file of files) await lumen.storage.remove(file)
      await loadView()
      flash(files.length ? 'Saved summaries cleared.' : 'No saved summaries to clear.')
    } catch (e) {
      flash('Could not clear saved summaries.')
    }
  }

  function checkLimit() {
    if (!limitCheck) {
      limitCheck = doCheckLimit().finally(() => {
        limitCheck = null
      })
    }
    return limitCheck
  }

  async function doCheckLimit() {
    if (!state.available) return
    const limit = Number(state.settings.distractingLimit) || 0
    if (limit <= 0) return

    const today = isoDay(new Date())
    let stats = state.dayStats && state.dayStats.date === today ? state.dayStats : null
    if (!stats) {
      try {
        stats = await loadDay(today, 'day')
      } catch (e) {
        return
      }
    }
    if (!stats || stats.byCategory.distracting < limit * MIN) return

    let notified = null
    try {
      notified = await lumen.storage.get('limit-notified')
    } catch (e) {
      notified = null
    }
    if (notified && notified.date === today) return

    try {
      await lumen.notify({
        title: 'Distracting time limit reached',
        body: `You've spent ${formatDuration(stats.byCategory.distracting)} on distracting apps today (limit ${limit} min).`,
      })
      await lumen.storage.set('limit-notified', { date: today, at: Date.now() })
    } catch (e) {
      // A missing notification permission should not break tracking.
    }
  }

  async function liveRefresh() {
    if (!state.available) return
    await refreshStatus()
    const today = isoDay(new Date())
    if (state.mode === 'day' && state.anchor === today && !state.loading) {
      try {
        const stats = await loadDay(today, 'day')
        if (state.mode === 'day' && state.anchor === today) state.dayStats = stats
      } catch (e) {
        // Keep showing the last good numbers.
      }
    }
    if (!state.loading && canAutoRender()) render()
  }

  async function backgroundTick() {
    if (!state.available) return
    const today = isoDay(new Date())
    if (state.lastDay !== today) {
      const previous = state.lastDay
      state.lastDay = today
      if (previous) {
        try {
          await loadDay(previous, 'range')
        } catch (e) {
          // Try again on the next tick.
        }
      }
    }
    await refreshStatus()
    await checkLimit()
    if (state.mode === 'day' && state.anchor === today && !state.loading) {
      try {
        const stats = await loadDay(today, 'day')
        if (state.mode === 'day' && state.anchor === today) state.dayStats = stats
      } catch (e) {
        // Keep showing the last good numbers.
      }
    }
    if (!state.loading && canAutoRender()) render()
  }

  function canAutoRender() {
    const element = document.activeElement
    return !(state.settingsOpen && element && app.contains(element) && element.matches('input, select'))
  }

  function flash(text) {
    state.message = text
    render()
    clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      state.message = ''
      if (canAutoRender()) render()
    }, 4000)
  }

  function shiftAnchor(direction) {
    if (state.mode === 'day') return addDays(state.anchor, direction)
    if (state.mode === 'week') return addDays(state.anchor, direction * 7)
    return addMonths(state.anchor, direction)
  }

  function attrEscape(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  }

  function captureFocus() {
    const element = document.activeElement
    if (!element || !app.contains(element)) return null
    return element.getAttribute('data-fkey')
  }

  function restoreFocus(key) {
    if (!key) return
    const element = app.querySelector(`[data-fkey="${attrEscape(key)}"]`)
    if (element) element.focus({ preventScroll: true })
  }

  function gearIcon() {
    return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.08a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.08a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.08a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.12.37.4.68.76.87H21a2 2 0 1 1 0 4h-.08a1.7 1.7 0 0 0-1.52 1.13z"></path></svg>`
  }

  function activityIcon() {
    return `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l2-7 4 14 2-7h6"></path></svg>`
  }

  function dayLabel(day) {
    const today = isoDay(new Date())
    return `${day === today ? 'Today · ' : ''}${formatDateLong(day)}`
  }

  function headerHtml() {
    const label = state.mode === 'day'
      ? dayLabel(state.anchor)
      : state.mode === 'week'
        ? formatWeekLabel(state.anchor)
        : formatMonthLabel(state.anchor)
    const unit = state.mode === 'day' ? 'day' : state.mode === 'week' ? 'week' : 'month'
    const current = state.tracking && state.current?.app
    const currentTitle = current
      ? [state.current.app, state.current.title].filter(Boolean).join(' — ')
      : ''

    return `<header class="top">
      <div class="title-row">
        <div class="heading">
          <p class="eyebrow">Usage</p>
          <h1>${escapeHtml(label)}</h1>
        </div>
        <button type="button" class="icon-btn" data-action="settings-toggle" data-fkey="settings-btn" aria-expanded="${state.settingsOpen}" aria-controls="settings-panel" aria-label="Settings">
          ${gearIcon()}
        </button>
      </div>
      <div class="controls">
        <div class="nav">
          <button type="button" class="icon-btn" data-action="prev" data-fkey="prev" aria-label="Previous ${unit}">‹</button>
          <div class="segmented" role="group" aria-label="View">
            ${['day', 'week', 'month'].map((mode) => `<button type="button" data-action="mode" data-mode="${mode}" data-fkey="mode-${mode}" aria-pressed="${state.mode === mode}" class="${state.mode === mode ? 'on' : ''}">${mode[0].toUpperCase() + mode.slice(1)}</button>`).join('')}
          </div>
          <button type="button" class="icon-btn" data-action="next" data-fkey="next" aria-label="Next ${unit}">›</button>
        </div>
        <div class="live">
          <span class="status-dot ${state.tracking ? 'on' : ''}" aria-hidden="true"></span>
          <span class="status-text">${state.tracking ? 'Tracking' : 'Paused'}</span>
          <button type="button" class="switch ${state.tracking ? 'on' : ''}" role="switch" aria-checked="${state.tracking}" data-action="toggle-tracking" data-fkey="tracking" aria-label="${state.tracking ? 'Pause tracking' : 'Resume tracking'}">
            <span class="knob"></span>
          </button>
          ${current ? `<span class="current-app" title="${escapeHtml(currentTitle)}">${escapeHtml(state.current.app)}</span>` : ''}
        </div>
      </div>
    </header>`
  }

  function messageHtml() {
    if (!state.message) return ''
    return `<p class="message" role="status">${escapeHtml(state.message)}</p>`
  }

  function card(label, value, tone = '', hint = '', sub = '') {
    return `<div class="card"${hint ? ` title="${escapeHtml(hint)}"` : ''}>
      <span class="card-label">${escapeHtml(label)}</span>
      <span class="card-value ${tone}">${value}</span>
      ${sub ? `<span class="card-sub">${escapeHtml(sub)}</span>` : ''}
    </div>`
  }

  function legendHtml() {
    return `<div class="legend" aria-hidden="true">
      <span><i class="dot productive"></i>Productive</span>
      <span><i class="dot neutral"></i>Neutral</span>
      <span><i class="dot distracting"></i>Distracting</span>
    </div>`
  }

  function dayViewHtml() {
    const stats = state.dayStats
    if (!stats) return ''
    const hasTimeline = stats.segments.length > 0
    return `
      <div class="cards">
        ${card('Active time', formatDuration(stats.activeMs))}
        ${card('Productive', formatDuration(stats.byCategory.productive), 'green')}
        ${card('Distracting', formatDuration(stats.byCategory.distracting), 'red')}
        ${card('Focus score', `${stats.score}<span class="unit">/ 100</span>`, 'accent', 'Productive time counts fully, neutral time half')}
        ${card('Idle', formatDuration(stats.idleMs))}
        ${card('App switches', String(stats.switches))}
      </div>
      <section class="panel">
        <div class="panel-head">
          <h2>Timeline</h2>
          ${legendHtml()}
        </div>
        ${hasTimeline
          ? timelineHtml(stats.date, stats, categoryFor)
          : `<p class="muted empty-line">${stats.fromSummary ? 'The timeline is not available for this day. Totals come from a saved summary.' : 'No activity recorded for this day.'}</p>`}
      </section>
      <div class="split">
        <section class="panel">
          <h2>Top apps</h2>
          ${appsHtml(stats)}
        </section>
        <section class="panel focus-stretch">
          <h2>Longest focus stretch</h2>
          ${longestHtml(stats)}
        </section>
      </div>`
  }

  function appsHtml(stats) {
    const apps = Object.entries(stats.byApp).sort((a, b) => b[1] - a[1])
    if (!apps.length) return '<p class="muted empty-line">No apps recorded.</p>'
    const max = apps[0][1] || 1
    return `<ul class="app-list">
      ${apps.map(([name, ms]) => {
        const category = categoryFor(name)
        return `<li class="app-row">
          <div class="app-info">
            <div class="app-top">
              <span class="app-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
              <span class="app-dur">${formatDuration(ms)}</span>
            </div>
            <div class="bar"><span class="${category}" style="width:${((ms / max) * 100).toFixed(1)}%"></span></div>
          </div>
          <select data-app="${escapeHtml(name)}" data-fkey="appsel-top:${escapeHtml(name)}" aria-label="Category for ${escapeHtml(name)}">
            ${CATEGORIES.map((option) => `<option value="${option}"${category === option ? ' selected' : ''}>${CATEGORY_LABELS[option]}</option>`).join('')}
          </select>
        </li>`
      }).join('')}
    </ul>`
  }

  function longestHtml(stats) {
    if (!stats.longest) {
      return `<p class="muted empty-line">${stats.segments.length ? 'No productive stretch of 2 minutes or more.' : 'Not available for this day.'}</p>`
    }
    return `<div class="stretch">
      <p class="stretch-value">${formatDuration(stats.longest.ms)}</p>
      <p class="muted">${formatClock(stats.longest.start)}–${formatClock(stats.longest.end)}</p>
      <p class="muted small">Runs of productive time with interruptions under 2 minutes.</p>
    </div>`
  }

  function rangeViewHtml() {
    const dates = state.range?.dates || []
    const statsByDate = state.range?.statsByDate || {}
    const statsList = dates.map((day) => statsByDate[day]).filter(Boolean)
    const totals = {
      activeMs: 0,
      idleMs: 0,
      switches: 0,
      byCategory: { productive: 0, neutral: 0, distracting: 0 },
    }
    let scoreSum = 0
    let scoreDays = 0
    let best = null

    for (const stats of statsList) {
      totals.activeMs += stats.activeMs
      totals.idleMs += stats.idleMs
      totals.switches += stats.switches
      for (const category of CATEGORIES) totals.byCategory[category] += stats.byCategory[category] || 0
      if (stats.activeMs > 0) {
        scoreSum += stats.score
        scoreDays += 1
        if (!best || stats.score > best.score || (stats.score === best.score && stats.byCategory.productive > best.byCategory.productive)) {
          best = stats
        }
      }
    }

    const average = scoreDays ? Math.round(scoreSum / scoreDays) : 0

    return `
      <div class="cards">
        ${card('Active time', formatDuration(totals.activeMs))}
        ${card('Productive', formatDuration(totals.byCategory.productive), 'green')}
        ${card('Distracting', formatDuration(totals.byCategory.distracting), 'red')}
        ${card('Average focus score', `${average}<span class="unit">/ 100</span>`, 'accent', 'Average of days with activity')}
        ${card('Idle', formatDuration(totals.idleMs))}
        ${best
          ? card('Best day', escapeHtml(formatDateShort(best.date)), '', 'Highest focus score', `Focus score ${best.score}`)
          : card('Best day', '—')}
      </div>
      <section class="panel">
        <div class="panel-head">
          <h2>Daily activity</h2>
          ${legendHtml()}
        </div>
        ${rangeChartHtml(dates, statsByDate, state.mode)}
        <p class="muted small">Click a day to open it.</p>
      </section>`
  }

  function settingsHtml() {
    const apps = [...state.seenApps].sort((a, b) => a.localeCompare(b))
    return `<section class="settings-panel" id="settings-panel" aria-labelledby="settings-title">
      <div class="panel-head">
        <h2 id="settings-title">Settings</h2>
        <button type="button" class="icon-btn" data-action="settings-close" data-fkey="settings-close" aria-label="Close settings">×</button>
      </div>
      <div class="setting-block">
        <h3>App categories</h3>
        <p class="muted">Matching ignores case and looks for these names inside the app name.</p>
        <div class="category-list">
          ${apps.map((name) => {
            const category = categoryFor(name)
            return `<div class="category-row">
              <span class="category-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
              <select data-app="${escapeHtml(name)}" data-fkey="appsel-set:${escapeHtml(name)}" aria-label="Category for ${escapeHtml(name)}">
                ${CATEGORIES.map((option) => `<option value="${option}"${category === option ? ' selected' : ''}>${CATEGORY_LABELS[option]}</option>`).join('')}
              </select>
            </div>`
          }).join('')}
        </div>
      </div>
      <div class="setting-block">
        <h3>Daily limit</h3>
        <label class="limit-row" for="limit-input">
          <span>Distracting time limit (minutes, 0 = off)</span>
          <input id="limit-input" data-limit type="number" min="0" step="5" inputmode="numeric" value="${state.settings.distractingLimit}" data-fkey="limit">
        </label>
      </div>
      <div class="setting-block">
        <h3>Window titles</h3>
        <p class="muted">It's a desktop app setting: open Lumen's desktop settings, then Activity, to record window titles.</p>
      </div>
      <div class="setting-block">
        <h3>Saved summaries</h3>
        <p class="muted">Daily summaries are saved so history survives even if the desktop app's activity log is cleared.</p>
        <button type="button" class="btn danger" data-action="clear-summaries" data-fkey="clear">Clear saved summaries</button>
      </div>
    </section>`
  }

  function emptyStateHtml() {
    return `<div class="empty">
      <div class="empty-icon" aria-hidden="true">${activityIcon()}</div>
      <h1>Usage Monitor</h1>
      <p>Usage tracking needs the Lumen desktop app.</p>
      <p class="muted">It shows which apps you use, your focus score and where your time goes.</p>
    </div>`
  }

  function loadingHtml() {
    return '<div class="loading"><span class="spinner" aria-hidden="true"></span><span class="muted">Loading usage…</span></div>'
  }

  function render() {
    const focusKey = captureFocus()
    if (!state.available) {
      app.innerHTML = state.loading
        ? '<div class="empty"><p class="muted">Loading…</p></div>'
        : emptyStateHtml()
      restoreFocus(focusKey)
      return
    }

    app.innerHTML = `<div class="shell">
      ${headerHtml()}
      ${messageHtml()}
      ${state.settingsOpen ? settingsHtml() : ''}
      <main class="content">
        ${state.loading ? loadingHtml() : state.mode === 'day' ? dayViewHtml() : rangeViewHtml()}
      </main>
    </div>`
    restoreFocus(focusKey)
  }

  function onClick(event) {
    const target = event.target.closest('[data-action]')
    if (!target || !app.contains(target)) return
    const action = target.dataset.action

    if (action === 'prev' || action === 'next') {
      state.anchor = shiftAnchor(action === 'prev' ? -1 : 1)
      loadView()
    } else if (action === 'mode') {
      state.mode = target.dataset.mode
      loadView()
    } else if (action === 'open-day') {
      state.anchor = target.dataset.date
      state.mode = 'day'
      loadView()
    } else if (action === 'toggle-tracking') {
      setTracking(!state.tracking)
    } else if (action === 'settings-toggle') {
      state.settingsOpen = !state.settingsOpen
      render()
    } else if (action === 'settings-close') {
      state.settingsOpen = false
      render()
    } else if (action === 'clear-summaries') {
      clearSummaries()
    }
  }

  function onChange(event) {
    const select = event.target.closest('select[data-app]')
    if (select) {
      updateCategory(select.dataset.app, select.value)
      return
    }
    const limit = event.target.closest('input[data-limit]')
    if (limit) updateLimit(limit.value)
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && state.settingsOpen) {
      state.settingsOpen = false
      render()
    }
  }

  function registerEvents() {
    lumen.on('command', ({ id }) => {
      if (id === 'pause') setTracking(false)
      if (id === 'resume') setTracking(true)
    })
    lumen.on('visibility', ({ visible }) => {
      if (visible) liveRefresh()
    })
    app.addEventListener('click', onClick)
    app.addEventListener('change', onChange)
    app.addEventListener('keydown', onKeyDown)
  }

  async function init() {
    state.settings = await loadSettings()
    registerEvents()
    render()

    let status = null
    try {
      status = await lumen.system.activity.status()
    } catch (e) {
      status = null
    }
    state.available = Boolean(status && status.available)
    state.tracking = Boolean(status && status.tracking)
    state.current = status?.current || null

    if (!state.available) {
      state.loading = false
      render()
      return
    }

    await loadView()
    state.refreshTimer = setInterval(liveRefresh, ONE_MIN)
    state.backgroundTimer = setInterval(backgroundTick, FIVE_MIN)
    backgroundTick()
  }

  init()
})()
