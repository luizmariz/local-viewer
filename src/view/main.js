// LOCAL VIEWER — application entry module. Wires the modules together and runs
// the boot sequence + the AWS poll loop; everything else lives in core/, views/,
// features/ and components/. See web/src/CONVENTIONS.md.
import './components/index.js'                 // registers all lv-* custom elements
import { initTooltips } from './components/index.js'
import { applyI18n, setLang, currentLang } from './core/i18n.js'
import { parseJson, escapeHtml } from './core/util.js'
import { buddySvg } from './core/icons.js'
import { state, lastGood, awsConns, refreshConns } from './core/state.js'
import { applyLogPanel, connectLogs } from './features/logs.js'
import { renderCfBanner } from './features/cfbanner.js'
import { checkLockOnBoot } from './features/auth.js'
import './features/settings.js'                // self-wiring settings modal
import { rebuildTree, updateTree, refreshLeaves, addView, beginDragPending, loadTree, saveTree, defaultTree, ensureIds, refreshPanelFilters, registerViews } from './core/render.js'
import { VIEWS } from './views/registry.js'

// re-sync the per-panel connection filters whenever the connection list changes
document.addEventListener('lv-conns', () => refreshPanelFilters())





registerViews(VIEWS)

function wireChip(id, view) {
  const c = document.getElementById(id)
  c.addEventListener('mousedown', (e) => { e.preventDefault(); beginDragPending(e, view, null) })
  c.addEventListener('click', () => { if (window._dragged) { window._dragged = false; return } addView(view) })
}
wireChip('chip-sqs', 'sqs')
wireChip('chip-s3', 's3')
wireChip('chip-docker', 'docker')
wireChip('chip-kafka', 'kafka')
wireChip('chip-pgmq', 'pgmq')

// ---- apps launcher + saved layouts ----
const appsBtn = document.getElementById('appsBtn')
const appsPane = document.getElementById('appsPane')
const layoutsBtn = document.getElementById('layoutsBtn')
const layoutsPane = document.getElementById('layoutsPane')

function positionPane(pane, btn) {
  const r = btn.getBoundingClientRect()
  pane.style.top = (r.bottom + 6) + 'px'
  pane.style.left = r.left + 'px'
}
function openApps(on) {
  if (on) { positionPane(appsPane, appsBtn); appsPane.classList.add('open'); layoutsPane.classList.remove('open') }
  else appsPane.classList.remove('open')
}
function openLayouts(on) {
  if (on) { positionPane(layoutsPane, layoutsBtn); layoutsPane.classList.add('open'); appsPane.classList.remove('open'); renderLayoutList() }
  else layoutsPane.classList.remove('open')
}
appsBtn.addEventListener('click', (e) => { e.stopPropagation(); openApps(!appsPane.classList.contains('open')) })
layoutsBtn.addEventListener('click', (e) => { e.stopPropagation(); openLayouts(!layoutsPane.classList.contains('open')) })
document.addEventListener('click', (e) => {
  if (appsPane.classList.contains('open') && !appsPane.contains(e.target) && !appsBtn.contains(e.target)) openApps(false)
  if (layoutsPane.classList.contains('open') && !layoutsPane.contains(e.target) && !layoutsBtn.contains(e.target)) openLayouts(false)
})

function loadLayouts() { return parseJson(localStorage.getItem('ls.layouts'), {}) }
function saveLayouts(o) { localStorage.setItem('ls.layouts', JSON.stringify(o)) }
function renderLayoutList() {
  const o = loadLayouts()
  const root = document.getElementById('layoutList')
  const names = Object.keys(o)
  if (!names.length) { root.innerHTML = '<div class="italic" style="font-size:13px;color:#475569">none saved yet</div>'; return }
  root.innerHTML = names.map((n) =>
    '<div style="display:flex;align-items:center;gap:6px">' +
      '<button class="ly-load mono" data-n="' + escapeHtml(n) + '" style="box-sizing:border-box;height:26px;display:flex;align-items:center;flex:1;min-width:0;text-align:left;font-size:13px;padding:0 8px;border-radius:5px;border:1px solid rgb(51 65 85);background:rgb(30 41 59);color:#c2cbd8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(n) + '</button>' +
      '<lv-button class="ly-del" variant="icon" size="sm" data-n="' + escapeHtml(n) + '" title="delete layout"><lv-icon name="trash" size="12"></lv-icon></lv-button>' +
    '</div>'
  ).join('')
  root.querySelectorAll('.ly-load').forEach((b) => b.addEventListener('click', () => {
    const all = loadLayouts(); const t = all[b.dataset.n]
    if (t) { state.tree = JSON.parse(JSON.stringify(t)); ensureIds(state.tree); saveTree(); rebuildTree(); openLayouts(false) }
  }))
  root.querySelectorAll('.ly-del').forEach((b) => b.addEventListener('click', () => {
    const all = loadLayouts(); delete all[b.dataset.n]; saveLayouts(all); renderLayoutList()
  }))
}
document.getElementById('layoutSave').addEventListener('click', () => {
  const inp = document.getElementById('layoutName')
  const n = (inp.value || '').trim()
  if (!n) return
  const all = loadLayouts()
  all[n] = state.tree ? JSON.parse(JSON.stringify(state.tree)) : null
  saveLayouts(all)
  inp.value = ''
  renderLayoutList()
})

function mergeQueues(prev, next) {
  if (!Array.isArray(next)) return prev
  const prevByUrl = new Map(prev.map((q) => [q.url, q]))
  return next.map((q) => {
    const old = prevByUrl.get(q.url) || {}
    return {
      ...q,
      attrs: q.attrs == null ? (old.attrs || { visible: 0, inFlight: 0, delayed: 0 }) : q.attrs,
      messages: q.messages == null ? (old.messages || []) : q.messages,
    }
  })
}

const ICON_PAUSE = '<lv-icon name="pause" size="18"></lv-icon>'
const ICON_PLAY = '<lv-icon name="play" size="18"></lv-icon>'

const refreshIcon = document.getElementById('refreshIcon')
const tickerEl = document.getElementById('ticker')
const pauseBtn = document.getElementById('pause')

// auto-refresh is "live" only when not paused AND an interval is selected
function isLive() { return !state.paused && state.interval > 0 }
// spin reflects real activity (a sweep in flight); kept on for a minimum window
// so a fast sweep is still visibly perceptible
let _spinSince = 0, _spinOffTimer = null
function setLiveIndicator() {
  if (state.loading) {
    if (_spinOffTimer) { clearTimeout(_spinOffTimer); _spinOffTimer = null }
    if (!refreshIcon.classList.contains('spin')) { refreshIcon.classList.add('spin'); _spinSince = Date.now() }
  } else if (refreshIcon.classList.contains('spin') && !_spinOffTimer) {
    const wait = Math.max(0, 650 - (Date.now() - _spinSince))
    _spinOffTimer = setTimeout(() => { _spinOffTimer = null; if (!state.loading) refreshIcon.classList.remove('spin') }, wait)
  }
}
function renderPause() {
  if (state.interval === 0) {
    pauseBtn.innerHTML = ICON_PLAY
    pauseBtn.disabled = true
    pauseBtn.title = 'auto-refresh is off — pick an interval'
    return
  }
  pauseBtn.disabled = false
  pauseBtn.innerHTML = state.paused ? ICON_PLAY : ICON_PAUSE
  pauseBtn.title = state.paused ? 'resume auto-refresh' : 'pause auto-refresh'
}
function fmtAgo(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return s + 's ago'
  const m = Math.floor(s / 60)
  if (m < 60) return m + 'min ago'
  return Math.floor(m / 60) + 'h ago'
}
function renderTicker() {
  // no "refreshing…/updated Xs ago" text — it changed every second and read as
  // flicker; the spinning icon signals activity. Only surface non-churning states.
  if (state.tickerErr) { tickerEl.textContent = '⚠ ' + state.tickerErr; return }
  tickerEl.textContent = state.paused ? 'Paused' : (state.interval === 0 ? 'Auto-refresh off' : '')
}
setInterval(renderTicker, 1000)

function tagConn(arr, c) { (arr || []).forEach((x) => { x._conn = { id: c.id, name: c.name } }); return arr || [] }

async function tick() {
  state.loading = true
  setLiveIndicator(); renderTicker()
  try {
    await refreshConns()
    const conns = awsConns()
    const buckets = [], changesets = []
    let queues = []
    let anyErr = null

    const results = await Promise.all(conns.map((c) =>
      fetch('/api/state?conn=' + encodeURIComponent(c.id))
        .then((r) => r.json())
        .then((d) => ({ c, d }))
        .catch((e) => ({ c, d: { _err: e.message } }))
    ))
    for (const { c, d } of results) {
      if (d._err) { anyErr = d._err; continue }
      if (Array.isArray(d.buckets)) buckets.push(...tagConn(d.buckets, c))
      if (Array.isArray(d.changesets)) changesets.push(...tagConn(d.changesets, c))
      if (Array.isArray(d.queues)) queues.push(...tagConn(d.queues, c))
    }
    // deterministic order so rows never shuffle between polls
    const byConnName = (a, b) => ((a._conn ? a._conn.name : '') + a.name).localeCompare((b._conn ? b._conn.name : '') + b.name)
    lastGood.buckets = buckets.sort(byConnName)
    lastGood.changesets = changesets.sort((a, b) => (a.stackName + a.changeSetName).localeCompare(b.stackName + b.changeSetName))
    lastGood.queues = mergeQueues(lastGood.queues, queues)

    document.getElementById('meta').textContent = conns.length
      ? (lastGood.queues.length + ' queues · ' + lastGood.buckets.length + ' buckets' +
         (lastGood.changesets.length ? ' · ' + lastGood.changesets.length + ' changesets' : '') +
         ' · ' + conns.length + ' conn' + (conns.length > 1 ? 's' : ''))
      : 'no AWS connections'

    renderCfBanner(lastGood.changesets)
    updateTree()
    refreshLeaves()

    state.lastUpdate = Date.now()
    state.tickerErr = anyErr
    refreshIcon.classList.toggle('err', !!anyErr)
  } catch (err) {
    state.tickerErr = err.message
    refreshIcon.classList.add('err')
  } finally {
    state.loading = false
    setLiveIndicator()
    renderTicker()
  }
}

function schedule() {
  if (state.timer) clearTimeout(state.timer)
  setLiveIndicator()
  if (!isLive()) return
  state.timer = setTimeout(async () => { await tick(); schedule() }, state.interval)
}

// ---- header controls ----
document.getElementById('interval').addEventListener('change', (e) => { state.interval = Number(e.target.value); renderPause(); renderTicker(); schedule() })
pauseBtn.addEventListener('click', () => {
  if (state.interval === 0) return
  state.paused = !state.paused
  renderPause()
  setLiveIndicator()
  renderTicker()
  if (!state.paused) { tick(); schedule() }
})
renderPause()
document.getElementById('resetLayout').addEventListener('click', () => {
  state.tree = defaultTree()
  saveTree()
  rebuildTree()
  openLayouts(false)
})
// ---- language selector ----
const langSel = document.getElementById('langSel')
if (langSel) {
  langSel.value = currentLang()
  langSel.addEventListener('change', (e) => setLang(e.target.value))
}

// ---- boot ----
document.getElementById('logoSlot').innerHTML = buddySvg(24)
document.getElementById('favicon').href = 'data:image/svg+xml,' + encodeURIComponent(buddySvg(64))
initTooltips()                                              // global data-tip behavior
document.addEventListener('lv-lang', () => rebuildTree())   // re-render on language switch
document.addEventListener('lv-refresh', () => tick())       // post-action re-sweep (cfbanner, …)
state.tree = loadTree()
applyLogPanel()
rebuildTree()
applyI18n()
connectLogs()
checkLockOnBoot()
tick().then(schedule)
