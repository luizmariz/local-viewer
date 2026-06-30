// Transient toast notifications. Side-effect-free import.

/**
 * Show a brief toast.
 * @param {string} msg
 * @param {'ok'|'error'|'info'} [level]
 */
export function notify(msg, level) {
  const el = document.createElement('div')
  el.className = 'lv-toast' + (level ? ' lv-toast-' + level : '')
  el.textContent = msg
  document.body.appendChild(el)
  setTimeout(() => { el.classList.add('lv-toast-out'); setTimeout(() => el.remove(), 300) }, 2600)
}
