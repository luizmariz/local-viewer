// Pure helpers shared across the app. No DOM lifecycle here — just formatting,
// escaping, and small primitives. Keep this dependency-free.

/** localStorage get with default. */
export function lsGet(k, d) { const v = localStorage.getItem(k); return v === null ? d : v }
/** JSON.parse that never throws; returns `d` on error/null. */
export function parseJson(s, d) { try { const v = JSON.parse(s); return v == null ? d : v } catch { return d } }

/** Stable string key for change-detection (render hashing). */
export function hash(o) { return JSON.stringify(o) }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }
/** Short unique id for layout leaves. */
export function uid() { return 'p' + Math.random().toString(36).slice(2, 9) }

/** Relative "3m ago" from an ISO timestamp. */
export function fmtTimeAgo(iso) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 1000) return 'just now'
  if (ms < 60000) return Math.floor(ms / 1000) + 's ago'
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago'
  return Math.floor(ms / 3600000) + 'h ago'
}
export function fmtSentTs(epochMs) { return epochMs ? new Date(Number(epochMs)).toLocaleTimeString() : '—' }
export function fmtDateTime(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString() }
export function fmtBytes(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

/** Escape a value for safe interpolation into innerHTML. */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
/** Small uppercase-muted section label markup. */
export function lbl(t) {
  return '<div style="font-size:12px;letter-spacing:.02em;color:#64748b;padding:0 2px 4px">' + t + '</div>'
}
