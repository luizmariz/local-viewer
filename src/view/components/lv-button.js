/**
 * <lv-button variant="primary|ghost|danger|hdr|icon">Label</lv-button>
 * A light-DOM, self-styled button (styling lives in styles.css under lv-button).
 * Children stay editable (`el.textContent = 'saving…'` works); click bubbles
 * natively, so `el.addEventListener('click', …)` is unchanged. `disabled`
 * attribute blocks activation.
 */
export class LvButton extends HTMLElement {
  static observedAttributes = ['disabled']

  connectedCallback() {
    if (!this.hasAttribute('role')) this.setAttribute('role', 'button')
    if (!this.hasAttribute('tabindex')) this.tabIndex = this.hasAttribute('disabled') ? -1 : 0
    if (!this.hasAttribute('variant')) this.setAttribute('variant', 'hdr')
    if (!this._kb) {
      this._kb = (e) => {
        if (this.hasAttribute('disabled')) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click() }
      }
      this.addEventListener('keydown', this._kb)
      // swallow clicks while disabled (capture so listeners never fire)
      this.addEventListener('click', (e) => { if (this.hasAttribute('disabled')) { e.stopImmediatePropagation(); e.preventDefault() } }, true)
    }
  }

  attributeChangedCallback() { this.tabIndex = this.hasAttribute('disabled') ? -1 : 0 }

  get disabled() { return this.hasAttribute('disabled') }
  set disabled(v) { this.toggleAttribute('disabled', !!v) }
}

if (!customElements.get('lv-button')) customElements.define('lv-button', LvButton)
