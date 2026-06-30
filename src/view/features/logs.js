// Operations Log: the SSE-fed side panel, its show/hide toggle, and the
// container-log colorizer (reused by the Docker view). Importing this module
// wires the panel's own buttons (it owns #logToggleBtn/#logClose/#logClear).
import { state } from '../core/state.js'
import { escapeHtml } from '../core/util.js'
import { copyBtn } from '../views/shared.js'

const logsRoot = document.getElementById('logs')
const logStatus = document.getElementById('logStatus')

/** Reflect state.logOpen onto the panel. */
export function applyLogPanel() { document.getElementById('logPanel').classList.toggle('closed', !state.logOpen) }

document.getElementById('logToggleBtn').addEventListener('click', () => {
  state.logOpen = !state.logOpen
  localStorage.setItem('ls.logOpen', state.logOpen ? '1' : '0')
  applyLogPanel()
})
document.getElementById('logClose').addEventListener('click', () => {
  state.logOpen = false
  localStorage.setItem('ls.logOpen', '0')
  applyLogPanel()
})
document.getElementById('logClear').addEventListener('click', () => { logsRoot.innerHTML = '' })
document.getElementById('logScrollTop').addEventListener('click', () => logsRoot.scrollTo({ top: 0, behavior: 'smooth' }))
document.getElementById('logScrollBottom').addEventListener('click', () => logsRoot.scrollTo({ top: logsRoot.scrollHeight, behavior: 'smooth' }))

function appendLog(entry) {
  const level = entry.level || 'info'
  const time = new Date(entry.ts).toLocaleTimeString()
  const line = document.createElement('div')
  line.className = 'log-line copy-host lv-' + level
  let html = copyBtn() + '<span class="log-left"><span class="log-time">' + escapeHtml(time) + '</span>'
    + '<span class="log-badge">' + escapeHtml(level) + '</span></span>'
    + '<span class="log-msg">' + escapeHtml(entry.message || '')
  if (entry.meta && Object.keys(entry.meta).length) {
    const parts = Object.keys(entry.meta).map((k) => k + '=' + entry.meta[k])
    html += ' <span class="log-meta">' + escapeHtml(parts.join('  ')) + '</span>'
  }
  html += '</span>'
  line.innerHTML = html
  const atBottom = logsRoot.scrollTop + logsRoot.clientHeight >= logsRoot.scrollHeight - 24
  logsRoot.appendChild(line)
  while (logsRoot.children.length > 300) logsRoot.removeChild(logsRoot.firstChild)
  if (atBottom) logsRoot.scrollTop = logsRoot.scrollHeight
}

/** Colorize raw container logs by level + dim leading timestamps (raw-ish view). */
export function colorizeLogs(text) {
  if (!text) return ''
  const tsRe = /^(\[?\d{4}-\d{2}-\d{2}[ T][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?\]?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/
  return text.split('\n').map((ln) => {
    if (!ln) return ''
    let cls = ''
    if (/\b(error|err|fatal|panic|exception|fail(?:ed|ure)?)\b/i.test(ln)) cls = 'l-err'
    else if (/\b(warn(?:ing)?)\b/i.test(ln)) cls = 'l-warn'
    else if (/\b(debug|trace)\b/i.test(ln)) cls = 'l-debug'
    else if (/\b(info|notice)\b/i.test(ln)) cls = 'l-info'
    let html = escapeHtml(ln)
    const m = ln.match(tsRe)
    if (m) html = '<span class="l-time">' + escapeHtml(m[0]) + '</span>' + escapeHtml(ln.slice(m[0].length))
    return '<span class="l-row ' + cls + '">' + html + '</span>'
  }).join('\n')
}

// ---- prettified log formatter (timestamp + level above, message full-width) ----
const ANSI = /\x1b\[[0-9;]*m/g                                   // terminal colour codes (tracing, garage…)
const stripAnsi = (s) => s.replace(ANSI, '')
const LF_TS = /^\s*\[?(\d{4}-\d{2}-\d{2}[ T][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?|\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\]?\s*/
const GLOG = /^([EWIFD])(\d{2})(\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+\d+\s+[^\]]*\]\s*/ // k8s/glog: E0629 13:49:57.998  1 file.go:1] msg
const GLOG_LV = { E: 'ERROR', W: 'WARN', I: 'INFO', F: 'FATAL', D: 'DEBUG' }
const LF_LEVEL = /^\s*\(?(ERROR|ERRO|FATAL|PANIC|CRITICAL|WARN(?:ING)?|INFO|DEBUG|TRACE|NOTICE)\)?\b[\s:|-]*/i
const BARE_LEVEL = /^\s*(ERROR|ERRO|FATAL|PANIC|CRITICAL|WARN(?:ING)?|INFO|DEBUG|TRACE|NOTICE)\s*$/i // level alone on its own line (Kafka)
function lfClass(lv) { lv = (lv || '').toUpperCase(); if (/ERR|FATAL|PANIC|CRIT/.test(lv)) return 'lf-err'; if (/WARN/.test(lv)) return 'lf-warn'; if (/DEBUG|TRACE/.test(lv)) return 'lf-debug'; return 'lf-info' }

/** Parse messy real-world logs into rows: a compact timestamp + level badge over
 *  a full-width message. Handles ANSI colour codes, ISO/syslog/glog timestamps,
 *  and split-line formats (a bare level or continuation folds into the prior row). */
export function formatLogs(text) {
  if (!text || !text.trim()) return '<div class="lf-empty" style="padding:14px;color:#64748b">(empty)</div>'
  const rows = []
  text.split('\n').forEach((raw) => {
    const line = stripAnsi(raw)
    if (!line.replace(/\s+$/, '')) return
    const g = line.match(GLOG)
    if (g) { rows.push({ ts: g[2] + '/' + g[3] + ' ' + g[4], level: GLOG_LV[g[1]] || '', msg: line.slice(g[0].length) }); return }
    const tm = line.match(LF_TS)
    if (!tm) {
      if (!rows.length) { rows.push({ ts: '', level: '', msg: line }); return }
      const prev = rows[rows.length - 1]
      if (!prev.level && BARE_LEVEL.test(line)) prev.level = line.trim().toUpperCase() // Kafka: level on its own line
      else prev.msg += (prev.msg ? '\n' : '') + line                                   // continuation / stack frame
      return
    }
    let rest = line.slice(tm[0].length), level = ''
    const lm = rest.match(LF_LEVEL)
    if (lm) { level = lm[1].toUpperCase(); rest = rest.slice(lm[0].length) }
    rows.push({ ts: tm[1], level, msg: rest })
  })
  return rows.map((r) => {
    const cls = r.level ? lfClass(r.level) : 'lf-info'
    const head = (r.ts || r.level)
      ? '<div class="lf-head">' + (r.ts ? '<span class="lf-ts">' + escapeHtml(r.ts) + '</span>' : '')
        + (r.level ? '<span class="lf-badge">' + escapeHtml(r.level) + '</span>' : '') + '</div>'
      : ''
    // collapse runs of padding spaces (e.g. logger names aligned with spaces)
    const msg = r.msg.replace(/[ \t]{2,}/g, ' ')
    return '<div class="lf-row copy-host ' + cls + '">' + copyBtn() + head + '<div class="lf-msg">' + escapeHtml(msg) + '</div></div>'
  }).join('')
}

/** Colour KEY=value environment lines (used by the env modal). */
export function formatEnv(text) {
  if (!text || !text.trim()) return '<div class="lf-empty" style="padding:14px;color:#64748b">(empty)</div>'
  return text.split('\n').filter((l) => l.trim()).map((kv) => {
    const i = kv.indexOf('=')
    const k = i < 0 ? kv : kv.slice(0, i)
    const v = i < 0 ? '' : kv.slice(i + 1)
    return '<div class="lf-row"><div class="lf-msg"><span style="color:#a5b4fc">' + escapeHtml(k) + '</span>'
      + (i < 0 ? '' : '<span style="color:#475569">=</span><span style="color:#d6dde8">' + escapeHtml(v) + '</span>') + '</div></div>'
  }).join('')
}

// ---- expandable logs modal (wide view + Raw/Formatted toggle + scroll) ----
let lmText = '', lmFormatted = true, lmKind = 'log'
const lmEl = document.getElementById('logModal')
function lmRender() {
  const body = document.getElementById('logModalBody')
  const fmt = lmKind === 'env' ? formatEnv : formatLogs
  body.innerHTML = lmFormatted ? fmt(lmText)
    : '<pre class="mono" style="white-space:pre-wrap;word-break:break-word;color:#d6dde8;margin:0">' + escapeHtml(stripAnsi(lmText)) + '</pre>'
  document.getElementById('logModalFmt').textContent = lmFormatted ? 'Raw' : 'Formatted'
}
/** Open the wide modal with a title + raw text. kind 'env' colours KEY=value. */
export function openLogsModal(title, text, kind) {
  lmText = text || ''; lmFormatted = true; lmKind = kind || 'log'
  document.getElementById('logModalTitle').textContent = title
  lmRender(); lmEl.classList.add('open')
}
function lmClose() { lmEl.classList.remove('open') }
if (lmEl) {
  document.getElementById('logModalFmt').addEventListener('click', () => { lmFormatted = !lmFormatted; lmRender() })
  document.getElementById('logModalClose').addEventListener('click', lmClose)
  lmEl.addEventListener('click', (e) => { if (e.target === lmEl) lmClose() })
  const body = document.getElementById('logModalBody')
  document.getElementById('logModalTop').addEventListener('click', () => body.scrollTo({ top: 0, behavior: 'smooth' }))
  document.getElementById('logModalBottom').addEventListener('click', () => body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' }))
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') lmClose() })
}
// the ops-log "expand" button (added in index.html) opens the modal with the current text
const opsExpand = document.getElementById('logExpand')
if (opsExpand) opsExpand.addEventListener('click', () => openLogsModal('Operations log', logsRoot.innerText))

/** Open the SSE stream and append entries as they arrive. */
export function connectLogs() {
  const es = new EventSource('/api/logs')
  es.onopen = () => { if (logStatus) logStatus.textContent = 'Live' }
  es.onerror = () => { if (logStatus) logStatus.textContent = 'Reconnecting…' }
  es.onmessage = (ev) => { try { appendLog(JSON.parse(ev.data)) } catch {} }
}
