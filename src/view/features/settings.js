// Settings modal: connections manager (kind-first add flow) + Security (PIN
// setup/change/disable). Self-wiring on import (owns #settingsToggle, the modal,
// the add-flow controls). No exports — it's a feature that installs itself.
import { state, refreshConns } from '../core/state.js'
import { escapeHtml } from '../core/util.js'
import { confirmDialog, notify } from '../components/index.js'
import { iconSvg } from '../core/icons.js'
import { requestRefresh } from '../core/api.js'
import { showLogin } from './auth.js'

const TRASH = iconSvg('trash', 14)
const settingsModal = document.getElementById('settingsModal')
function openSettings(on) { settingsModal.classList.toggle('open', on); if (on) { connAddReset(); renderConnList(); renderSecurity() } }

// ---- connections manager ----
const KIND_LABEL = { aws: 'AWS', kafka: 'Kafka', pgmq: 'PGMQ' }
const KIND_TITLE = { aws: 'AWS — S3 / SQS / CloudFormation', kafka: 'Kafka broker', pgmq: 'Postgres PGMQ' }
let connKind = 'aws'

// populate the kind-chooser tile icons once
document.querySelectorAll('#connKinds .conn-kind').forEach((tile) => {
  const k = tile.dataset.kind
  tile.querySelector('.ck-icon').innerHTML = iconSvg(k === 'aws' ? 's3' : k, 22)
})

function connAddReset() {
  document.getElementById('connKinds').classList.remove('open')
  document.getElementById('connForm').classList.remove('open')
  document.getElementById('connAddBtn').style.display = ''
  for (const el of ['cnName', 'cnEndpoint', 'cnRegion', 'cnAccess', 'cnSecret', 'cnBroker', 'cnDsn']) { const n = document.getElementById(el); if (n) n.value = '' }
}
function connShowKinds() {
  document.getElementById('connAddBtn').style.display = 'none'
  document.getElementById('connForm').classList.remove('open')
  document.getElementById('connKinds').classList.add('open')
}
function connShowForm(kind) {
  connKind = kind
  document.getElementById('connKinds').classList.remove('open')
  document.getElementById('connFormTitle').textContent = KIND_TITLE[kind]
  document.getElementById('cnAwsFields').style.display = kind === 'aws' ? 'flex' : 'none'
  document.getElementById('cnKafkaFields').style.display = kind === 'kafka' ? 'block' : 'none'
  document.getElementById('cnPgmqFields').style.display = kind === 'pgmq' ? 'block' : 'none'
  document.getElementById('connForm').classList.add('open')
  setTimeout(() => document.getElementById('cnName').focus(), 50)
}
document.getElementById('connAddBtn').addEventListener('click', connShowKinds)
document.getElementById('cnCancel').addEventListener('click', connAddReset)
document.querySelectorAll('#connKinds .conn-kind').forEach((tile) => tile.addEventListener('click', () => connShowForm(tile.dataset.kind)))

function renderConnList() {
  const root = document.getElementById('connList')
  refreshConns().then((conns) => {
    if (!conns.length) { root.innerHTML = '<div class="italic" style="font-size:12px;color:#475569">none yet</div>'; return }
    root.innerHTML = conns.map((c) =>
      '<div class="cn-row"><span style="font-size:11px;padding:1px 6px;border-radius:4px;background:rgb(30 41 59);color:#94a3b8;flex-shrink:0">' + escapeHtml(KIND_LABEL[c.kind] || c.kind) + '</span>'
      + '<span class="mono" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:#c2cbd8">' + escapeHtml(c.name) + '</span>'
      + '<span class="mono" style="font-size:11px;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40%">' + escapeHtml(c.endpoint) + '</span>'
      + '<lv-button class="cn-del" variant="icon" data-id="' + escapeHtml(c.id) + '" data-name="' + escapeHtml(c.name) + '" title="delete connection" style="color:#94a3b8">' + TRASH + '</lv-button></div>'
    ).join('')
    root.querySelectorAll('.cn-del').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Delete connection', message: 'Remove connection “' + b.dataset.name + '”?', okLabel: 'Delete' })
      if (!ok) return
      await fetch('/api/connections/' + b.dataset.id, { method: 'DELETE' }); renderConnList()
    }))
  })
}
document.getElementById('cnAdd').addEventListener('click', async () => {
  const btn = document.getElementById('cnAdd')
  const kind = connKind
  const body = { name: document.getElementById('cnName').value.trim(), kind, region: '', accessKey: '', secretKey: '' }
  if (kind === 'aws') {
    body.endpoint = document.getElementById('cnEndpoint').value.trim()
    body.region = document.getElementById('cnRegion').value.trim() || 'us-east-1'
    body.accessKey = document.getElementById('cnAccess').value.trim() || 'test'
    body.secretKey = document.getElementById('cnSecret').value || 'test'
  } else if (kind === 'kafka') {
    body.endpoint = document.getElementById('cnBroker').value.trim()
  } else {
    body.endpoint = document.getElementById('cnDsn').value.trim()
  }
  if (!body.name || !body.endpoint) { notify('Name and endpoint are required', 'error'); return }
  btn.disabled = true; const lbl0 = btn.textContent; btn.textContent = 'creating…'
  try { await fetch('/api/connections', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); notify('Added ' + body.name, 'ok') } catch (e) { notify('Add failed', 'error') }
  btn.disabled = false; btn.textContent = lbl0
  connAddReset()
  renderConnList()
  requestRefresh()
})

// ---- security (PIN) ----
const PIN_INPUT = 'class="pin" mono inputmode="numeric" maxlength="6" placeholder="••••••" style="flex:1"'
function wirePinInput(el) { if (el) el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, '').slice(0, 6) }) }
function renderSecurity() {
  const root = document.getElementById('secBody')
  fetch('/api/auth/status').then((r) => r.json()).then((s) => {
    if (s.configured) {
      root.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
        + '<span style="color:#6ee7b7">PIN lock is enabled.</span>'
        + '<div style="flex:1"></div>'
        + '<lv-button id="pinChangeBtn" variant="hdr">Change PIN</lv-button>'
        + '<lv-button id="pinLockBtn" variant="hdr">Lock now</lv-button>'
        + '<lv-button id="pinDisableBtn" variant="ghost">Disable</lv-button>'
        + '</div>'
        + '<div id="pinPanel" style="margin-top:8px"></div>'
      document.getElementById('pinLockBtn').addEventListener('click', async () => { await fetch('/api/auth/logout', { method: 'POST' }); notify('Locked', 'ok'); openSettings(false); showLogin() })
      document.getElementById('pinChangeBtn').addEventListener('click', renderChangePin)
      document.getElementById('pinDisableBtn').addEventListener('click', renderDisablePin)
      return
    }
    root.innerHTML =
      '<div style="font-size:12px;color:#94a3b8;margin-bottom:6px">Set a 6-digit PIN to lock this viewer. It is hashed, never stored in plain text.</div>'
      + '<div style="display:flex;gap:6px"><lv-input id="pinCode" ' + PIN_INPUT + '></lv-input><lv-button id="pinSave" variant="primary">Set PIN</lv-button></div>'
      + '<div id="pinErr" style="font-size:12px;color:#f87171;margin-top:6px"></div>'
    const inp = document.getElementById('pinCode')
    wirePinInput(inp)
    document.getElementById('pinSave').addEventListener('click', savePin)
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') savePin() })
  })
}
function renderChangePin() {
  const p = document.getElementById('pinPanel')
  p.innerHTML =
    '<div style="display:flex;gap:6px;align-items:center"><span style="font-size:12px;color:#94a3b8;width:70px">Current</span><lv-input id="pinCur" ' + PIN_INPUT + '></lv-input></div>'
    + '<div style="display:flex;gap:6px;align-items:center;margin-top:6px"><span style="font-size:12px;color:#94a3b8;width:70px">New</span><lv-input id="pinNew" ' + PIN_INPUT + '></lv-input><lv-button id="pinChangeSave" variant="primary">Save</lv-button></div>'
    + '<div id="pinErr" style="font-size:12px;color:#f87171;margin-top:6px"></div>'
  wirePinInput(document.getElementById('pinCur'))
  wirePinInput(document.getElementById('pinNew'))
  document.getElementById('pinChangeSave').addEventListener('click', async () => {
    const current = document.getElementById('pinCur').value.trim()
    const code = document.getElementById('pinNew').value.trim()
    if (!/^\d{6}$/.test(code)) { document.getElementById('pinErr').textContent = 'New PIN must be exactly 6 digits'; return }
    const res = await fetch('/api/auth/change', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current, code }) })
    if (res.ok) { notify('PIN changed', 'ok'); renderSecurity() }
    else { const d = await res.json().catch(() => ({})); document.getElementById('pinErr').textContent = d.error || 'could not change PIN' }
  })
}
function renderDisablePin() {
  const p = document.getElementById('pinPanel')
  p.innerHTML =
    '<div style="font-size:12px;color:#94a3b8;margin-bottom:6px">Enter your current PIN to remove the lock.</div>'
    + '<div style="display:flex;gap:6px"><lv-input id="pinCur" ' + PIN_INPUT + '></lv-input><lv-button id="pinDisableSave" variant="danger">Disable lock</lv-button></div>'
    + '<div id="pinErr" style="font-size:12px;color:#f87171;margin-top:6px"></div>'
  wirePinInput(document.getElementById('pinCur'))
  document.getElementById('pinDisableSave').addEventListener('click', async () => {
    const current = document.getElementById('pinCur').value.trim()
    const res = await fetch('/api/auth/disable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ current }) })
    if (res.ok) { notify('Lock disabled', 'ok'); renderSecurity() }
    else { const d = await res.json().catch(() => ({})); document.getElementById('pinErr').textContent = d.error || 'could not disable' }
  })
}
async function savePin() {
  const code = document.getElementById('pinCode').value.trim()
  if (!/^\d{6}$/.test(code)) { document.getElementById('pinErr').textContent = 'PIN must be exactly 6 digits'; return }
  const res = await fetch('/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
  if (res.ok) { notify('PIN lock enabled', 'ok'); renderSecurity() }
  else { const d = await res.json().catch(() => ({})); document.getElementById('pinErr').textContent = d.error || 'could not set PIN' }
}

document.getElementById('settingsToggle').addEventListener('click', () => openSettings(!settingsModal.classList.contains('open')))
document.getElementById('settingsClose').addEventListener('click', () => openSettings(false))
settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal) openSettings(false) })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSettings(false) })
