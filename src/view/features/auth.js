// Auth UX: wraps window.fetch so any gated 401 surfaces the login overlay,
// drives the PIN login form, and checks the lock on boot. Importing this module
// installs the fetch wrapper (must happen before the first API call).
import { requestRefresh } from '../core/api.js'

const rawFetch = window.fetch.bind(window)

/** Show the PIN login overlay and focus the field. */
export function showLogin() {
  document.getElementById('loginOverlay').classList.add('open')
  setTimeout(() => { const i = document.getElementById('loginCode'); if (i) i.focus() }, 50)
}

// surface the lock whenever a gated request returns 401
window.fetch = async (...args) => {
  const res = await rawFetch(...args)
  try {
    const u = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url)
    if (res.status === 401 && u && u.indexOf('/api/') === 0 && u.indexOf('/api/auth/') !== 0) showLogin()
  } catch (e) {}
  return res
}

/** On load, lock immediately if a PIN is configured and there's no session. */
export function checkLockOnBoot() {
  rawFetch('/api/auth/status').then((r) => r.json()).then((s) => { if (s.configured && !s.authenticated) showLogin() }).catch(() => {})
}

function doLogin() {
  const code = document.getElementById('loginCode').value.trim()
  rawFetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }).then((res) => {
    if (res.ok) {
      document.getElementById('loginOverlay').classList.remove('open')
      document.getElementById('loginCode').value = ''
      requestRefresh()
    } else {
      document.getElementById('loginErr').textContent = 'invalid PIN'
    }
  })
}

document.getElementById('loginBtn').addEventListener('click', doLogin)
;(function () {
  const inp = document.getElementById('loginCode')
  inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6) })
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin() })
})()
