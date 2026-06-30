/**
 * <lv-checkbox checked>  — a themed checkbox (native, styled by global CSS).
 * Proxies `.checked` / `.indeterminate` and bubbles `change`.
 */
export class LvCheckbox extends HTMLElement {
  static observedAttributes = ['checked', 'disabled']

  connectedCallback() {
    if (!this._box) {
      const i = document.createElement('input')
      i.type = 'checkbox'
      i.checked = this.hasAttribute('checked')
      i.disabled = this.hasAttribute('disabled')
      this._box = i
      this.appendChild(i)
    }
  }

  attributeChangedCallback(name, _o, v) {
    if (!this._box) return
    if (name === 'checked') this._box.checked = v != null
    if (name === 'disabled') this._box.disabled = v != null
  }

  get checked() { return this._box ? this._box.checked : this.hasAttribute('checked') }
  set checked(v) { if (this._box) this._box.checked = !!v; else this.toggleAttribute('checked', !!v) }
  get indeterminate() { return this._box ? this._box.indeterminate : false }
  set indeterminate(v) { if (this._box) this._box.indeterminate = !!v }
}

if (!customElements.get('lv-checkbox')) customElements.define('lv-checkbox', LvCheckbox)
