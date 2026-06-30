// Docker view: lean Portainer essentials — containers (with live cpu/mem +
// multi-select bulk actions), images and volumes (with "used by"), per-container
// logs, and start-all. Tabs switch between containers/images/volumes.
import { escapeHtml, fmtBytes, hash } from '../core/util.js'
import { confirmDialog, notify } from '../components/index.js'
import { updateLeaf, CHEVRON, TRASH } from '../core/render.js'
import { ICONS, loadingRow } from './shared.js'
import { formatLogs, openLogsModal } from '../features/logs.js'

// ---- docker view ----
// selection key per tab: containers/images by id, volumes by name. dkItems/dkKeys
// give the current tab's data + keys so bulk select works across all three tabs.
function dkKey(tab, item) { return tab === 'volumes' ? item.name : item.id }
function dkItems(vs) { const t = vs.tab || 'containers'; return t === 'containers' ? (vs.containers || []) : t === 'images' ? (vs.images || []) : (vs.volumes || []) }
const dkEsc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : v)

function dockerStateColor(s) { return s === 'running' ? '#6ee7b7' : (s === 'paused' ? '#fcd34d' : (s === 'created' ? '#7dd3fc' : '#94a3b8')) }
function dkCheckbox(checked) { return '<label class="dk-selwrap" title="select" style="display:flex;align-items:center;padding:0 4px 0 8px;cursor:pointer"><input type="checkbox" class="dk-sel"' + (checked ? ' checked' : '') + ' /></label>' }
// compact row-action button (lv-button icon + sm). dk-act/dk-rm classes keep the hover tints.
function dkAct(extra, attrs, glyph) { return '<lv-button class="dk-act' + (extra ? ' ' + extra : '') + '" variant="icon" size="sm" ' + attrs + '>' + glyph + '</lv-button>' }
function dkMiniStat(label, value, color) {
  return '<div style="text-align:right;min-width:52px"><div style="font-size:12px;font-weight:600;color:' + color + ';line-height:1.1">' + value + '</div><div style="font-size:9px;color:#64748b">' + label + '</div></div>'
}
function dockerRowHtml(c, vs) {
  const sel = c.id === vs.selected
  const running = c.state === 'running'
  let acts = ''
  if (running) {
    acts += dkAct('', 'data-act="restart" title="restart container"', '&#x21bb;')
    acts += dkAct('', 'data-act="stop" title="stop container"', '&#x25a0;')
  } else {
    acts += dkAct('', 'data-act="start" title="start container" style="color:#6ee7b7"', '&#x25b6;')
  }
  acts += dkAct('dk-rm', 'data-act="remove" title="remove container"', TRASH)
  const ports = (c.ports && c.ports.length) ? ' · ' + escapeHtml(c.ports.join(', ')) : ''
  const checked = vs.selectedIds && vs.selectedIds.has(c.id)
  // on/off is conveyed by the NAME: running = bright + green dot glyph; stopped = dimmed + struck through
  const nameColor = running ? '#c2cbd8' : '#64748b'
  const nameDecoration = running ? '' : ';text-decoration:line-through;text-decoration-color:#475569'
  const stateGlyph = '<span style="color:' + dockerStateColor(c.state) + ';flex-shrink:0">●</span> '
  const stateMeta = running ? '' : '<span style="color:' + dockerStateColor(c.state) + '">' + escapeHtml(c.state) + '</span> · '
  return '<div class="q-row dk-row' + (sel ? ' q-sel' : '') + (checked ? ' dk-checked' : '') + '" data-key="' + escapeHtml(c.id) + '" data-id="' + escapeHtml(c.id) + '" data-name="' + escapeHtml(c.name) + '">'
    + dkCheckbox(checked)
    + '<div class="q-open dk-open" style="flex:1;min-width:0;display:flex;align-items:center;gap:10px;cursor:pointer;padding:7px 10px 7px 2px">'
    + '<div style="flex:2 1 0;min-width:0"><div class="mono" style="font-size:14px;color:' + nameColor + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px" title="' + escapeHtml(c.name) + ' — ' + escapeHtml(c.status || c.state) + '">' + stateGlyph + '<span style="overflow:hidden;text-overflow:ellipsis' + nameDecoration + '">' + escapeHtml(c.name) + '</span></div>'
    + '<div style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + stateMeta + escapeHtml(c.image) + ports + '</div></div>'
    + '<span class="dk-stats" data-id="' + escapeHtml(c.id) + '" style="display:flex;gap:8px;flex-shrink:0">' + dockerStatsHtml(c) + '</span>'
    + '<div style="flex:1 1 0;min-width:8px"></div>' // push the actions to the far right; stats sit toward centre
    + '<span style="display:flex;gap:5px;flex-shrink:0">' + acts + '</span>'
    + '</div></div>'
}
function cpuColorOf(cpu) { return cpu > 80 ? '#fca5a5' : cpu > 40 ? '#fcd34d' : '#6ee7b7' }
function cpuPct(cpu) { return cpu.toFixed(cpu < 10 ? 1 : 0) + '%' }
function memColorOf(pct) { return pct > 85 ? '#fca5a5' : pct > 60 ? '#fcd34d' : '#7dd3fc' }
function memPctOf(c) { return c.memLimit > 0 ? Math.max(0, Math.min(100, (c.memUsage / c.memLimit) * 100)) : 0 }
const clamp100 = (n) => Math.max(0, Math.min(100, n))
// one figure + label + a workload bar (cpu / mem). The fill width + values are
// patched IN PLACE each poll (dockerStatsPatch) so the bars animate via CSS.
function barStat(key, valText, pct, color) {
  return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-width:58px">'
    + '<div style="display:flex;gap:4px;align-items:baseline"><span class="dk-' + key + '-val" style="font-size:12.5px;font-weight:600;line-height:1;color:' + color + '">' + valText + '</span><span style="font-size:9px;color:#64748b">' + key + '</span></div>'
    + '<div style="width:54px;height:4px;border-radius:2px;background:rgb(30 41 59);overflow:hidden"><div class="dk-' + key + 'bar-fill" style="height:100%;width:' + pct + '%;background:' + color + ';transition:width .6s ease,background .6s ease"></div></div>'
    + '</div>'
}
function dockerStatsHtml(c) {
  if (c.state !== 'running' || c.cpu == null || c.cpu < 0) return ''
  const mp = memPctOf(c)
  let s = barStat('cpu', cpuPct(c.cpu), clamp100(c.cpu), cpuColorOf(c.cpu))
  if (c.memUsage) s += barStat('mem', fmtBytes(c.memUsage), mp, memColorOf(mp))
  return s
}
// patch the cpu/mem cells without recreating them, so the bars can transition
function dockerStatsPatch(cell, c) {
  const cpuFill = cell.querySelector('.dk-cpubar-fill')
  if (!cpuFill || c.state !== 'running' || c.cpu == null || c.cpu < 0) {
    const next = dockerStatsHtml(c); if (cell.innerHTML !== next) cell.innerHTML = next
    return
  }
  const cc = cpuColorOf(c.cpu)
  cpuFill.style.width = clamp100(c.cpu) + '%'; cpuFill.style.background = cc
  const cv = cell.querySelector('.dk-cpu-val'); if (cv) { cv.textContent = cpuPct(c.cpu); cv.style.color = cc }
  const mp = memPctOf(c), mc = memColorOf(mp)
  const memFill = cell.querySelector('.dk-membar-fill'); if (memFill) { memFill.style.width = mp + '%'; memFill.style.background = mc }
  const mv = cell.querySelector('.dk-mem-val'); if (mv && c.memUsage) { mv.textContent = fmtBytes(c.memUsage); mv.style.color = mc }
}
function usedByHtml(usedBy) {
  if (!usedBy || !usedBy.length) return '<span style="color:#475569">unused</span>'
  const shown = usedBy.slice(0, 2).join(', ') + (usedBy.length > 2 ? ' +' + (usedBy.length - 2) : '')
  return '<span>used by ' + escapeHtml(shown) + '</span>'
}
function dockerImageRowHtml(im, vs) {
  const tag = (im.tags && im.tags.length && im.tags[0] !== '<none>:<none>') ? im.tags.join(', ') : '<untagged>'
  const checked = vs.selectedIds && vs.selectedIds.has(im.id)
  return '<div class="q-row dk-row' + (checked ? ' dk-checked' : '') + '" data-key="' + escapeHtml(im.id) + '" data-id="' + escapeHtml(im.id) + '">'
    + dkCheckbox(checked)
    + '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:10px;padding:7px 10px 7px 2px">'
    + '<div style="flex:1;min-width:0"><div class="mono" style="font-size:13px;color:#c2cbd8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</div>'
    + '<div style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + fmtBytes(im.size) + ' · ' + usedByHtml(im.usedBy) + '</div></div>'
    + dkAct('dk-img-rm dk-rm', 'title="remove image"', TRASH) + '</div></div>'
}
function dockerVolumeRowHtml(v, vs) {
  const checked = vs.selectedIds && vs.selectedIds.has(v.name)
  return '<div class="q-row dk-row' + (checked ? ' dk-checked' : '') + '" data-key="' + escapeHtml(v.name) + '" data-name="' + escapeHtml(v.name) + '">'
    + dkCheckbox(checked)
    + '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:10px;padding:7px 10px 7px 2px">'
    + '<div style="flex:1;min-width:0"><div class="mono" style="font-size:13px;color:#c2cbd8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escapeHtml(v.name) + '">' + escapeHtml(v.name) + '</div>'
    + '<div style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(v.driver || 'local') + ' · ' + usedByHtml(v.usedBy) + '</div></div>'
    + dkAct('dk-vol-rm dk-rm', 'title="remove volume"', TRASH) + '</div></div>'
}
async function dockerAction(vs, id, btn, cid, act) {
  if (act === 'remove') { const ok = await confirmDialog({ title: 'Remove container', message: 'Remove this container?', okLabel: 'Remove' }); if (!ok) return }
  btn.disabled = true; btn.textContent = '…'
  try {
    if (act === 'remove') await fetch('/api/docker/containers/' + cid, { method: 'DELETE' })
    else await fetch('/api/docker/containers/' + cid + '/' + act, { method: 'POST' })
  } catch (e) { notify('Docker ' + act + ' failed', 'error') }
  dockerRefresh(vs, id)
}
async function dockerBulk(vs, id, action) {
  const tab = vs.tab || 'containers'
  const keys = Array.from(vs.selectedIds || [])
  if (!keys.length) return
  const noun = tab === 'images' ? 'image' : tab === 'volumes' ? 'volume' : 'container'
  if (action === 'remove') {
    const ok = await confirmDialog({ title: 'Remove ' + noun + 's', message: 'Remove ' + keys.length + ' selected ' + noun + (keys.length > 1 ? 's' : '') + '?', okLabel: 'Remove' })
    if (!ok) return
  }
  let okCount = 0
  for (const k of keys) {
    try {
      let res
      if (tab === 'images') res = await fetch('/api/docker/images/' + encodeURIComponent(k), { method: 'DELETE' })
      else if (tab === 'volumes') res = await fetch('/api/docker/volumes/' + encodeURIComponent(k), { method: 'DELETE' })
      else if (action === 'remove') res = await fetch('/api/docker/containers/' + k, { method: 'DELETE' })
      else res = await fetch('/api/docker/containers/' + k + '/' + action, { method: 'POST' })
      if (res.ok) okCount++
    } catch (e) {}
  }
  notify(action + ': ' + okCount + '/' + keys.length + ' ' + noun + (keys.length > 1 ? 's' : ''), okCount ? 'ok' : 'error')
  vs.selectedIds.clear()
  dockerRefresh(vs, id)
}
function updateBulkBar(bodyEl, vs) {
  const bar = bodyEl.querySelector('.dk-bulk')
  if (!bar) return
  // drop selections for items no longer present in the current tab
  const present = new Set(dkItems(vs).map((x) => dkKey(vs.tab, x)))
  vs.selectedIds.forEach((k) => { if (!present.has(k)) vs.selectedIds.delete(k) })
  const n = vs.selectedIds.size
  if (n === 0) { bar.style.display = 'none'; return }
  bar.style.display = 'flex'
  bar.querySelector('.dk-bulk-count').textContent = n + ' selected'
  // restart/stop only apply to containers; delete + clear apply to every tab
  const containers = vs.tab === 'containers'
  bar.querySelector('.dk-bulk-start').style.display = containers ? '' : 'none'
  bar.querySelector('.dk-bulk-restart').style.display = containers ? '' : 'none'
  bar.querySelector('.dk-bulk-stop').style.display = containers ? '' : 'none'
  const all = present.size
  const selall = bar.querySelector('.dk-selall')
  selall.checked = n > 0 && n === all
  selall.indeterminate = n > 0 && n < all
}
async function dockerLogs(vs, id, cid, name) {
  vs.selected = cid; vs.selectedName = name; vs.dkPane = 'logs'; vs.env = null; vs.logs = 'loading…'; updateLeaf(id)
  try { const d = await (await fetch('/api/docker/containers/' + cid + '/logs?tail=300')).json(); vs.logs = d.logs != null ? d.logs : (d.error || '(empty)') }
  catch (e) { vs.logs = 'error: ' + e.message }
  updateLeaf(id)
}
async function dockerEnv(vs, id, cid) {
  vs.envLoading = true; vs.env = null; updateLeaf(id)
  try { const d = await (await fetch('/api/docker/containers/' + cid + '/inspect')).json(); vs.env = Array.isArray(d.env) ? d.env : [] }
  catch (e) { vs.env = [] }
  vs.envLoading = false; updateLeaf(id)
}
function dockerEnvHtml(env, loading) {
  if (loading) return loadingRow('Loading environment…')
  if (!env || !env.length) return '<div class="italic" style="padding:14px;color:#64748b;font-size:13px">no environment variables</div>'
  return env.map((kv) => {
    const i = kv.indexOf('=')
    const k = i < 0 ? kv : kv.slice(0, i)
    const v = i < 0 ? '' : kv.slice(i + 1)
    return '<div style="padding:5px 12px;border-bottom:1px solid rgb(30 41 59);font-size:12px;word-break:break-all">'
      + '<span style="color:#a5b4fc">' + escapeHtml(k) + '</span><span style="color:#475569">=</span><span style="color:#c2cbd8">' + escapeHtml(v) + '</span></div>'
  }).join('')
}
function dockerRefresh(vs, id) {
  const tab = vs.tab || 'containers'
  const done = (t) => { vs.loaded[t] = true; updateLeaf(id) } // first fetch of a tab marks it loaded
  if (tab === 'containers') {
    fetch('/api/docker/containers').then(r => r.json()).then(d => { const cs = Array.isArray(d.containers) ? d.containers : []; cs.sort((a, b) => a.name.localeCompare(b.name)); vs.containers = cs; vs.err = d.error || null; done('containers') }).catch(e => { vs.err = String(e); done('containers') })
  } else if (tab === 'images') {
    fetch('/api/docker/images').then(r => r.json()).then(d => { const im = Array.isArray(d.images) ? d.images : []; im.sort((a, b) => ((a.tags && a.tags[0]) || a.id).localeCompare((b.tags && b.tags[0]) || b.id)); vs.images = im; vs.err = d.error || null; done('images') }).catch(e => { vs.err = String(e); done('images') })
  } else {
    fetch('/api/docker/volumes').then(r => r.json()).then(d => { const vols = Array.isArray(d.volumes) ? d.volumes : []; vols.sort((a, b) => a.name.localeCompare(b.name)); vs.volumes = vols; vs.err = d.error || null; done('volumes') }).catch(e => { vs.err = String(e); done('volumes') })
  }
}
function dockerView() {
  return {
    title: 'Docker',
    icon: ICONS.docker,
    body() {
      return '<div class="dk-root" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden">'
        + '<div class="dk-tabs">'
        + '<lv-button class="dk-tab" variant="tab" data-tab="containers" data-i18n="dk.containers">Containers</lv-button>'
        + '<lv-button class="dk-tab" variant="tab" data-tab="images" data-i18n="dk.images">Images</lv-button>'
        + '<lv-button class="dk-tab" variant="tab" data-tab="volumes" data-i18n="dk.volumes">Volumes</lv-button>'
        + '</div>'
        + '<div class="dk-bulk" style="display:none;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid rgb(30 41 59);background:rgba(99,102,241,.08);flex-shrink:0">'
        + '<input type="checkbox" class="dk-selall" title="select all" />'
        + '<span class="dk-bulk-count" style="font-size:12px;color:#c7d2fe"></span>'
        + '<div style="flex:1"></div>'
        + '<lv-button class="dk-bulk-start" variant="hdr" size="sm">Start</lv-button>'
        + '<lv-button class="dk-bulk-restart" variant="hdr" size="sm">Restart</lv-button>'
        + '<lv-button class="dk-bulk-stop" variant="hdr" size="sm">Stop</lv-button>'
        + '<lv-button class="dk-bulk-delete" variant="danger" size="sm">Delete</lv-button>'
        + '</div>'
        + '<div class="dk-body" style="flex:1;min-height:0;display:flex;overflow:hidden">'
        + '<div class="dk-list scroll" style="flex:1;min-width:0;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:6px"></div>'
        + '<div class="dk-side side-pane"><div class="side-pane-inner">'
        + '<div class="dk-side-head" style="flex-shrink:0"></div>'
        + '<pre class="dk-logs clog scroll mono" style="flex:1;min-height:0;overflow:auto;padding:8px 10px;color:#c2cbd8"></pre>'
        + '<div class="dk-env scroll mono" style="display:none;flex:1;min-height:0;overflow:auto"></div>'
        + '</div></div></div></div>'
    },
    mount(bodyEl, vs, id) {
      vs.tab = vs.tab || 'containers'
      bodyEl.querySelectorAll('.dk-tab').forEach(b => b.addEventListener('click', () => {
        vs.tab = b.dataset.tab; vs.selected = null; vs.err = null; vs.selectedIds.clear() // selection keys differ per tab
        updateLeaf(id); dockerRefresh(vs, id) // update() shows a spinner for a not-yet-loaded tab
      }))
      bodyEl.querySelector('.dk-bulk-start').addEventListener('click', () => dockerBulk(vs, id, 'start'))
      // bulk bar (static elements) — wire once
      bodyEl.querySelector('.dk-bulk-restart').addEventListener('click', () => dockerBulk(vs, id, 'restart'))
      bodyEl.querySelector('.dk-bulk-stop').addEventListener('click', () => dockerBulk(vs, id, 'stop'))
      bodyEl.querySelector('.dk-bulk-delete').addEventListener('click', () => dockerBulk(vs, id, 'remove'))
      bodyEl.querySelector('.dk-selall').addEventListener('change', (e) => {
        vs.selectedIds.clear()
        if (e.target.checked) dkItems(vs).forEach((x) => vs.selectedIds.add(dkKey(vs.tab, x)))
        updateLeaf(id)
      })
    },
    refresh(vs, id) { dockerRefresh(vs, id) },
    update(bodyEl, hs, vs, id) {
      const tab = vs.tab || 'containers'
      bodyEl.querySelectorAll('.dk-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab))
      const list = bodyEl.querySelector('.dk-list')
      const data = tab === 'containers' ? vs.containers : tab === 'images' ? vs.images : vs.volumes
      // structural hash excludes volatile cpu/mem (patched in place below) so the
      // container list re-renders only when containers come/go or change state
      const struct = tab === 'containers'
        ? (vs.containers || []).map(c => c.id + c.state + (c.ports || []).join(',')).join('~')
        : hash(data)
      const loaded = !!vs.loaded[tab]
      const h = hash([tab, struct, vs.selected, vs.err, loaded])
      if (hs.l !== h) {
        hs.l = h
        if (vs.err) list.innerHTML = '<div class="italic" style="padding:14px;color:#fca5a5;font-size:13px">docker: ' + escapeHtml(vs.err) + '</div>'
        else if (!loaded) list.innerHTML = loadingRow('Loading ' + tab + '…')
        else if (!data || !data.length) list.innerHTML = '<div class="italic" style="padding:14px;color:#64748b;font-size:13px">no ' + tab + '</div>'
        else if (tab === 'containers') list.innerHTML = data.map(c => dockerRowHtml(c, vs)).join('')
        else if (tab === 'images') list.innerHTML = data.map((im) => dockerImageRowHtml(im, vs)).join('')
        else list.innerHTML = data.map((v) => dockerVolumeRowHtml(v, vs)).join('')

        // selection checkbox is on every tab's rows, keyed by data-key
        list.querySelectorAll('.dk-row').forEach(row => {
          const key = row.dataset.key
          const cb = row.querySelector('.dk-sel')
          if (cb) cb.addEventListener('change', (e) => {
            if (e.target.checked) vs.selectedIds.add(key); else vs.selectedIds.delete(key)
            row.classList.toggle('dk-checked', e.target.checked)
            updateBulkBar(bodyEl, vs)
          })
        })

        if (tab === 'containers') {
          list.querySelectorAll('.dk-row').forEach(row => {
            const cid = row.dataset.id, cname = row.dataset.name
            const open = row.querySelector('.dk-open')
            if (open) open.addEventListener('click', () => dockerLogs(vs, id, cid, cname))
            row.querySelectorAll('.dk-act').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); dockerAction(vs, id, b, cid, b.dataset.act) }))
          })
        } else if (tab === 'images') {
          list.querySelectorAll('.dk-row').forEach(row => {
            const iid = row.dataset.id
            const rm = row.querySelector('.dk-img-rm')
            if (rm) rm.addEventListener('click', async () => {
              const ok = await confirmDialog({ title: 'Remove image', message: 'Remove this image?', okLabel: 'Remove' }); if (!ok) return
              try { await fetch('/api/docker/images/' + encodeURIComponent(iid), { method: 'DELETE' }); notify('Image removed', 'ok') } catch (e) { notify('Remove failed', 'error') }
              dockerRefresh(vs, id)
            })
          })
        } else {
          list.querySelectorAll('.dk-row').forEach(row => {
            const vn = row.dataset.name
            const rm = row.querySelector('.dk-vol-rm')
            if (rm) rm.addEventListener('click', async () => {
              const ok = await confirmDialog({ title: 'Remove volume', message: 'Remove volume “' + vn + '”?', okLabel: 'Remove' }); if (!ok) return
              try { await fetch('/api/docker/volumes/' + encodeURIComponent(vn), { method: 'DELETE' }); notify('Volume removed', 'ok') } catch (e) { notify('Remove failed', 'error') }
              dockerRefresh(vs, id)
            })
          })
        }
      }
      // patch cpu/mem cells (containers) + keep checkbox/highlight in sync on every
      // tab (select-all/clear don't rebuild the list)
      if (!vs.err) {
        if (tab === 'containers') {
          (vs.containers || []).forEach((c) => {
            const cell = list.querySelector('.dk-stats[data-id="' + dkEsc(c.id) + '"]')
            if (cell) dockerStatsPatch(cell, c)
          })
        }
        list.querySelectorAll('.dk-row').forEach((row) => {
          const on = vs.selectedIds.has(row.dataset.key)
          const cb = row.querySelector('.dk-sel'); if (cb && cb.checked !== on) cb.checked = on
          row.classList.toggle('dk-checked', on)
        })
      }
      updateBulkBar(bodyEl, vs)
      const side = bodyEl.querySelector('.dk-side')
      if (vs.selected && tab === 'containers') {
        side.classList.add('open')
        const sh = hash([vs.selected, vs.selectedName, vs.logs, vs.dkPane, vs.env, vs.envLoading])
        if (hs.s !== sh) {
          hs.s = sh
          const pane = vs.dkPane || 'logs'
          bodyEl.querySelector('.dk-side-head').innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid rgb(30 41 59)">'
            + '<lv-button class="pane-chev" variant="chev" title="close">' + CHEVRON + '</lv-button>'
            + '<span class="mono" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:14px;color:#c2cbd8" title="' + escapeHtml(vs.selectedName) + '">' + escapeHtml(vs.selectedName) + '</span>'
            + '<lv-button class="dk-pane-logs" variant="tab" size="sm">Logs</lv-button>'
            + '<lv-button class="dk-pane-env" variant="tab" size="sm">Env</lv-button>'
            + '<div class="vdiv" style="margin:0 4px"></div>'
            + (pane === 'logs' ? '<lv-icon class="dk-log-clear icon-act" name="brush" size="15" title="clear log"></lv-icon>' : '')
            + '<lv-icon class="dk-log-expand icon-act" name="expand" size="15" title="open in a wide modal"></lv-icon>'
            + '</div>'
          const logsEl = bodyEl.querySelector('.dk-logs'), envEl = bodyEl.querySelector('.dk-env')
          bodyEl.querySelector('.dk-pane-logs').classList.toggle('active', pane === 'logs')
          bodyEl.querySelector('.dk-pane-env').classList.toggle('active', pane === 'env')
          logsEl.style.display = pane === 'logs' ? 'block' : 'none'
          envEl.style.display = pane === 'env' ? 'block' : 'none'
          if (pane === 'logs') logsEl.innerHTML = formatLogs(vs.logs || '')
          else envEl.innerHTML = dockerEnvHtml(vs.env, vs.envLoading)
          const exp = bodyEl.querySelector('.dk-log-expand')
          if (exp) exp.addEventListener('click', () => (vs.dkPane === 'env')
            ? openLogsModal(vs.selectedName + ' — env', (vs.env || []).join('\n'), 'env')
            : openLogsModal(vs.selectedName + ' — logs', vs.logs || ''))
          const clr = bodyEl.querySelector('.dk-log-clear'); if (clr) clr.addEventListener('click', () => { vs.logs = ''; updateLeaf(id) })
          bodyEl.querySelector('.pane-chev').addEventListener('click', () => { vs.selected = null; updateLeaf(id) })
          bodyEl.querySelector('.dk-pane-logs').addEventListener('click', () => { vs.dkPane = 'logs'; updateLeaf(id) })
          bodyEl.querySelector('.dk-pane-env').addEventListener('click', () => {
            vs.dkPane = 'env'
            if (vs.env === null && !vs.envLoading) dockerEnv(vs, id, vs.selected); else updateLeaf(id)
          })
        }
      } else { side.classList.remove('open'); hs.s = '__closed' }
    },
  }
}

export { dockerView }
