/**
 * <lv-input placeholder="…" type="password" mono>  — a themed text input.
 * Renders a real <input> in light DOM and proxies `.value` / `.focus()` so it
 * drops into existing `getElementById(id).value` code. `input`/`change` events
 * bubble from the inner input unchanged.
 *
 * Pass-through attributes: type, placeholder, maxlength, inputmode, value.
 * Add `mono` for monospace.
 */
export class LvInput extends HTMLElement {
  static observedAttributes = ['value', 'placeholder', 'type', 'disabled']

  connectedCallback() {
    if (!this._input) {
      const i = document.createElement('input')
      i.className = 'lv-input-el' + (this.hasAttribute('mono') ? ' mono' : '')
      for (const a of ['type', 'placeholder', 'maxlength', 'inputmode', 'value'])
        if (this.hasAttribute(a)) i.setAttribute(a, this.getAttribute(a))
      this._input = i
      this.appendChild(i)
    }
  }

  attributeChangedCallback(name, _o, v) {
    if (!this._input) return
    if (name === 'value') this._input.value = v ?? ''
    else if (name === 'disabled') this._input.disabled = v != null
    else this._input.setAttribute(name, v ?? '')
  }

  get value() { return this._input ? this._input.value : (this.getAttribute('value') || '') }
  set value(v) { if (this._input) this._input.value = v; else this.setAttribute('value', v) }
  focus() { this._input && this._input.focus() }
}

if (!customElements.get('lv-input')) customElements.define('lv-input', LvInput)
