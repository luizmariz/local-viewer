// Shared application state singletons and connection helpers.
// Kept dependency-light: imports only pure utils. To avoid a cycle with the
// renderer, refreshConns() announces updates via a `lv-conns` CustomEvent
// instead of calling the panel-filter refresher directly.
import { parseJson, lsGet } from './util.js'

/** Mutable app state (polling, layout tree, UI flags). */
export const state = {
  paused: false,
  interval: 2000,
  conns: [],          // all saved connections
  loading: false,     // a /api/state sweep is in flight
  timer: null,
  tree: null,
  busyAction: false,
  settingsOpen: false,
  logOpen: lsGet('ls.logOpen', '1') !== '0',
  cfExpanded: false,
  cfDismissHash: '',
  _cfHash: '',
  _cfKey: '',
  reordering: false,
  queueOrder: parseJson(localStorage.getItem('ls.queueOrder'), []),
}

/** Last successful AWS sweep, kept so the UI survives a transient failure. */
export const lastGood = { queues: [], objects: [], buckets: [], changesets: [] }

/** leafId -> { view, bodyEl, hs, vs, filterEl } for every live panel. */
export const leafMap = new Map()

/** Connections of a given kind (aws|kafka|pgmq). */
export function getConns(kind) { return state.conns.filter((c) => c.kind === kind) }
export function awsConns() { return getConns('aws') }
/** Human name for a connection id (falls back to the id). */
export function connName(id) { const c = state.conns.find((x) => x.id === id); return c ? c.name : id }

/** Reload the connection list; dispatches `lv-conns` so the UI can re-sync. */
export function refreshConns() {
  return fetch('/api/connections').then((r) => r.json()).then((d) => {
    state.conns = d.connections || []
    document.dispatchEvent(new CustomEvent('lv-conns', { detail: { conns: state.conns } }))
    return state.conns
  }).catch(() => state.conns)
}
