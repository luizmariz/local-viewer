import { iconSvg } from '../core/icons.js'

/**
 * <lv-select multiple> — a funnel-trigger dropdown with checkbox options.
 * Powers the per-panel connection filter (multi-select). Buildless, light DOM.
 *
 * Properties (set from JS):
 *   .options : Array<{value:string,label:string}>
 *   .value   : string[]   (selected ids; [] = "all")
 * Attributes: `multiple` (bool), `alllabel` (text for the "all" row).
 * Emits: `change` CustomEvent → detail { value: string[] }.
 * The trigger hides itself when there are <2 options (nothing to filter).
 */
export class LvSelect extends HTMLElement {
  #options = []
  #value = []
  #pop = null

  connectedCallback() {
    if (!this._trigger) {
      this.className = (this.className + ' lv-select').trim()
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'lv-select-trigger'
      b.title = 'filter by connection'
      b.innerHTML = iconSvg('funnel', 14) + '<span class="lv-select-dot" hidden></span>'
      b.addEventListener('click', (e) => { e.stopPropagation(); this.#toggle() })
      this._trigger = b
      this.appendChild(b)
    }
    this.#syncTrigger()
  }

  disconnectedCallback() { this.#close() }

  set options(v) { this.#options = Array.isArray(v) ? v : []; this.#syncTrigger(); if (this.#pop) this.#renderPop() }
  get options() { return this.#options }
  set value(v) { this.#value = Array.isArray(v) ? v.slice() : (v ? [v] : []); this.#syncTrigger(); if (this.#pop) this.#renderPop() }
  get value() { return this.#value.slice() }

  #syncTrigger() {
    if (!this._trigger) return
    this.style.display = this.#options.length > 1 ? '' : 'none'
    const n = this.#value.length
    this._trigger.classList.toggle('active', n > 0)
    const dot = this._trigger.querySelector('.lv-select-dot')
    if (n > 0) { dot.hidden = false; dot.textContent = String(n) } else { dot.hidden = true }
  }

  #toggle() { this.#pop ? this.#close() : this.#open() }

  #open() {
    const pop = document.createElement('div')
    pop.className = 'lv-pop'
    this.#pop = pop
    document.body.appendChild(pop)
    this.#renderPop()
    const r = this._trigger.getBoundingClientRect()
    pop.style.top = (r.bottom + 6) + 'px'
    pop.style.left = Math.max(6, Math.min(r.left, window.innerWidth - pop.offsetWidth - 6)) + 'px'
    this._outside = (e) => { if (!pop.contains(e.target) && !this.contains(e.target)) this.#close() }
    setTimeout(() => document.addEventListener('click', this._outside), 0)
  }

  #close() {
    if (this._outside) { document.removeEventListener('click', this._outside); this._outside = null }
    if (this.#pop) { this.#pop.remove(); this.#pop = null }
  }

  #renderPop() {
    if (!this.#pop) return
    const sel = new Set(this.#value)
    const all = this.getAttribute('alllabel') || 'All'
    // "All" is checked when nothing is narrowed OR every option is ticked
    const allChecked = sel.size === 0 || sel.size === this.#options.length
    this.#pop.innerHTML =
      '<div class="lv-pop-item lv-pop-all"><input type="checkbox"' + (allChecked ? ' checked' : '') + ' /><span>' + esc(all) + '</span></div>'
      + '<div class="lv-pop-sep"></div>'
      + this.#options.map((o) => '<label class="lv-pop-item"><input type="checkbox" data-v="' + esc(o.value) + '"' + (sel.has(o.value) ? ' checked' : '') + ' /><span class="mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(o.label) + '</span></label>').join('')
    // toggling "All": on → tick every option; off → clear. Either way means "all".
    this.#pop.querySelector('.lv-pop-all input').addEventListener('change', (e) => {
      this.#pop.querySelectorAll('input[data-v]').forEach((cb) => { cb.checked = e.target.checked })
      this.#commit([])
    })
    this.#pop.querySelectorAll('input[data-v]').forEach((cb) => cb.addEventListener('change', () => {
      const ids = Array.from(this.#pop.querySelectorAll('input[data-v]')).filter((x) => x.checked).map((x) => x.dataset.v)
      // every option ticked is equivalent to "all" → store [] (no narrowing)
      this.#commit(ids.length === this.#options.length ? [] : ids)
    }))
  }

  #commit(ids) {
    this.#value = ids
    this.#syncTrigger()
    const allCb = this.#pop && this.#pop.querySelector('.lv-pop-all input')
    if (allCb) allCb.checked = ids.length === 0
    this.dispatchEvent(new CustomEvent('change', { detail: { value: this.value }, bubbles: true }))
  }
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }

if (!customElements.get('lv-select')) customElements.define('lv-select', LvSelect)
