// Formatting, date arithmetic and the two charts (timeline, daily bars).
// Kept separate from main.js so the dashboard logic stays readable.
(() => {
  const HOUR = 60 * 60 * 1000
  const MIN = 60 * 1000
  const INTERRUPT_MS = 2 * MIN

  const pad2 = (n) => String(n).padStart(2, '0')

  function isoDay(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
  }

  function parseDay(day) {
    const [y, m, d] = String(day).split('-').map(Number)
    return new Date(y, m - 1, d)
  }

  function addDays(day, n) {
    const d = parseDay(day)
    d.setDate(d.getDate() + n)
    return isoDay(d)
  }

  function addMonths(day, n) {
    const d = parseDay(day)
    const target = new Date(d.getFullYear(), d.getMonth() + n, 1)
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
    target.setDate(Math.min(d.getDate(), last))
    return isoDay(target)
  }

  function startOfWeek(day) {
    const d = parseDay(day)
    const offset = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - offset)
    return isoDay(d)
  }

  function monthStart(day) {
    const d = parseDay(day)
    return isoDay(new Date(d.getFullYear(), d.getMonth(), 1))
  }

  function monthEnd(day) {
    const d = parseDay(day)
    return isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0))
  }

  function daysBetween(start, end) {
    const out = []
    let day = start
    while (day <= end) {
      out.push(day)
      day = addDays(day, 1)
    }
    return out
  }

  function formatDuration(ms) {
    const minutes = Math.round(Math.max(0, ms) / MIN)
    if (minutes < 1) return '0 min'
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    if (!h) return `${m} min`
    if (!m) return `${h} h`
    return `${h} h ${m} min`
  }

  function formatClock(ts) {
    const d = new Date(ts)
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]))
  }

  function categoryClass(category) {
    return `cat-${category}`
  }

  const shortDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const longDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const longDateYear = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const monthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
  const monthShort = new Intl.DateTimeFormat(undefined, { month: 'short' })
  const monthDay = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
  const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

  function formatDateShort(day) {
    return shortDate.format(parseDay(day))
  }

  function formatDateLong(day) {
    const d = parseDay(day)
    return (d.getFullYear() === new Date().getFullYear() ? longDate : longDateYear).format(d)
  }

  function formatWeekLabel(day) {
    const start = startOfWeek(day)
    const end = addDays(start, 6)
    const s = parseDay(start)
    const e = parseDay(end)
    const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
    if (sameMonth) return `${s.getDate()} – ${e.getDate()} ${monthShort.format(e)}, ${e.getFullYear()}`
    return `${monthDay.format(s)} – ${monthDay.format(e)}, ${e.getFullYear()}`
  }

  function formatMonthLabel(day) {
    return monthYear.format(parseDay(day))
  }

  function longestFocus(segments, categoryFor) {
    const sorted = segments.slice().sort((a, b) => a.start - b.start)
    let best = null
    let run = 0
    let runStart = null
    let runEnd = null
    let lastEnd = null

    for (const seg of sorted) {
      const duration = Math.max(0, seg.end - seg.start)
      if (lastEnd != null && seg.start - lastEnd >= INTERRUPT_MS) {
        run = 0
        runStart = null
        runEnd = null
      }
      if (categoryFor(seg.app) === 'productive') {
        if (!run) runStart = seg.start
        run += duration
        runEnd = seg.end
        if (!best || run > best.ms) best = { ms: run, start: runStart, end: runEnd }
      } else if (duration >= INTERRUPT_MS) {
        run = 0
        runStart = null
        runEnd = null
      }
      lastEnd = lastEnd == null ? seg.end : Math.max(lastEnd, seg.end)
    }

    return best
  }

  function hourTicks(start, end) {
    const d = new Date(start)
    d.setMinutes(0, 0, 0)
    if (d.getTime() < start) d.setHours(d.getHours() + 1)
    const ticks = []
    while (d.getTime() <= end) {
      ticks.push(d.getTime())
      d.setHours(d.getHours() + 1)
    }
    const every = ticks.length > 14 ? 2 : 1
    return ticks.filter((_, i) => i % every === 0)
  }

  function timelineHtml(date, stats, categoryFor) {
    const base = parseDay(date)
    const workStart = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 8, 0, 0, 0).getTime()
    const workEnd = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 18, 0, 0, 0).getTime()
    let start = workStart
    let end = workEnd
    for (const seg of stats.segments) {
      if (seg.start < start) start = seg.start
      if (seg.end > end) end = seg.end
    }
    if (!(end > start)) end = start + HOUR
    const span = end - start

    const segments = stats.segments.map((seg) => {
      const duration = Math.max(0, seg.end - seg.start)
      if (!duration) return ''
      const left = Math.max(0, Math.min(100, ((seg.start - start) / span) * 100))
      const width = Math.max(0.35, Math.min(100 - left, (duration / span) * 100))
      const category = categoryFor(seg.app)
      const label = `${seg.app}, ${formatClock(seg.start)} to ${formatClock(seg.end)}, ${formatDuration(duration)}, ${category}`
      return `<div class="seg ${categoryClass(category)}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%" tabindex="0" role="img" data-fkey="seg-${seg.start}" aria-label="${escapeHtml(label)}">
        <span class="tip"><strong>${escapeHtml(seg.app)}</strong><span>${formatClock(seg.start)}–${formatClock(seg.end)} · ${formatDuration(duration)}</span></span>
      </div>`
    }).join('')

    const ticks = hourTicks(start, end).map((tick) => {
      const left = ((tick - start) / span) * 100
      return `<span class="tick" style="left:${left.toFixed(3)}%"><span class="tick-label">${formatClock(tick)}</span></span>`
    }).join('')

    const rows = stats.segments.map((seg) => `<tr><td>${escapeHtml(seg.app)}</td><td>${formatClock(seg.start)}</td><td>${formatClock(seg.end)}</td><td>${formatDuration(seg.end - seg.start)}</td><td>${categoryFor(seg.app)}</td></tr>`).join('')

    return `<div class="timeline-block">
      <div class="timeline" role="group" aria-label="App timeline for ${escapeHtml(formatDateLong(date))}">
        <div class="timeline-bar">${segments}</div>
        <div class="timeline-ticks">${ticks}</div>
      </div>
      <div class="sr-only">
        <table>
          <caption>Apps used on ${escapeHtml(formatDateLong(date))}</caption>
          <thead><tr><th>App</th><th>Start</th><th>End</th><th>Duration</th><th>Category</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`
  }

  function rangeChartHtml(dates, statsByDate, mode) {
    const max = Math.max(1, ...dates.map((day) => statsByDate[day]?.activeMs || 0))
    const columns = dates.map((day) => {
      const stats = statsByDate[day]
      const active = stats?.activeMs || 0
      const byCategory = stats?.byCategory || { productive: 0, neutral: 0, distracting: 0 }
      const categoryTotal = byCategory.productive + byCategory.neutral + byCategory.distracting
      const height = active ? Math.max(2, (active / max) * 100) : 0
      const stacks = ['productive', 'neutral', 'distracting'].map((category) => {
        const share = categoryTotal ? (byCategory[category] / categoryTotal) * 100 : 0
        return share > 0 ? `<span class="stack ${categoryClass(category)}" style="height:${share.toFixed(3)}%"></span>` : ''
      }).join('')
      const label = active
        ? `${formatDateShort(day)}: ${formatDuration(active)} active, focus score ${stats.score}`
        : `${formatDateShort(day)}: no activity`
      const dateNumber = parseDay(day).getDate()
      const text = mode === 'month'
        ? (dateNumber === 1 || dateNumber % 5 === 0 || dateNumber === dates.length ? String(dateNumber) : '')
        : weekdayShort.format(parseDay(day))
      return `<button type="button" class="day-col" data-action="open-day" data-date="${day}" data-fkey="day-${day}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
        <span class="day-plot"><span class="day-bar" style="height:${height.toFixed(3)}%">${stacks}</span></span>
        <span class="day-label">${escapeHtml(text)}</span>
      </button>`
    }).join('')

    const rows = dates.map((day) => {
      const stats = statsByDate[day]
      const byCategory = stats?.byCategory || { productive: 0, neutral: 0, distracting: 0 }
      return `<tr><td>${escapeHtml(formatDateShort(day))}</td><td>${formatDuration(stats?.activeMs || 0)}</td><td>${formatDuration(byCategory.productive)}</td><td>${formatDuration(byCategory.neutral)}</td><td>${formatDuration(byCategory.distracting)}</td><td>${stats?.score ?? 0}</td></tr>`
    }).join('')

    return `<div class="range-chart ${mode}">
      <div class="range-bars" style="--cols:${dates.length}">${columns}</div>
      <div class="sr-only">
        <table>
          <caption>${mode === 'week' ? 'Week' : 'Month'} overview</caption>
          <thead><tr><th>Day</th><th>Active</th><th>Productive</th><th>Neutral</th><th>Distracting</th><th>Focus score</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`
  }

  window.UsageCharts = {
    HOUR,
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
    categoryClass,
    formatDateShort,
    formatDateLong,
    formatWeekLabel,
    formatMonthLabel,
    longestFocus,
    timelineHtml,
    rangeChartHtml,
  }
})()
