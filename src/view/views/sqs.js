// SQS queues view: one row per queue (aggregated across AWS connections),
// depth counts, drag-to-reorder, and a sliding side pane with messages +
// purge / DLQ-redrive actions.
import { escapeHtml, fmtSentTs, hash } from '../core/util.js'
import { state, lastGood, leafMap, awsConns } from '../core/state.js'
import { updateLeaf, updateTree, GRIP, CHEVRON } from '../core/render.js'
import { confirmDialog, notify } from '../components/index.js'
import { postJson, requestRefresh } from '../core/api.js'
import { ICONS, copyBtn } from './shared.js'

function queueChip(kind) {
  const map = {
    dlq: ['DLQ', '#fecaca', 'rgba(127,29,29,.55)', '#7f1d1d'],
    fifo: ['FIFO', '#f5d0fe', 'rgba(112,26,117,.5)', '#701a75'],
    standard: ['STD', '#c2cbd8', 'rgb(30 41 59)', 'rgb(51 65 85)'],
  }
  const t = map[kind] || map.standard
  return '<span style="font-size:10px;font-weight:600;letter-spacing:.02em;padding:1px 6px;border-radius:9999px;color:' + t[1] + ';background:' + t[2] + ';border:1px solid ' + t[3] + '">' + t[0] + '</span>'
}
function depthMini(value, color, label, title) {
  const c = value > 0 ? color : '#475569'
  return '<div title="' + title + '" style="text-align:center;min-width:36px">' +
         '<div style="font-size:14px;font-weight:600;color:' + c + ';line-height:1.1">' + value + '</div>' +
         '<div style="font-size:10px;color:#64748b">' + label + '</div></div>'
}

const REDRIVE_TIP = 'Redrive: move all messages from this dead-letter queue back to its source queue (the one whose RedrivePolicy points here) so they get reprocessed.'
const PURGE_TIP = 'Purge: permanently delete ALL messages in this queue. This cannot be undone.'

function queueCountsHtml(q) {
  return depthMini(q.attrs.visible, '#6ee7b7', 'vis', 'Visible — available to receive') +
         depthMini(q.attrs.inFlight, '#fcd34d', 'inflt', 'In-Flight — received but not yet deleted') +
         depthMini(q.attrs.delayed, '#7dd3fc', 'dly', 'Delayed — not yet visible')
}

function qConn(q) { return (q._conn && q._conn.id) || '' }

function queueActionsHtml(q) {
  let actions = ''
  const da = ' data-url="' + escapeHtml(q.url) + '" data-name="' + escapeHtml(q.name) + '" data-conn="' + escapeHtml(qConn(q)) + '"'
  if (q.kind === 'dlq' && (q.attrs.visible > 0 || q.attrs.inFlight > 0)) {
    actions += '<lv-button class="qa-redrive" variant="warn" size="sm" title="' + REDRIVE_TIP + '"' + da + '>Redrive</lv-button>'
  }
  if (q.attrs.visible > 0 || q.attrs.inFlight > 0) {
    actions += '<lv-button class="qa-purge" variant="danger" size="sm" title="' + PURGE_TIP + '"' + da + '>Purge</lv-button>'
  }
  return actions
}

// category as inline coloured text for the subtitle (the pill chip stays in the side-pane head)
function queueKindText(kind) {
  const map = { dlq: ['DLQ', '#fca5a5'], fifo: ['FIFO', '#e879f9'], standard: ['Standard', '#94a3b8'] }
  const t = map[kind] || map.standard
  return '<span style="color:' + t[1] + ';font-weight:500">' + t[0] + '</span>'
}
// list row (master) — title on top; origin connection + category as a muted
// subtitle (visual hierarchy); workload counts on the right. Grip to reorder.
function queueRowHtml(q, vs, showConn) {
  const sel = q.url === vs.queue
  const conn = showConn && q._conn ? '<span style="color:#64748b">' + escapeHtml(q._conn.name) + '</span> · ' : ''
  return '<div class="q-row' + (sel ? ' q-sel' : '') + '" data-name="' + escapeHtml(q.name) + '" data-url="' + escapeHtml(q.url) + '">' +
           '<span class="q-grip" title="drag to reorder" style="cursor:grab;padding:0 4px">' + GRIP + '</span>' +
           '<div class="q-open" style="flex:1;min-width:0;display:flex;align-items:center;gap:10px;cursor:pointer;padding:6px 10px 6px 2px">' +
             '<div style="flex:1;min-width:0">' +
               '<div class="mono" title="' + escapeHtml(q.name) + '" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:#c2cbd8">' + escapeHtml(q.name) + '</div>' +
               '<div style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px">' + conn + queueKindText(q.kind) + '</div>' +
             '</div>' +
             '<span style="display:flex;gap:14px;flex-shrink:0">' + queueCountsHtml(q) + '</span>' +
           '</div>' +
         '</div>'
}

function sideHeadHtml(q) {
  return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgb(30 41 59)">' +
           '<lv-button class="pane-chev" variant="chev" title="close">' + CHEVRON + '</lv-button>' +
           queueChip(q.kind) +
           '<span class="mono" title="' + escapeHtml(q.name) + '" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:14px;color:#c2cbd8">' + escapeHtml(q.name) + '</span>' +
           '<span style="display:flex;gap:6px;align-items:center;flex-shrink:0">' + queueActionsHtml(q) + '</span>' +
         '</div>'
}

function detailMessagesHtml(q) {
  if (!q.messages.length) {
    return '<div class="italic" style="padding:14px;color:#64748b;font-size:14px">no messages to preview (queue empty, or messages in-flight)</div>'
  }
  let html = q.messages.map((m) => {
    const isObj = typeof m.body === 'object'
    const body = isObj ? JSON.stringify(m.body, null, 2) : String(m.body)
    let badges = ''
    if (m.group) badges += '<span class="mono" style="color:#818cf8;font-size:12px">group=' + escapeHtml(m.group) + '</span>'
    if (m.receiveCount > 1) badges += '<span class="mono" style="color:#fcd34d;font-size:12px;font-weight:600">&#x21bb; ' + m.receiveCount + '</span>'
    return '<div class="copy-host" style="border-bottom:1px solid rgb(30 41 59);padding:8px 12px">' + copyBtn() +
             '<div class="mono" style="display:flex;gap:10px;align-items:center;font-size:12px;color:#64748b">' +
               '<span>' + fmtSentTs(m.sentAt) + '</span>' + badges +
             '</div>' +
             '<pre class="mono" style="margin-top:5px;font-size:13px;color:#d6dde8;white-space:pre-wrap;word-break:break-all">' + escapeHtml(body) + '</pre>' +
           '</div>'
  }).join('')
  if (q.attrs.visible > q.messages.length) {
    html += '<div style="padding:6px 12px;font-size:12px;color:#64748b;text-align:center">showing ' + q.messages.length + ' of ' + q.attrs.visible + '</div>'
  }
  return html
}

// ---- queue ordering / drag-reorder ----
function sortQueues(queues) {
  const order = state.queueOrder || []
  const rank = new Map(order.map((n, i) => [n, i]))
  return queues.slice().sort((a, b) => {
    const ra = rank.has(a.name) ? rank.get(a.name) : Infinity
    const rb = rank.has(b.name) ? rank.get(b.name) : Infinity
    if (ra !== rb) return ra - rb
    return a.name.localeCompare(b.name)
  })
}

let qReorder = null
function startQueueReorder(e, name, rowEl, listEl) {
  e.preventDefault(); e.stopPropagation()
  state.reordering = true
  document.body.classList.add('dragging')
  rowEl.classList.add('q-dragging')
  const ghost = document.createElement('div')
  ghost.className = 'drag-ghost'
  ghost.innerHTML = GRIP + '<span>' + escapeHtml(name) + '</span>'
  document.body.appendChild(ghost)
  qReorder = { name, rowEl, listEl, ghost }
  positionQGhost(e)
  document.addEventListener('mousemove', onQueueReorderMove)
  document.addEventListener('mouseup', onQueueReorderUp)
}
function positionQGhost(e) {
  qReorder.ghost.style.left = (e.clientX + 12) + 'px'
  qReorder.ghost.style.top = (e.clientY + 14) + 'px'
}
function onQueueReorderMove(e) {
  if (!qReorder) return
  positionQGhost(e)
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const row = el && el.closest ? el.closest('.q-row') : null
  if (!row || row === qReorder.rowEl || !qReorder.listEl.contains(row)) return
  const r = row.getBoundingClientRect()
  const before = (e.clientY - r.top) < r.height / 2
  const ref = before ? row : row.nextSibling
  if (ref === qReorder.rowEl) return
  flipMove(qReorder.listEl, qReorder.rowEl, ref)
}
// FLIP: smoothly slide the other rows to their new slots
function flipMove(list, dragged, ref) {
  const rows = Array.from(list.querySelectorAll('.q-row'))
  const first = new Map(rows.map((r) => [r, r.getBoundingClientRect().top]))
  list.insertBefore(dragged, ref)
  rows.forEach((r) => {
    if (r === dragged) return
    const dy = first.get(r) - r.getBoundingClientRect().top
    if (!dy) return
    r.style.transition = 'none'
    r.style.transform = 'translateY(' + dy + 'px)'
    requestAnimationFrame(() => { r.style.transition = 'transform .16s ease'; r.style.transform = '' })
  })
}
function onQueueReorderUp() {
  document.removeEventListener('mousemove', onQueueReorderMove)
  document.removeEventListener('mouseup', onQueueReorderUp)
  document.body.classList.remove('dragging')
  const d = qReorder
  qReorder = null
  state.reordering = false
  if (d) {
    if (d.ghost.parentNode) d.ghost.remove()
    d.rowEl.classList.remove('q-dragging')
    const names = Array.from(d.listEl.querySelectorAll('.q-row')).map((r) => r.dataset.name)
    state.queueOrder = names
    localStorage.setItem('ls.queueOrder', JSON.stringify(names))
    d.listEl.querySelectorAll('.q-row').forEach((r) => { r.style.transition = ''; r.style.transform = '' })
  }
  leafMap.forEach((entry) => { if (entry.view === 'sqs') entry.hs.q = '' })
  updateTree()
}

async function actPurge(queueUrl, name, conn) {
  const ok = await confirmDialog({ title: 'Purge queue', message: 'Permanently delete ALL messages in “' + name + '”?\nThis cannot be undone.', okLabel: 'Purge' })
  if (!ok) return
  try { await postJson('/api/queue/purge', { conn, queueUrl }); notify('Purged ' + name, 'ok') } catch (e) { notify('Purge failed: ' + e.message, 'error') }
  requestRefresh()
}
async function actRedrive(queueUrl, name, conn) {
  const ok = await confirmDialog({ title: 'Redrive DLQ', message: 'Move all messages in “' + name + '” back to its source queue?', okLabel: 'Redrive', danger: false })
  if (!ok) return
  try { const d = await postJson('/api/queue/redrive', { conn, queueUrl }); notify('Redrove ' + (d && d.moved != null ? d.moved : '') + ' message(s)', 'ok') } catch (e) { notify('Redrive failed: ' + e.message, 'error') }
  requestRefresh()
}

export const sqsView = {
  title: 'SQS Queues',
  icon: ICONS.sqs,
  body: function () {
    return '<div class="sqs-root" style="flex:1;min-height:0;display:flex;overflow:hidden">' +
      '<div class="sqs-list scroll" style="flex:1;min-width:0;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:6px"></div>' +
      '<div class="sqs-side side-pane">' +
        '<div class="side-pane-inner">' +
          '<div class="sqs-side-head" style="flex-shrink:0"></div>' +
          '<div class="sqs-messages scroll" style="flex:1;min-height:0;overflow:auto"></div>' +
        '</div>' +
      '</div>' +
    '</div>'
  },
  update: function (bodyEl, hs, vs, id) {
    if (state.reordering) return
    const listEl = bodyEl.querySelector('.sqs-list')
    const side = bodyEl.querySelector('.sqs-side')
    const all = sortQueues(lastGood.queues)
    const ff = vs.connFilter || []
    const ordered = ff.length ? all.filter((q) => ff.includes(qConn(q))) : all
    const showConn = awsConns().length > 1 && ff.length !== 1

    // list hash uses only what the rows display (NOT peeked messages, which churn
    // every poll) so the list re-renders only on a real change, never flickers
    const listSig = ordered.map((q) => q.url + '|' + q.kind + '|' + q.attrs.visible + ',' + q.attrs.inFlight + ',' + q.attrs.delayed + '|' + (q._conn ? q._conn.id : '')).join('~')
    const lh = listSig + '|' + vs.queue + '|' + showConn
    if (hs.q !== lh) {
      hs.q = lh
      if (!ordered.length) {
        const msg = awsConns().length ? 'no queues' : 'add an AWS connection in Settings to see queues'
        listEl.innerHTML = '<div class="italic" style="padding:14px;color:#64748b;font-size:14px">' + msg + '</div>'
      } else {
        listEl.innerHTML = ordered.map((q) => queueRowHtml(q, vs, showConn)).join('')
        listEl.querySelectorAll('.q-row').forEach((rowEl) => {
          const url = rowEl.dataset.url, name = rowEl.dataset.name
          rowEl.querySelector('.q-open').addEventListener('click', () => { vs.queue = url; updateLeaf(id) })
          const grip = rowEl.querySelector('.q-grip')
          grip.addEventListener('mousedown', (e) => startQueueReorder(e, name, rowEl, listEl))
          grip.addEventListener('click', (e) => e.stopPropagation())
        })
      }
    }

    // side pane (sliding)
    const q = vs.queue ? all.find((x) => x.url === vs.queue) : null
    if (q) {
      side.classList.add('open')
      const dh = hash(q)
      if (hs.d !== dh) {
        hs.d = dh
        const head = side.querySelector('.sqs-side-head')
        head.innerHTML = sideHeadHtml(q)
        side.querySelector('.sqs-messages').innerHTML = detailMessagesHtml(q)
        head.querySelector('.pane-chev').addEventListener('click', () => { vs.queue = ''; updateLeaf(id) })
        const pu = head.querySelector('.qa-purge'); if (pu) pu.addEventListener('click', () => actPurge(pu.dataset.url, pu.dataset.name, pu.dataset.conn))
        const rd = head.querySelector('.qa-redrive'); if (rd) rd.addEventListener('click', () => actRedrive(rd.dataset.url, rd.dataset.name, rd.dataset.conn))
      }
    } else {
      side.classList.remove('open')
      hs.d = ''
      if (vs.queue) { vs.queue = ''; hs.q = '' }
    }
  },
}
