// Rendering engine: the tiling layout tree, panel lifecycle (rebuild/update/
// refresh), per-panel connection filter, and pointer-drag docking. The view
// objects are injected via registerViews() so this module doesn't import the
// views (which import updateLeaf from here) — breaking the cycle.
import { state, lastGood, leafMap, getConns, awsConns, connName } from './state.js'
import { t, applyI18n } from './i18n.js'
import { escapeHtml, uid, clamp, parseJson, hash } from './util.js'
import { buddySvg } from './icons.js'

/** View registry, injected by main.js (sqs/s3/docker/kafka/pgmq). */
let VIEWS = {}
export function registerViews(v) { VIEWS = v }

const grid = document.getElementById('grid')
const dropOverlay = document.getElementById('dropOverlay')
const GRIP = '<svg viewBox="0 0 20 20" fill="currentColor" class="w-3 h-3 text-slate-500 flex-shrink-0"><path d="M7 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM7 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM7 16a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 16a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/></svg>'
const CHEVRON = '<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4"><path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd"/></svg>'
const FUNNEL = '<svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5"><path fill-rule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 017.5 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.16 6.22A2.25 2.25 0 011.5 4.629V2.34a.75.75 0 01.628-.74z" clip-rule="evenodd"/></svg>'

// ---- layout tree ----
function leafNode(view) { return { type: 'leaf', id: uid(), view } }
// default layout: SQS · S3 · Docker (Docker is always part of the default)
function defaultTree() {
  return {
    type: 'split', dir: 'row', sizes: [1, 2],
    children: [
      leafNode('sqs'),
      { type: 'split', dir: 'row', sizes: [1, 1], children: [leafNode('s3'), leafNode('docker')] },
    ],
  }
}
// the previous untouched 2-panel default (sqs | s3) — upgraded to include Docker
function isOldDefaultTree(t) {
  return t && t.type === 'split' && t.dir === 'row' && Array.isArray(t.children) && t.children.length === 2 &&
    t.children[0].type === 'leaf' && t.children[0].view === 'sqs' &&
    t.children[1].type === 'leaf' && t.children[1].view === 's3'
}

function validTree(n) {
  if (!n) return false
  if (n.type === 'leaf') return ['sqs', 's3', 'docker', 'kafka', 'pgmq'].includes(n.view)
  if (n.type === 'split') {
    return (n.dir === 'row' || n.dir === 'col') && Array.isArray(n.sizes) && n.sizes.length === 2 &&
      Array.isArray(n.children) && n.children.length === 2 && validTree(n.children[0]) && validTree(n.children[1])
  }
  return false
}
function ensureIds(n) {
  if (n.type === 'leaf') { if (!n.id) n.id = uid() } else { ensureIds(n.children[0]); ensureIds(n.children[1]) }
}
function loadTree() {
  const t = parseJson(localStorage.getItem('ls.tree'), null)
  const ver = localStorage.getItem('ls.treeVer')
  localStorage.setItem('ls.treeVer', '2')
  if (validTree(t)) {
    // one-time upgrade: users still on the old sqs|s3 default get Docker added,
    // but anyone who customised their layout keeps it untouched
    if (ver !== '2' && isOldDefaultTree(t)) return defaultTree()
    ensureIds(t)
    return t
  }
  return defaultTree()
}
function saveTree() { localStorage.setItem('ls.tree', JSON.stringify(state.tree)) }

function findLeafById(id, node) {
  node = node === undefined ? state.tree : node
  if (!node) return null
  if (node.type === 'leaf') return node.id === id ? node : null
  return findLeafById(id, node.children[0]) || findLeafById(id, node.children[1])
}
function findParent(target, node, parent) {
  if (node === target) return { node, parent }
  if (node.type === 'split') return findParent(target, node.children[0], node) || findParent(target, node.children[1], node)
  return null
}
function replaceNode(oldN, newN) {
  if (state.tree === oldN) { state.tree = newN; return }
  const r = findParent(oldN, state.tree, null)
  if (r && r.parent) r.parent.children[r.parent.children.indexOf(oldN)] = newN
}
function removeLeaf(id) {
  const leaf = findLeafById(id)
  if (!leaf) return
  if (state.tree === leaf) { state.tree = null; return }
  const r = findParent(leaf, state.tree, null)
  const parent = r.parent
  const sibling = parent.children[0] === leaf ? parent.children[1] : parent.children[0]
  replaceNode(parent, sibling)
}
function dockInto(targetLeaf, view, zone) {
  if (zone === 'center') { targetLeaf.view = view; return }
  const dir = (zone === 'left' || zone === 'right') ? 'row' : 'col'
  const nl = leafNode(view)
  const order = (zone === 'left' || zone === 'top') ? [nl, targetLeaf] : [targetLeaf, nl]
  replaceNode(targetLeaf, { type: 'split', dir, sizes: [1, 1], children: order })
}
function performDock(view, sourceId, targetId, zone) {
  if (targetId === '__empty') { state.tree = leafNode(view); saveTree(); rebuildTree(); return }
  const target = findLeafById(targetId)
  if (!target) return
  if (sourceId) {
    if (sourceId === targetId) { if (zone === 'center') return; dockInto(target, view, zone) }
    else { removeLeaf(sourceId); dockInto(target, view, zone) }
  } else {
    dockInto(target, view, zone)
  }
  saveTree(); rebuildTree()
}
function closeLeaf(id) { removeLeaf(id); saveTree(); rebuildTree() }
function firstLeaf(n) { return n.type === 'leaf' ? n : firstLeaf(n.children[0]) }
function addView(view) {
  if (!state.tree) state.tree = leafNode(view)
  else dockInto(firstLeaf(state.tree), view, 'right')
  saveTree(); rebuildTree()
}

// ---- render ----
const HEAD_TINT = {
  sqs: { bg: 'rgba(244,63,94,.10)', border: 'rgba(244,63,94,.30)' },
  s3: { bg: 'rgba(16,185,129,.10)', border: 'rgba(16,185,129,.30)' },
  docker: { bg: 'rgba(56,189,248,.10)', border: 'rgba(56,189,248,.30)' },
  kafka: { bg: 'rgba(167,139,250,.10)', border: 'rgba(167,139,250,.30)' },
  pgmq: { bg: 'rgba(34,211,238,.10)', border: 'rgba(34,211,238,.30)' },
}
const TRASH = '<svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5"><path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443a41.3 41.3 0 00-2.358.3.75.75 0 10.216 1.484l.13-.019.532 8.184A2.75 2.75 0 007.262 18.5h5.476a2.75 2.75 0 002.742-2.358l.532-8.184.13.02a.75.75 0 10.216-1.485A41.3 41.3 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd"/></svg>'
const PENCIL = '<svg viewBox="0 0 20 20" fill="currentColor" class="w-3.5 h-3.5"><path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z"/><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z"/></svg>'

const FILTER_KIND = { sqs: 'aws', s3: 'aws', kafka: 'kafka', pgmq: 'pgmq' } // views that filter by connection

function makeLeafEl(node) {
  const panel = document.createElement('div')
  panel.className = 'panel'
  panel.dataset.leaf = node.id
  const m = VIEWS[node.view]
  const tint = HEAD_TINT[node.view] || { bg: 'rgb(15 23 42)', border: 'rgb(30 41 59)' }
  panel.style.borderColor = tint.border
  const hasFilter = !!FILTER_KIND[node.view]
  // NB: the panel-head must NOT carry data-leaf, or drag hit-testing resolves to
  // the header strip instead of the whole panel body.
  panel.innerHTML =
    '<div class="panel-head" title="drag to move / split" style="background:' + tint.bg + ';border-bottom:1px solid ' + tint.border + '">' + GRIP + m.icon +
      '<span class="panel-title">' + t('view.' + node.view) + '</span>' +
      (hasFilter ? '<lv-button class="panel-filter-btn" variant="icon" size="sm" title="filter by connection">' + FUNNEL + '</lv-button>' : '') +
      '<lv-button class="panel-x" variant="icon" size="sm" title="close panel">' + TRASH + '</lv-button></div>' +
    '<div class="panel-body">' + m.body() + '</div>'
  const body = panel.querySelector('.panel-body')
  const preserved = savedStates.has(node.id)        // surviving leaf across a rebuild
  const vs = savedStates.get(node.id) || newViewState(node.view)
  const filterEl = panel.querySelector('.panel-filter-btn') || null
  leafMap.set(node.id, { view: node.view, bodyEl: body, hs: {}, vs, filterEl })
  const head = panel.querySelector('.panel-head')
  head.addEventListener('mousedown', (e) => {
    if (e.target.closest('.panel-x') || e.target.closest('.panel-filter-btn')) return
    e.preventDefault()
    beginDragPending(e, node.view, node.id)
  })
  panel.querySelector('.panel-x').addEventListener('click', (e) => { e.stopPropagation(); closeLeaf(node.id) })
  if (filterEl) {
    syncFilter(leafMap.get(node.id))
    filterEl.addEventListener('click', (e) => { e.stopPropagation(); openFilterPop(node.id, node.view, filterEl, vs) })
  }
  if (m.mount) m.mount(body, vs, node.id)
  // only fetch for brand-new leaves; preserved ones already hold data and get
  // refreshed on the regular poll — avoids the full reload when adding a pane
  if (m.refresh && !preserved) m.refresh(vs, node.id)
  return panel
}

function filterConns(view) { return getConns(FILTER_KIND[view]) }
function syncFilter(entry) {
  const btn = entry.filterEl; if (!btn) return
  const conns = filterConns(entry.view)
  btn.style.display = conns.length > 1 ? '' : 'none'
  const n = (entry.vs.connFilter || []).length
  btn.classList.toggle('active', n > 0)
  let dot = btn.querySelector('.fp-dot')
  if (n > 0) { if (!dot) { dot = document.createElement('span'); dot.className = 'fp-dot'; btn.appendChild(dot) } dot.textContent = String(n) }
  else if (dot) dot.remove()
}
function refreshPanelFilters() { leafMap.forEach((entry) => syncFilter(entry)) }

const filterPop = document.getElementById('filterPop')
let filterPopLeaf = null
function openFilterPop(leafId, view, btn, vs) {
  filterPopLeaf = leafId
  const conns = filterConns(view)
  const sel = new Set(vs.connFilter || [])
  // "All" is ticked when nothing is narrowed OR every connection is ticked
  const allChecked = sel.size === 0 || sel.size === conns.length
  filterPop.innerHTML =
    '<div class="fp-item"><input type="checkbox" class="fp-all"' + (allChecked ? ' checked' : '') + ' /><span>' + t('filter.all') + '</span></div>'
    + '<div class="fp-sep"></div>'
    + conns.map((c) => '<label class="fp-item"><input type="checkbox" class="fp-c" value="' + escapeHtml(c.id) + '"' + (sel.has(c.id) ? ' checked' : '') + ' /><span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(c.name) + '</span></label>').join('')
  const r = btn.getBoundingClientRect()
  filterPop.style.top = (r.bottom + 6) + 'px'
  filterPop.style.left = Math.max(6, Math.min(r.left, window.innerWidth - 232)) + 'px'
  filterPop.classList.add('open')
  // toggling "All": on → tick every option; off → clear. Both mean "show all".
  filterPop.querySelector('.fp-all').addEventListener('change', (e) => {
    filterPop.querySelectorAll('.fp-c').forEach((cb) => { cb.checked = e.target.checked })
    applyFilter(leafId, [])
  })
  filterPop.querySelectorAll('.fp-c').forEach((cb) => cb.addEventListener('change', () => {
    const ids = Array.from(filterPop.querySelectorAll('.fp-c')).filter((x) => x.checked).map((x) => x.value)
    // every connection ticked is equivalent to "all" → store [] (no narrowing)
    applyFilter(leafId, ids.length === conns.length ? [] : ids)
  }))
}
function applyFilter(leafId, ids) {
  const entry = leafMap.get(leafId); if (!entry) return
  entry.vs.connFilter = ids
  entry.vs.selected = null
  syncFilter(entry)
  // reflect "All" checkbox state live (empty = all)
  const all = filterPop.querySelector('.fp-all'); if (all) all.checked = ids.length === 0
  const m = VIEWS[entry.view]
  if (m.refresh) m.refresh(entry.vs, leafId)
  updateLeaf(leafId)
}
function closeFilterPop() { filterPop.classList.remove('open'); filterPopLeaf = null }
document.addEventListener('click', (e) => { if (filterPop.classList.contains('open') && !filterPop.contains(e.target)) closeFilterPop() })

// each panel ("view") owns independent state, even if two panels show the same view
function newViewState(view) {
  if (view === 's3') return { bucket: '', bucketConn: '', filter: '', s3Page: 0, selectedKey: null, previewMeta: 'select an object', previewBody: '', previewType: '', editing: false, objects: [], objectsBucket: null, connFilter: [] }
  if (view === 'sqs') return { queue: '', connFilter: [] }
  if (view === 'docker') return { tab: 'containers', containers: [], images: [], volumes: [], loaded: {}, selected: null, selectedName: '', selectedIds: new Set(), logs: '', dkPane: 'logs', env: null, envLoading: false, err: null }
  if (view === 'kafka' || view === 'pgmq') return { items: [], selected: null, selectedConn: '', messages: [], err: null, connFilter: [], loading: false }
  return {}
}
function makeSplitEl(node) {
  const el = document.createElement('div')
  el.className = 'split ' + (node.dir === 'row' ? 'split-row' : 'split-col')
  const aEl = renderNode(node.children[0])
  const bEl = renderNode(node.children[1])
  aEl.style.flexGrow = node.sizes[0]; aEl.style.flexBasis = '0'; aEl.style.flexShrink = '1'
  bEl.style.flexGrow = node.sizes[1]; bEl.style.flexBasis = '0'; bEl.style.flexShrink = '1'
  const div = document.createElement('div')
  div.className = 'divider ' + (node.dir === 'row' ? 'divider-v' : 'divider-h')
  wireDivider(div, node, aEl, bEl)
  el.appendChild(aEl); el.appendChild(div); el.appendChild(bEl)
  return el
}
function renderNode(node) { return node.type === 'leaf' ? makeLeafEl(node) : makeSplitEl(node) }

function wireDivider(div, node, aEl, bEl) {
  div.addEventListener('mousedown', (e) => {
    e.preventDefault()
    document.body.style.userSelect = 'none'
    const horizontal = node.dir === 'row'
    const ra = aEl.getBoundingClientRect(), rb = bEl.getBoundingClientRect()
    const total = horizontal ? ra.width + rb.width : ra.height + rb.height
    const origin = horizontal ? ra.left : ra.top
    const sum = node.sizes[0] + node.sizes[1]
    function move(ev) {
      const pos = horizontal ? ev.clientX : ev.clientY
      const px = clamp(pos - origin, 60, total - 60)
      const ratio = px / total
      node.sizes[0] = ratio * sum; node.sizes[1] = (1 - ratio) * sum
      aEl.style.flexGrow = node.sizes[0]; bEl.style.flexGrow = node.sizes[1]
    }
    function up() {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      saveTree()
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  })
}

// preserves each leaf's view-state across a rebuild (keyed by stable leaf id) so
// adding/closing/moving a pane doesn't wipe the others or re-fetch (e.g. Docker).
const savedStates = new Map()
function rebuildTree() {
  savedStates.clear()
  leafMap.forEach((e, id) => savedStates.set(id, e.vs))
  leafMap.clear()
  grid.innerHTML = ''
  if (!state.tree) {
    const empty = document.createElement('div')
    empty.className = 'panel-empty buddy-empty'
    empty.dataset.leaf = '__empty'
    empty.innerHTML = '<div class="buddy">' + buddySvg(110, { animate: true }) + '</div>'
      + '<div class="buddy-hint">' + t('pane.drag') + '</div>'
    grid.appendChild(empty)
    return
  }
  const rootEl = renderNode(state.tree)
  rootEl.style.flex = '1'
  grid.appendChild(rootEl)
  if (typeof applyI18n === 'function') applyI18n()
  updateTree()
  savedStates.clear()
}
function updateTree() {
  leafMap.forEach((entry, id) => VIEWS[entry.view].update(entry.bodyEl, entry.hs, entry.vs, id))
}
function updateLeaf(id) {
  const e = leafMap.get(id)
  if (e) VIEWS[e.view].update(e.bodyEl, e.hs, e.vs, id)
}
function refreshLeaves() {
  leafMap.forEach((entry, id) => { if (VIEWS[entry.view].refresh) VIEWS[entry.view].refresh(entry.vs, id) })
}

// ---- custom pointer drag (docking) ----
let drag = null
let pending = null

function beginDragPending(e, view, sourceId) {
  window._dragged = false
  pending = { x: e.clientX, y: e.clientY, view, sourceId }
  document.addEventListener('mousemove', onPendingMove)
  document.addEventListener('mouseup', onPendingUp)
}
function onPendingMove(e) {
  if (!pending) return
  if (Math.abs(e.clientX - pending.x) < 4 && Math.abs(e.clientY - pending.y) < 4) return
  const p = pending
  endPending()
  startDrag(p.view, p.sourceId, e)
}
function onPendingUp() { endPending() }
function endPending() {
  pending = null
  document.removeEventListener('mousemove', onPendingMove)
  document.removeEventListener('mouseup', onPendingUp)
}

function startDrag(view, sourceId, e) {
  window._dragged = true
  const ap = document.getElementById('appsPane')
  if (ap) ap.classList.remove('open')
  drag = { view, sourceId, leafId: null, zone: null }
  const g = document.createElement('div')
  g.className = 'drag-ghost'
  g.innerHTML = VIEWS[view].icon + '<span>' + VIEWS[view].title + '</span>'
  document.body.appendChild(g)
  drag.ghost = g
  document.body.classList.add('dragging')
  positionGhost(e)
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragUp)
}
function positionGhost(e) {
  drag.ghost.style.left = (e.clientX + 12) + 'px'
  drag.ghost.style.top = (e.clientY + 14) + 'px'
}
function onDragMove(e) {
  positionGhost(e)
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const panel = el && el.closest ? el.closest('[data-leaf]') : null
  if (!panel) { drag.leafId = null; drag.zone = null; dropOverlay.style.display = 'none'; return }
  const id = panel.dataset.leaf
  const rect = panel.getBoundingClientRect()
  let zone = 'center'
  if (id !== '__empty') {
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    const dl = x, dr = 1 - x, dt = y, db = 1 - y
    const min = Math.min(dl, dr, dt, db)
    if (min > 0.28) zone = 'center'
    else if (min === dl) zone = 'left'
    else if (min === dr) zone = 'right'
    else if (min === dt) zone = 'top'
    else zone = 'bottom'
  }
  drag.leafId = id; drag.zone = zone
  showOverlay(rect, zone, id)
}
function showOverlay(rect, zone, id) {
  let x = rect.left, y = rect.top, w = rect.width, h = rect.height
  if (id !== '__empty' && zone !== 'center') {
    if (zone === 'left') { w = rect.width / 2 }
    else if (zone === 'right') { x = rect.left + rect.width / 2; w = rect.width / 2 }
    else if (zone === 'top') { h = rect.height / 2 }
    else if (zone === 'bottom') { y = rect.top + rect.height / 2; h = rect.height / 2 }
  }
  dropOverlay.style.display = 'block'
  dropOverlay.style.left = x + 'px'
  dropOverlay.style.top = y + 'px'
  dropOverlay.style.width = w + 'px'
  dropOverlay.style.height = h + 'px'
}
function onDragUp() {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragUp)
  document.body.classList.remove('dragging')
  if (drag.ghost) drag.ghost.remove()
  dropOverlay.style.display = 'none'
  const d = drag
  drag = null
  if (d.leafId) performDock(d.view, d.sourceId, d.leafId, d.zone)
}

export {
  rebuildTree, updateTree, updateLeaf, refreshLeaves, addView, beginDragPending,
  loadTree, saveTree, defaultTree, ensureIds, refreshPanelFilters,
  GRIP, CHEVRON, FUNNEL, TRASH, PENCIL,
}
