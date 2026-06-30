// Markup shared across the view modules: the coloured per-view icon map (used
// for panel/chip icons — distinct from the monochrome <lv-icon> registry) and
// the small connection badge.
import { escapeHtml } from '../core/util.js'
import { iconSvg } from '../core/icons.js'
import { notify } from '../components/index.js'

// Small icon-only copy button. Place inside a `.copy-host` (position:relative);
// clicking copies that host's text. Shown on hover, top-right corner.
export function copyBtn() {
  return '<button class="copy-btn" title="copy">' + iconSvg('copy', 12) + '</button>'
}
// install the delegated click handler once
if (typeof document !== 'undefined' && !window.__lvCopyWired) {
  window.__lvCopyWired = true
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.copy-btn')
    if (!b) return
    e.stopPropagation(); e.preventDefault()
    const host = b.closest('.copy-host') || b.parentElement
    const text = (host ? host.innerText : '').trim()
    if (text && navigator.clipboard) navigator.clipboard.writeText(text).then(() => notify('Copied', 'ok')).catch(() => {})
  })
}

/** Coloured view icons keyed by view name (full <svg> strings). */
export const ICONS = {
  sqs: '<svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 text-rose-400 flex-shrink-0"><path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z"/></svg>',
  s3: '<svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 text-emerald-400 flex-shrink-0"><path d="M4 3a2 2 0 00-2 2v1h16V5a2 2 0 00-2-2H4zM2 9v7a2 2 0 002 2h12a2 2 0 002-2V9H2zm4 2a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z"/></svg>',
  docker: '<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-sky-400 flex-shrink-0"><path d="M3 7h2.6v2.4H3V7zm3.1 0h2.6v2.4H6.1V7zm3.1 0h2.6v2.4H9.2V7zM6.1 4.2h2.6v2.4H6.1V4.2zm9.6 2.9c-.4 0-.9.1-1.2.3-.2-1.1-1.1-1.7-1.6-2l-.4-.2-.3.4c-.3.6-.5 1.4-.3 2 .1.4.3.7.5.9-.3.2-1 .5-1.9.5H1.6l-.1.6c-.2 1.6.2 3.2 1.2 4.3 1 .9 2.4 1.4 4.2 1.4 3.9 0 6.8-1.8 8.2-5 .8 0 1.7-.2 2.3-1.2l.2-.3-.3-.2c-.4-.3-1.1-.4-1.8-.2z"/></svg>',
  kafka: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 text-violet-400 flex-shrink-0"><circle cx="6" cy="12" r="2.2"/><circle cx="17" cy="6" r="2.2"/><circle cx="17" cy="18" r="2.2"/><path d="M8 11l7-4M8 13l7 4"/></svg>',
  pgmq: '<svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5 text-cyan-400 flex-shrink-0"><path d="M10 2c3.9 0 7 1.2 7 2.7S13.9 7.3 10 7.3 3 6.2 3 4.7 6.1 2 10 2zM3 7.2c1.3 1 4 1.6 7 1.6s5.7-.6 7-1.6v3.1c0 1.5-3.1 2.7-7 2.7s-7-1.2-7-2.7V7.2zm0 5.5c1.3 1 4 1.6 7 1.6s5.7-.6 7-1.6v2.6c0 1.5-3.1 2.7-7 2.7s-7-1.2-7-2.7v-2.6z"/></svg>',
}

/** A centered spinner + label row for first-load / pending states. */
export function loadingRow(label) {
  return '<div style="font-family:\'Ubuntu\',sans-serif;display:flex;align-items:center;justify-content:center;gap:10px;padding:26px 14px;color:#64748b;font-size:13px">'
    + '<span class="spinner" style="width:18px;height:18px;border-width:2px"></span>' + escapeHtml(label || 'Loading…') + '</div>'
}

/** A small pill showing which connection an item came from. */
export function connBadge(c) {
  if (!c || !c.name) return ''
  return '<span class="conn-badge" title="connection: ' + escapeHtml(c.name) + '">' + escapeHtml(c.name) + '</span>'
}
