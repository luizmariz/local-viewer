// Modal/dialog helpers. `confirmDialog` is a self-contained Promise dialog (no
// pre-existing markup needed). `LvModal` is a declarative <lv-modal> for the
// settings/login/new-object panels. Styling reuses .modal-backdrop/.modal/.btn-*.
//
// NOTE: importing this file has no side effects beyond defining <lv-modal>;
// confirmDialog builds its singleton lazily so it never conflicts with the
// legacy inline dialog until that one is removed (Phase D).

let dlg = null

/**
 * @param {{title?:string,message?:string,okLabel?:string,cancelLabel?:string,danger?:boolean}} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opts = {}) {
  if (!dlg) dlg = buildDialog()
  dlg.title.textContent = opts.title || 'Confirm'
  dlg.msg.textContent = opts.message || ''
  dlg.cancel.textContent = opts.cancelLabel || 'Cancel'
  dlg.ok.textContent = opts.okLabel || 'Confirm'
  dlg.ok.className = opts.danger === false ? '' : 'btn-danger'
  dlg.ok.style.cssText = opts.danger === false
    ? 'background:rgb(79 70 229);border:1px solid rgb(99 102 241);color:#fff;border-radius:6px;padding:6px 14px;font-size:13px;cursor:pointer'
    : ''
  dlg.backdrop.classList.add('open')
  setTimeout(() => dlg.ok.focus(), 0)
  return new Promise((resolve) => { dlg.resolve = resolve })
}

function buildDialog() {
  const backdrop = document.createElement('div')
  backdrop.className = 'modal-backdrop'
  backdrop.style.zIndex = '9996'
  backdrop.innerHTML =
    '<div class="modal" style="width:420px"><div class="modal-head"><span class="js-title">Confirm</span></div>'
    + '<div class="modal-body"><div class="js-msg" style="font-size:13px;color:#c2cbd8;line-height:1.5;white-space:pre-line"></div>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px"><button class="js-cancel btn-ghost"></button><button class="js-ok btn-danger"></button></div></div></div>'
  document.body.appendChild(backdrop)
  const d = {
    backdrop,
    title: backdrop.querySelector('.js-title'),
    msg: backdrop.querySelector('.js-msg'),
    ok: backdrop.querySelector('.js-ok'),
    cancel: backdrop.querySelector('.js-cancel'),
    resolve: null,
  }
  const done = (v) => { backdrop.classList.remove('open'); if (d.resolve) { d.resolve(v); d.resolve = null } }
  d.ok.addEventListener('click', () => done(true))
  d.cancel.addEventListener('click', () => done(false))
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) done(false) })
  return d
}

/**
 * <lv-modal open width="480">…dialog body…</lv-modal>
 * Wraps children in a .modal-backdrop/.modal. Toggle via `open` attribute or
 * `.open` property; backdrop click & Escape emit a `close` event.
 */
export class LvModal extends HTMLElement {
  static observedAttributes = ['open']

  connectedCallback() {
    if (this._wrap) return
    const w = this.getAttribute('width') || '480'
    const inner = this.innerHTML
    this.innerHTML = ''
    this._wrap = document.createElement('div')
    this._wrap.className = 'modal-backdrop'
    this._wrap.innerHTML = '<div class="modal" style="width:' + w + 'px;max-width:92vw"></div>'
    this._wrap.querySelector('.modal').innerHTML = inner
    this.appendChild(this._wrap)
    this._wrap.addEventListener('click', (e) => { if (e.target === this._wrap) this.close() })
    this.#sync()
  }

  attributeChangedCallback() { this.#sync() }
  #sync() { if (this._wrap) this._wrap.classList.toggle('open', this.hasAttribute('open')) }

  get open() { return this.hasAttribute('open') }
  set open(v) { this.toggleAttribute('open', !!v) }
  close() { this.open = false; this.dispatchEvent(new CustomEvent('close', { bubbles: true })) }
}

if (!customElements.get('lv-modal')) customElements.define('lv-modal', LvModal)
