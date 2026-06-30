// Custom tooltip behavior: auto-upgrades native `title` attributes into a
// styled floating tip. Call initTooltips() ONCE at boot (not on import — so it
// never double-binds with the legacy inline tooltip during the migration).

let tipEl = null
let target = null

// each distinct tooltip is shown once, then never again (persisted)
const seen = new Set((() => { try { return JSON.parse(localStorage.getItem('ls.tipsSeen') || '[]') } catch { return [] } })())
function markSeen(t) { seen.add(t); try { localStorage.setItem('ls.tipsSeen', JSON.stringify([...seen])) } catch {} }

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v }

function show(el) {
  let text = el.getAttribute('data-tip')
  if (text == null && el.hasAttribute('title')) {
    const t = el.getAttribute('title')
    el.removeAttribute('title')
    // title tooltips only help on icon-only controls; a labeled button/element's
    // title is redundant noise — drop it permanently (don't promote to data-tip)
    if ((el.textContent || '').trim()) return
    el.setAttribute('data-tip', t)
    text = t
  }
  if (!text) return
  if (text.trim() === (el.textContent || '').trim()) return
  if (seen.has(text)) return                 // already shown once — never again
  markSeen(text)
  target = el
  tipEl.textContent = text
  tipEl.style.left = '0px'; tipEl.style.top = '0px'
  tipEl.classList.add('show')
  const r = el.getBoundingClientRect()
  const tr = tipEl.getBoundingClientRect()
  let left = r.left + r.width / 2 - tr.width / 2
  let top = r.bottom + 7
  if (top + tr.height > window.innerHeight - 6) top = r.top - tr.height - 7
  left = clamp(left, 6, window.innerWidth - tr.width - 6)
  tipEl.style.left = left + 'px'
  tipEl.style.top = Math.max(6, top) + 'px'
}

function hide() { target = null; if (tipEl) tipEl.classList.remove('show') }

/** Wire global hover tooltips. Idempotent. */
export function initTooltips() {
  if (tipEl) return
  tipEl = document.getElementById('tip') || Object.assign(document.createElement('div'), { id: 'tip' })
  if (!tipEl.isConnected) document.body.appendChild(tipEl)
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest ? e.target.closest('[data-tip],[title]') : null
    if (el && el !== target) show(el)
  })
  document.addEventListener('mouseout', (e) => {
    if (!target) return
    const to = e.relatedTarget
    if (!to || !target.contains(to)) hide()
  })
  document.addEventListener('mousedown', hide, true)
}
