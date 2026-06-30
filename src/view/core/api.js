// Tiny API helpers shared by the action handlers.
import { state } from './state.js'

/**
 * POST JSON to `path`, parse the response, throw on non-2xx (message from the
 * server's `error` field). Guards against overlapping actions via state.busyAction.
 * @returns {Promise<any|null>} parsed body, or null if an action is already running
 */
export async function postJson(path, body) {
  if (state.busyAction) return null
  state.busyAction = true
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
    const text = await res.text()
    let data; try { data = JSON.parse(text) } catch { data = { raw: text } }
    if (!res.ok) throw new Error(data.error || res.statusText)
    return data
  } finally {
    state.busyAction = false
  }
}

/** Ask the app to re-run the AWS sweep (decoupled from the polling engine). */
export function requestRefresh() { document.dispatchEvent(new CustomEvent('lv-refresh')) }
