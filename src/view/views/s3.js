// S3 view: bucket list (aggregated across AWS connections) → object browser
// with search + pagination, a sliding preview pane with text/JSON edit + delete,
// file upload (button + drag-drop), and a "new text object" modal.
import { escapeHtml, fmtDateTime, fmtTimeAgo, fmtBytes, clamp, hash } from '../core/util.js'
import { lastGood, awsConns, leafMap } from '../core/state.js'
import { updateLeaf, CHEVRON, PENCIL, TRASH } from '../core/render.js'
import { iconSvg } from '../core/icons.js'
import { confirmDialog, notify } from '../components/index.js'
import { ICONS, connBadge } from './shared.js'

const S3_PAGE_SIZE = 60

function bucketListHtml(buckets, showConn) {
  if (!buckets.length) {
    const msg = awsConns().length ? 'no buckets' : 'add an AWS connection in Settings to see buckets'
    return '<div class="italic" style="padding:10px;font-size:14px;color:#64748b">' + msg + '</div>'
  }
  return buckets.map((b) =>
    '<button class="bk" data-name="' + escapeHtml(b.name) + '" data-conn="' + escapeHtml((b._conn && b._conn.id) || '') + '" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 11px;border-radius:7px;border:1px solid rgb(30 41 59)">' +
      '<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-emerald-400 flex-shrink-0"><path d="M3 4.25A1.25 1.25 0 014.25 3h11.5A1.25 1.25 0 0117 4.25v1.5A1.25 1.25 0 0115.75 7H4.25A1.25 1.25 0 013 5.75v-1.5z"/><path d="M4 8.5h12v6.25A1.25 1.25 0 0114.75 16H5.25A1.25 1.25 0 014 14.75V8.5zm3.5 1.75a.75.75 0 000 1.5h5a.75.75 0 000-1.5h-5z"/></svg>' +
      '<div style="flex:1;min-width:0">' +
        '<div class="mono" title="' + escapeHtml(b.name) + '" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:#c2cbd8">' + escapeHtml(b.name) + '</div>' +
        '<div style="font-size:12px;color:#64748b;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">created ' + fmtDateTime(b.created) + '</div>' +
      '</div>' +
      (showConn ? connBadge(b._conn) : '') +
      '<span style="color:#475569;font-size:14px;flex-shrink:0">&#x203a;</span>' +
    '</button>'
  ).join('')
}

function objectsPageHtml(vs) {
  const objects = vs.objects || []
  const filtered = vs.filter ? objects.filter((o) => o.key.toLowerCase().includes(vs.filter.toLowerCase())) : objects
  const total = filtered.length
  const pages = Math.max(1, Math.ceil(total / S3_PAGE_SIZE))
  const page = clamp(vs.s3Page, 0, pages - 1)
  vs.s3Page = page
  const start = page * S3_PAGE_SIZE
  const slice = filtered.slice(start, start + S3_PAGE_SIZE)
  let html
  if (!total) {
    html = vs.filter
      ? '<div class="italic" style="padding:10px;font-size:14px;color:#64748b">no objects match search</div>'
      : '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:36px 16px;color:#475569;text-align:center">'
        + '<span style="color:#64748b">' + iconSvg('upload', 30) + '</span>'
        + '<div style="font-size:14px;color:#94a3b8">This bucket is empty</div>'
        + '<div style="font-size:12px">Drag &amp; drop files here to upload, or use the Upload button</div>'
        + '</div>'
  } else {
    html = slice.map((o) => {
      const sel = o.key === vs.selectedKey
      return '<button class="ob" data-key="' + escapeHtml(o.key) + '" style="display:block;width:100%;text-align:left;padding:6px 9px;' + (sel ? 'background:rgb(30 41 59);border-left:2px solid #818cf8;' : 'border-left:2px solid transparent;') + '">' +
             '<div class="mono" style="font-size:14px;color:#c2cbd8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(o.key) + '</div>' +
             '<div style="font-size:12px;color:#64748b">' + fmtBytes(o.size) + ' · ' + fmtTimeAgo(o.lastModified) + '</div></button>'
    }).join('')
  }
  const info = total ? (start + 1) + '–' + (start + slice.length) + ' of ' + total + (vs.filter ? ' (filtered)' : '') : '0 keys'
  return { html, info, page, pages }
}

const S3_BODY =
  '<div class="s3-root" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden">' +
    '<div class="s3-bucketlist scroll" style="flex:1;min-height:0;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:5px"></div>' +
    '<div class="s3-contents" style="flex:1;min-height:0;display:none;overflow:hidden">' +
      '<div class="s3-main" style="flex:1;min-width:0;display:flex;flex-direction:column;padding:10px;gap:8px">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0">' +
          '<lv-button class="s3-back pane-chev" variant="chev" title="back to buckets">' + CHEVRON + '</lv-button>' +
          '<svg viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 text-emerald-400 flex-shrink-0"><path d="M3 4.25A1.25 1.25 0 014.25 3h11.5A1.25 1.25 0 0117 4.25v1.5A1.25 1.25 0 0115.75 7H4.25A1.25 1.25 0 013 5.75v-1.5z"/><path d="M4 8.5h12v6.25A1.25 1.25 0 0114.75 16H5.25A1.25 1.25 0 014 14.75V8.5zm3.5 1.75a.75.75 0 000 1.5h5a.75.75 0 000-1.5h-5z"/></svg>' +
          '<span class="s3-bucketname mono" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-size:14px;color:#c2cbd8"></span>' +
          '<lv-button class="s3-new" variant="hdr" size="sm" title="create a text object">New</lv-button>' +
          '<lv-button class="s3-upload" variant="hdr" size="sm" title="upload file(s)">Upload</lv-button>' +
          '<input class="s3-file" type="file" multiple style="display:none" />' +
        '</div>' +
        '<input class="s3-filter mono" placeholder="search keys in bucket…" style="flex-shrink:0;background:rgb(15 23 42);border:1px solid rgb(51 65 85);border-radius:6px;padding:5px 9px;font-size:14px;color:#c2cbd8;outline:none" />' +
        '<div class="s3-objects scroll" style="position:relative;flex:1;min-height:0;overflow:auto;background:rgb(15 23 42);border:1px solid rgb(30 41 59);border-radius:6px">' +
          // rows live in their own node so re-rendering them never wipes the overlays below
          '<div class="s3-objlist"></div>' +
          '<div class="s3-drop" style="display:none;position:absolute;inset:0;z-index:5;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(99,102,241,.18);border:2px dashed rgb(129 140 248);border-radius:6px;color:#c7d2fe;font-size:14px;font-weight:500;pointer-events:none">' + iconSvg('upload', 26) + 'Drop files to upload</div>' +
          '<div class="s3-busy" style="display:none;position:absolute;inset:0;z-index:6;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(2,6,23,.78);color:#c7d2fe;font-size:13px"><div class="spinner"></div><div class="s3-busy-text"></div></div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;font-size:12px;color:#475569">' + iconSvg('upload', 13) + 'Drag &amp; drop files here, or use Upload</div>' +
        '<div class="s3-pager" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-shrink:0"></div>' +
      '</div>' +
      '<div class="s3-preview side-pane">' +
        '<div class="side-pane-inner">' +
          '<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid rgb(30 41 59);flex-shrink:0">' +
            '<lv-button class="s3-close pane-chev" variant="chev" title="close preview">' + CHEVRON + '</lv-button>' +
            '<span style="font-size:12px;letter-spacing:.02em;color:#64748b;flex:1">Preview</span>' +
            '<span class="s3-actions" style="display:flex;gap:5px;flex-shrink:0"></span>' +
          '</div>' +
          '<div class="s3-objmeta mono" style="font-size:13px;color:#94a3b8;padding:7px 10px 4px;flex-shrink:0;word-break:break-all"></div>' +
          '<pre class="s3-objbody scroll mono" style="flex:1;min-height:0;overflow:auto;padding:0 10px 10px;font-size:13px;color:#d6dde8;white-space:pre-wrap;word-break:break-all"></pre>' +
          '<textarea class="s3-editor mono" style="display:none;flex:1;min-height:0;margin:0 10px 8px;background:rgb(2 6 23);border:1px solid rgb(51 65 85);border-radius:6px;padding:8px;font-size:13px;color:#c2cbd8;outline:none;resize:none"></textarea>' +
          '<div class="s3-editbar" style="display:none;gap:6px;padding:0 10px 10px;flex-shrink:0;justify-content:flex-end">' +
            '<lv-button class="s3-cancel" variant="ghost" size="sm">Cancel</lv-button>' +
            '<lv-button class="s3-save" variant="primary" size="sm">Save</lv-button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>'

// ---- per-panel s3 actions ----
function fetchObjects(vs, id) {
  if (!vs.bucket) { vs.objects = []; vs.objectsBucket = null; return }
  const wanted = vs.bucket
  const qs = new URLSearchParams({ conn: vs.bucketConn || '', bucket: wanted })
  fetch('/api/objects?' + qs.toString())
    .then((r) => r.json())
    .then((d) => {
      if (vs.bucket !== wanted) return // bucket changed while fetching
      vs.objects = Array.isArray(d.objects) ? d.objects : []
      vs.objectsBucket = wanted
      updateLeaf(id)
    })
    .catch(() => {})
}
function selectBucketLeaf(vs, id, name, conn) {
  vs.bucket = name
  vs.bucketConn = conn || ''
  vs.s3Page = 0
  vs.filter = ''
  vs.selectedKey = null
  vs.previewMeta = 'select an object'
  vs.previewBody = ''
  vs.objects = []
  vs.objectsBucket = null
  updateLeaf(id)
  fetchObjects(vs, id)
}
function loadObjectLeaf(vs, id, key) {
  vs.selectedKey = key
  vs.editing = false
  vs.previewMeta = 'loading ' + key + ' …'
  vs.previewBody = ''
  vs.previewType = ''
  updateLeaf(id)
  const qs = new URLSearchParams({ conn: vs.bucketConn || '', bucket: vs.bucket, key })
  fetch('/api/object?' + qs.toString())
    .then((r) => r.json())
    .then((d) => {
      if (vs.selectedKey !== key) return
      const body = d.body
      vs.previewType = body ? body.type : 'empty'
      vs.previewSize = body ? body.size : 0
      vs.previewMeta = key + '  ·  ' + vs.previewType + (body && body.size != null ? '  ·  ' + fmtBytes(body.size) : '')
      // only text/json inline their bytes; image/binary render from the raw URL
      vs.previewBody = !body ? '(empty)'
        : body.type === 'json' ? JSON.stringify(body.value, null, 2)
        : body.type === 'text' ? body.value
        : ''
      updateLeaf(id)
    })
}
// URL that streams an object's raw bytes with its content type (images/downloads)
function rawObjectUrl(vs) {
  return '/api/object/raw?' + new URLSearchParams({ conn: vs.bucketConn || '', bucket: vs.bucket, key: vs.selectedKey }).toString()
}
async function saveObjectLeaf(vs, id, bodyEl) {
  const editor = bodyEl.querySelector('.s3-editor')
  const body = editor.value
  const btn = bodyEl.querySelector('.s3-save')
  btn.disabled = true; const l0 = btn.textContent; btn.textContent = 'saving…'
  const ct = vs.previewType === 'json' ? 'application/json' : 'text/plain; charset=utf-8'
  try {
    const res = await fetch('/api/object', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conn: vs.bucketConn || '', bucket: vs.bucket, key: vs.selectedKey, body, contentType: ct }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
    notify('Saved ' + vs.selectedKey, 'ok')
    vs.editing = false
    loadObjectLeaf(vs, id, vs.selectedKey)
    fetchObjects(vs, id)
  } catch (e) { notify('Save failed: ' + cleanS3Err(e.message), 'error'); btn.disabled = false; btn.textContent = l0 }
}
function cleanS3Err(msg) {
  const m = String(msg || '')
  if (/AccessDenied|not allowed for this key|403|Forbidden/i.test(m)) return 'access denied — this connection is read-only'
  const api = m.match(/api error [^:]+: (.+?)(\n|$)/)
  if (api) return api[1].trim()
  return m.length > 120 ? m.slice(0, 120) + '…' : m
}
async function uploadFiles(vs, id, fileList) {
  if (!vs.bucket) return
  const files = Array.from(fileList)
  const root = leafMap.get(id)
  const bodyEl = root && root.bodyEl
  const busy = bodyEl && bodyEl.querySelector('.s3-busy')
  const busyText = bodyEl && bodyEl.querySelector('.s3-busy-text')
  const upBtn = bodyEl && bodyEl.querySelector('.s3-upload')
  const newBtn = bodyEl && bodyEl.querySelector('.s3-new')
  if (busy) busy.style.display = 'flex'
  if (upBtn) upBtn.disabled = true
  if (newBtn) newBtn.disabled = true
  let okCount = 0, firstErr = null
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    if (busyText) busyText.textContent = 'Uploading ' + (i + 1) + ' / ' + files.length + ' — ' + f.name
    try {
      const url = '/api/object/raw?conn=' + encodeURIComponent(vs.bucketConn || '') + '&bucket=' + encodeURIComponent(vs.bucket) + '&key=' + encodeURIComponent(f.name)
      const res = await fetch(url, { method: 'PUT', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
      okCount++
    } catch (e) { const msg = cleanS3Err(e.message); if (!firstErr) firstErr = msg; notify('Upload failed: ' + f.name + ' — ' + msg, 'error') }
  }
  if (busy) busy.style.display = 'none'
  if (upBtn) upBtn.disabled = false
  if (newBtn) newBtn.disabled = false
  if (okCount) notify('Uploaded ' + okCount + ' file' + (okCount > 1 ? 's' : ''), 'ok')
  fetchObjects(vs, id)
}

// new text object modal (single instance, shared by all s3 panels)
const newObjModal = document.getElementById('newObjModal')
let newObjCtx = null
function openNewObj(vs, id) {
  newObjCtx = { vs, id }
  document.getElementById('newObjBucket').textContent = 'into ' + vs.bucket
  document.getElementById('newObjKey').value = ''
  document.getElementById('newObjBody').value = ''
  newObjModal.classList.add('open')
  setTimeout(() => document.getElementById('newObjKey').focus(), 50)
}
function closeNewObj() { newObjModal.classList.remove('open'); newObjCtx = null }
document.getElementById('newObjX').addEventListener('click', closeNewObj)
document.getElementById('newObjCancel').addEventListener('click', closeNewObj)
newObjModal.addEventListener('click', (e) => { if (e.target === newObjModal) closeNewObj() })
document.getElementById('newObjCreate').addEventListener('click', async () => {
  if (!newObjCtx) return
  const { vs, id } = newObjCtx
  const key = document.getElementById('newObjKey').value.trim()
  const body = document.getElementById('newObjBody').value
  if (!key) { notify('Key is required', 'error'); return }
  const ct = key.endsWith('.json') ? 'application/json' : 'text/plain; charset=utf-8'
  try {
    const res = await fetch('/api/object', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ conn: vs.bucketConn || '', bucket: vs.bucket, key, body, contentType: ct }) })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
    notify('Created ' + key, 'ok')
    closeNewObj()
    fetchObjects(vs, id)
  } catch (e) { notify('Create failed: ' + cleanS3Err(e.message), 'error') }
})
async function deleteObjectLeaf(vs, id) {
  const key = vs.selectedKey
  const ok = await confirmDialog({ title: 'Delete object', message: 'Delete “' + key + '” from ' + vs.bucket + '?', okLabel: 'Delete' })
  if (!ok) return
  const qs = new URLSearchParams({ conn: vs.bucketConn || '', bucket: vs.bucket, key })
  try {
    const res = await fetch('/api/object?' + qs.toString(), { method: 'DELETE' })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText)
    notify('Deleted ' + key, 'ok')
    vs.selectedKey = null; vs.editing = false
    fetchObjects(vs, id)
    updateLeaf(id)
  } catch (e) { notify('Delete failed: ' + cleanS3Err(e.message), 'error') }
}

export const s3View = {
  title: 'S3 buckets',
  icon: ICONS.s3,
  body: function () { return S3_BODY },
  mount: function (bodyEl, vs, id) {
    const f = bodyEl.querySelector('.s3-filter')
    f.value = vs.filter
    f.addEventListener('input', (e) => { vs.filter = e.target.value; vs.s3Page = 0; updateLeaf(id) })
    bodyEl.querySelector('.s3-close').addEventListener('click', () => { vs.selectedKey = null; vs.editing = false; updateLeaf(id) })
    bodyEl.querySelector('.s3-back').addEventListener('click', () => {
      vs.bucket = ''
      vs.bucketConn = null
      vs.selectedKey = null
      vs.objects = []
      vs.objectsBucket = null
      updateLeaf(id)
    })
    // save/cancel live on static elements — wire ONCE here, not per-render,
    // or listeners accumulate and a single click fires multiple saves
    bodyEl.querySelector('.s3-save').addEventListener('click', () => saveObjectLeaf(vs, id, bodyEl))
    bodyEl.querySelector('.s3-cancel').addEventListener('click', () => { vs.editing = false; updateLeaf(id) })

    // upload (file picker) + new text object
    const fileInput = bodyEl.querySelector('.s3-file')
    bodyEl.querySelector('.s3-upload').addEventListener('click', () => fileInput.click())
    fileInput.addEventListener('change', () => { if (fileInput.files.length) uploadFiles(vs, id, fileInput.files); fileInput.value = '' })
    bodyEl.querySelector('.s3-new').addEventListener('click', () => openNewObj(vs, id))

    // drag & drop files onto the objects area
    const objArea = bodyEl.querySelector('.s3-objects')
    const drop = bodyEl.querySelector('.s3-drop')
    let dragDepth = 0
    objArea.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; drop.style.display = 'flex' })
    objArea.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' })
    objArea.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.style.display = 'none' } })
    objArea.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; drop.style.display = 'none'
      if (e.dataTransfer.files && e.dataTransfer.files.length) uploadFiles(vs, id, e.dataTransfer.files)
    })
  },
  // keep each panel's object list live for its own bucket
  refresh: function (vs, id) {
    if (vs.bucket) fetchObjects(vs, id)
  },
  update: function (bodyEl, hs, vs, id) {
    const listEl = bodyEl.querySelector('.s3-bucketlist')
    const contentsEl = bodyEl.querySelector('.s3-contents')

    if (!vs.bucket) {
      contentsEl.style.display = 'none'
      listEl.style.display = 'flex'
      const ff = vs.connFilter || []
      const all = ff.length ? lastGood.buckets.filter((b) => ff.includes(b._conn && b._conn.id)) : lastGood.buckets
      const showConn = awsConns().length > 1 && ff.length !== 1
      const bh = hash(all.map((b) => b.name + '@' + ((b._conn && b._conn.id) || ''))) + '|' + showConn
      if (hs.bl !== bh) {
        hs.bl = bh
        listEl.innerHTML = bucketListHtml(all, showConn)
        listEl.querySelectorAll('.bk').forEach((btn) => btn.addEventListener('click', () => selectBucketLeaf(vs, id, btn.dataset.name, btn.dataset.conn)))
      }
      return
    }

    listEl.style.display = 'none'
    contentsEl.style.display = 'flex'
    bodyEl.querySelector('.s3-bucketname').textContent = vs.bucket

    const oRoot = bodyEl.querySelector('.s3-objects')
    const oh = hash(vs.objects) + '|' + vs.filter + '|' + vs.s3Page + '|' + vs.selectedKey + '|' + vs.bucket
    if (hs.o !== oh) {
      hs.o = oh
      const r = objectsPageHtml(vs)
      oRoot.querySelector('.s3-objlist').innerHTML = r.html // not oRoot — keeps .s3-drop/.s3-busy overlays alive
      oRoot.querySelectorAll('.ob').forEach((btn) => btn.addEventListener('click', () => loadObjectLeaf(vs, id, btn.dataset.key)))
      const pager = bodyEl.querySelector('.s3-pager')
      pager.innerHTML =
        '<lv-button class="s3-prev" variant="hdr" size="sm" ' + (r.page <= 0 ? 'disabled' : '') + '>&#x2039; prev</lv-button>' +
        '<span style="font-size:13px;color:#94a3b8" class="mono">' + r.info + '</span>' +
        '<lv-button class="s3-next" variant="hdr" size="sm" ' + (r.page >= r.pages - 1 ? 'disabled' : '') + '>next &#x203a;</lv-button>'
      const prev = pager.querySelector('.s3-prev'), next = pager.querySelector('.s3-next')
      prev.addEventListener('click', () => { if (vs.s3Page > 0) { vs.s3Page--; updateLeaf(id) } })
      next.addEventListener('click', () => { vs.s3Page++; updateLeaf(id) })
    }
    const f = bodyEl.querySelector('.s3-filter')
    if (document.activeElement !== f && f.value !== vs.filter) f.value = vs.filter

    const prevPane = bodyEl.querySelector('.s3-preview')
    if (vs.selectedKey) {
      prevPane.classList.add('open')
      const ph = hash([vs.selectedKey, vs.previewMeta, vs.previewBody, vs.previewType, vs.editing])
      if (hs.p !== ph) {
        hs.p = ph
        bodyEl.querySelector('.s3-objmeta').textContent = vs.previewMeta
        const pre = bodyEl.querySelector('.s3-objbody')
        const editor = bodyEl.querySelector('.s3-editor')
        const editbar = bodyEl.querySelector('.s3-editbar')
        const editable = vs.previewType === 'text' || vs.previewType === 'json'
        if (vs.editing) {
          pre.style.display = 'none'; editor.style.display = 'block'; editbar.style.display = 'flex'
          if (document.activeElement !== editor) editor.value = vs.previewBody
        } else {
          pre.style.display = 'block'; editor.style.display = 'none'; editbar.style.display = 'none'
          if (vs.previewType === 'image') {
            pre.innerHTML = '<img src="' + rawObjectUrl(vs) + '" alt="' + escapeHtml(vs.selectedKey) + '" style="max-width:100%;height:auto;border-radius:6px;display:block" />'
          } else if (vs.previewType === 'binary') {
            pre.innerHTML = '<div style="color:#94a3b8;font-size:13px;line-height:1.7">Binary file · ' + fmtBytes(vs.previewSize || 0) + '<br><a href="' + rawObjectUrl(vs) + '" download style="color:#818cf8">Download</a></div>'
          } else {
            pre.textContent = vs.previewBody
          }
        }
        // action buttons (edit only for text/json; delete always)
        const actions = bodyEl.querySelector('.s3-actions')
        actions.innerHTML =
          (editable && !vs.editing ? '<lv-button class="s3-edit" variant="icon" size="sm" title="edit">' + PENCIL + '</lv-button>' : '') +
          (!vs.editing ? '<lv-button class="s3-del" variant="icon" size="sm" title="delete object" style="color:#94a3b8">' + TRASH + '</lv-button>' : '')
        const eb = actions.querySelector('.s3-edit'); if (eb) eb.addEventListener('click', () => { vs.editing = true; updateLeaf(id) })
        const db = actions.querySelector('.s3-del'); if (db) db.addEventListener('click', () => deleteObjectLeaf(vs, id))
      }
    } else {
      prevPane.classList.remove('open')
      hs.p = '__closed'
    }
  },
}
