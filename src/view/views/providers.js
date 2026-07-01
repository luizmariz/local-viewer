// Kafka / Postgres-PGMQ views (one factory parameterised by kind). Aggregates
// topics/queues across every connection of the kind (or the filtered subset)
// and peeks messages in a sliding side pane.
import { getConns, connName } from '../core/state.js'
import { escapeHtml, hash } from '../core/util.js'
import { updateLeaf, CHEVRON } from '../core/render.js'
import { ICONS, connBadge, loadingRow, copyBtn } from './shared.js'

// one right-aligned figure + label
function miniStat(value, label, color) {
  return '<div style="text-align:center;min-width:42px"><div style="font-size:14px;font-weight:600;color:' + color + ';line-height:1.1">' + escapeHtml(String(value)) + '</div><div style="font-size:10px;color:#64748b">' + label + '</div></div>'
}
function fmtAgeSec(s) {
  if (s == null) return '—'
  if (s < 60) return s + 's'
  if (s < 3600) return Math.floor(s / 60) + 'm'
  if (s < 86400) return Math.floor(s / 3600) + 'h'
  return Math.floor(s / 86400) + 'd'
}
// title row + a muted subtitle (origin connection · category) + workload stats
function providerRowHtml(it, vs, cfg, showConn) {
  const sel = it.name === vs.selected && (it._conn && it._conn.id) === vs.selectedConn
  const conn = showConn && it._conn ? '<span style="color:#64748b">' + escapeHtml(it._conn.name) + '</span>' : ''
  const sub = cfg.sub ? cfg.sub(it) : ''
  const subLine = (conn || sub)
    ? '<div style="font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px">' + conn + (conn && sub ? ' · ' : '') + sub + '</div>'
    : ''
  return '<div class="q-row cx-row' + (sel ? ' q-sel' : '') + '" data-name="' + escapeHtml(it.name) + '" data-conn="' + escapeHtml((it._conn && it._conn.id) || '') + '">'
    + '<div class="q-open" style="flex:1;min-width:0;display:flex;align-items:center;gap:10px;cursor:pointer;padding:7px 10px">'
    + '<div style="flex:1;min-width:0"><div class="mono" title="' + escapeHtml(it.name) + '" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:#c2cbd8">' + escapeHtml(it.name) + '</div>' + subLine + '</div>'
    + '<span style="display:flex;gap:12px;flex-shrink:0">' + cfg.stats(it) + '</span>'
    + '</div></div>'
}
function providerMsgsHtml(msgs) {
  if (!msgs || !msgs.length) return '<div class="italic" style="padding:14px;color:#64748b;font-size:13px">no messages</div>'
  return msgs.map((m) => {
    const body = (typeof m.body === 'object') ? JSON.stringify(m.body, null, 2) : String(m.body)
    const meta = (m.offset != null) ? ('offset ' + m.offset + (m.partition != null ? ' · p' + m.partition : '')) : ('msg ' + (m.msgId != null ? m.msgId : ''))
    const ts = m.time || m.enqueuedAt || ''
    return '<div class="copy-host" style="border-bottom:1px solid rgb(30 41 59);padding:8px 12px">' + copyBtn()
      + '<div class="mono" style="font-size:11px;color:#64748b">' + escapeHtml(meta) + (ts ? ' · ' + escapeHtml(ts) : '') + '</div>'
      + '<pre class="mono" style="margin-top:4px;font-size:13px;color:#d6dde8;white-space:pre-wrap;word-break:break-all">' + escapeHtml(body) + '</pre></div>'
  }).join('')
}
async function providerLoadMsgs(cfg, vs, id, name, conn) {
  vs.selected = name; vs.selectedConn = conn; vs.messages = []; vs.msgsLoading = true; updateLeaf(id)
  try { const d = await (await fetch(cfg.msgUrl + '?conn=' + encodeURIComponent(conn) + '&' + cfg.msgParam + '=' + encodeURIComponent(name))).json(); vs.messages = d.messages || [] }
  catch (e) {}
  vs.msgsLoading = false; updateLeaf(id)
}
// live tail: re-peek the open topic/queue quietly (no loading flash), replacing
// only if the selection hasn't changed mid-flight. Driven by the regular poll.
function providerTailMsgs(cfg, vs, id) {
  const name = vs.selected, conn = vs.selectedConn
  fetch(cfg.msgUrl + '?conn=' + encodeURIComponent(conn) + '&' + cfg.msgParam + '=' + encodeURIComponent(name))
    .then((r) => r.json())
    .then((d) => { if (vs.selected === name && vs.selectedConn === conn) { vs.messages = d.messages || []; updateLeaf(id) } })
    .catch(() => { /* transient — keep last good messages */ })
}

/** Build the Kafka or PGMQ view object. */
export function providerView(kind) {
  const cfg = kind === 'kafka'
    ? {
      title: 'Kafka', listUrl: '/api/kafka/topics', listKey: 'topics', label: 'topics',
      msgUrl: '/api/kafka/messages', msgParam: 'topic',
      sub: () => 'topic',
      stats: (it) => miniStat(it.partitions, 'parts', '#a78bfa') + miniStat(it.messages, 'msgs', it.messages > 0 ? '#6ee7b7' : '#475569'),
      sig: (it) => it.partitions + '|' + it.messages,
    }
    : {
      title: 'PGMQ', listUrl: '/api/pgmq/queues', listKey: 'queues', label: 'queues',
      msgUrl: '/api/pgmq/messages', msgParam: 'queue',
      sub: (it) => it.partitioned ? 'partitioned queue' : 'queue',
      stats: (it) => miniStat(it.length, 'queued', it.length > 0 ? '#6ee7b7' : '#475569') + miniStat(it.total, 'total', '#7dd3fc') + miniStat(fmtAgeSec(it.oldestSec), 'oldest', it.oldestSec != null ? '#fcd34d' : '#475569'),
      sig: (it) => it.length + '|' + it.total + '|' + it.oldestSec,
    }
  return {
    title: cfg.title,
    icon: ICONS[kind],
    body() {
      return '<div class="cx-root" style="flex:1;min-height:0;display:flex;overflow:hidden">'
        + '<div class="cx-list scroll" style="flex:1;min-width:0;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:6px"></div>'
        + '<div class="cx-side side-pane"><div class="side-pane-inner">'
        + '<div class="cx-side-head" style="flex-shrink:0"></div>'
        + '<div class="cx-msgs scroll" style="flex:1;min-height:0;overflow:auto"></div>'
        + '</div></div></div>'
    },
    // aggregate across all connections of this kind (or the filtered one)
    refresh(vs, id) {
      // while a topic/queue is open, keep its messages tailing on every poll
      if (vs.selected) providerTailMsgs(cfg, vs, id)
      const ff = vs.connFilter || []
      const targets = ff.length ? getConns(kind).filter((c) => ff.includes(c.id)) : getConns(kind)
      if (!targets.length) { vs.items = []; vs.err = null; updateLeaf(id); return }
      vs.loading = true
      Promise.all(targets.map((c) =>
        fetch(cfg.listUrl + '?conn=' + encodeURIComponent(c.id)).then((r) => r.json())
          .then((d) => ({ c, items: d[cfg.listKey] || [], err: d.error }))
          .catch((e) => ({ c, items: [], err: String(e) }))
      )).then((results) => {
        const items = []; let err = null
        results.forEach(({ c, items: its, err: e }) => { if (e) err = e; its.forEach((it) => { it._conn = { id: c.id, name: c.name }; items.push(it) }) })
        items.sort((a, b) => ((a._conn ? a._conn.name : '') + a.name).localeCompare((b._conn ? b._conn.name : '') + b.name))
        vs.items = items; vs.err = items.length ? null : err; vs.loading = false; updateLeaf(id)
      })
    },
    update(bodyEl, hs, vs, id) {
      const conns = getConns(kind)
      const ff = vs.connFilter || []
      const showConn = conns.length > 1 && ff.length !== 1
      const list = bodyEl.querySelector('.cx-list')
      // hash only what rows display — NOT volatile fields like pgmq message age,
      // which tick up every second and would re-render (flicker) the list each poll
      const itemSig = (vs.items || []).map((it) => it.name + '|' + cfg.sig(it) + '|' + (it._conn ? it._conn.id : '')).join('~')
      const lh = hash([itemSig, vs.selected, vs.selectedConn, vs.err, ff.join(','), showConn, vs.loading])
      if (hs.l !== lh) {
        hs.l = lh
        if (!conns.length) list.innerHTML = '<div class="italic" style="padding:12px;color:#64748b;font-size:13px">add a ' + cfg.title + ' connection in Settings</div>'
        else if (vs.loading && !vs.items.length) list.innerHTML = loadingRow('Loading ' + cfg.label + '…')
        else if (vs.err && !vs.items.length) list.innerHTML = '<div class="italic" style="padding:12px;color:#fca5a5;font-size:13px">' + escapeHtml(vs.err) + '</div>'
        else if (!vs.items.length) list.innerHTML = '<div class="italic" style="padding:12px;color:#64748b;font-size:13px">no ' + cfg.label + '</div>'
        else list.innerHTML = vs.items.map((it) => providerRowHtml(it, vs, cfg, showConn)).join('')
        list.querySelectorAll('.cx-row').forEach((row) => row.querySelector('.q-open').addEventListener('click', () => providerLoadMsgs(cfg, vs, id, row.dataset.name, row.dataset.conn)))
      }
      const side = bodyEl.querySelector('.cx-side')
      if (vs.selected) {
        side.classList.add('open')
        const sh = hash([vs.selected, vs.selectedConn, vs.messages, vs.msgsLoading])
        if (hs.s !== sh) {
          hs.s = sh
          bodyEl.querySelector('.cx-side-head').innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid rgb(30 41 59)">'
            + '<lv-button class="pane-chev" variant="chev" title="close">' + CHEVRON + '</lv-button>'
            + '<span class="mono" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:14px;color:#c2cbd8">' + escapeHtml(vs.selected) + '</span>'
            + (showConn && vs.selectedConn ? connBadge({ name: connName(vs.selectedConn) }) : '') + '</div>'
          bodyEl.querySelector('.cx-msgs').innerHTML = vs.msgsLoading ? loadingRow('Loading messages…') : providerMsgsHtml(vs.messages)
          bodyEl.querySelector('.pane-chev').addEventListener('click', () => { vs.selected = null; updateLeaf(id) })
        }
      } else { side.classList.remove('open'); hs.s = '__closed' }
    },
  }
}
