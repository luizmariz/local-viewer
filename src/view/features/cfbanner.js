// CloudFormation "pending change sets" banner + the Execute action.
// Importing this module wires the banner's view/dismiss buttons.
import { state, lastGood } from '../core/state.js'
import { escapeHtml, fmtTimeAgo, hash } from '../core/util.js'
import { confirmDialog, notify } from '../components/index.js'
import { postJson, requestRefresh } from '../core/api.js'

const cfBanner = document.getElementById('cfBanner')

async function actExecuteCs(stackName, stackId, changeSetName, conn) {
  const ok = await confirmDialog({ title: 'Execute change set', message: 'Execute change set “' + changeSetName + '” on stack “' + stackName + '”?', okLabel: 'Execute', danger: false })
  if (!ok) return
  try { await postJson('/api/changeset/execute', { conn, stackName, stackId, changeSetName }); notify('Submitted ' + changeSetName, 'ok') } catch (e) { notify('Execute failed: ' + e.message, 'error') }
  state._cfKey = ''
  requestRefresh()
}

/** Render (or hide) the pending-changesets banner. Hash-guarded. */
export function renderCfBanner(changesets) {
  changesets = changesets || []
  const h = hash(changesets)
  state._cfHash = h
  const dismissed = h === state.cfDismissHash
  const key = h + '|' + state.cfExpanded + '|' + dismissed
  if (state._cfKey === key) return
  state._cfKey = key

  if (!changesets.length || dismissed) { cfBanner.style.display = 'none'; return }
  cfBanner.style.display = ''
  document.getElementById('cfBannerText').textContent =
    changesets.length + ' CloudFormation change set' + (changesets.length > 1 ? 's' : '') + ' pending execution'
  document.getElementById('cfBannerToggle').textContent = state.cfExpanded ? 'hide' : 'view'
  const list = document.getElementById('cfBannerList')
  list.style.display = state.cfExpanded ? '' : 'none'
  if (state.cfExpanded) {
    list.innerHTML = changesets.map((cs) =>
      '<div class="cf-item"><div><div class="mono cf-item-name">' + escapeHtml(cs.stackName) + ' / ' + escapeHtml(cs.changeSetName) + '</div>' +
      '<div class="cf-item-sub">' + escapeHtml(cs.status) + ' · ' + escapeHtml(cs.executionStatus) + ' · created ' + fmtTimeAgo(cs.creationTime) + (cs._conn ? ' · ' + escapeHtml(cs._conn.name) : '') + '</div></div>' +
      '<button class="cf-exec" data-stack="' + escapeHtml(cs.stackName) + '" data-stackid="' + escapeHtml(cs.stackId || '') + '" data-cs="' + escapeHtml(cs.changeSetName) + '" data-conn="' + escapeHtml((cs._conn && cs._conn.id) || '') + '">Execute</button></div>'
    ).join('')
    list.querySelectorAll('.cf-exec').forEach((b) => b.addEventListener('click', () => actExecuteCs(b.dataset.stack, b.dataset.stackid, b.dataset.cs, b.dataset.conn)))
  }
}

document.getElementById('cfBannerToggle').addEventListener('click', () => { state.cfExpanded = !state.cfExpanded; state._cfKey = ''; renderCfBanner(lastGood.changesets) })
document.getElementById('cfBannerDismiss').addEventListener('click', () => { state.cfDismissHash = state._cfHash; state._cfKey = ''; renderCfBanner(lastGood.changesets) })
