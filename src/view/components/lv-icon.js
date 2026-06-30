import { iconSvg } from '../core/icons.js'

/**
 * <lv-icon name="docker" size="16"></lv-icon>
 * Light-DOM icon from the central registry; inherits `color` (currentColor).
 * Attributes: `name` (registry key), `size` (px, default 16).
 */
export class LvIcon extends HTMLElement {
  static observedAttributes = ['name', 'size']

  connectedCallback() { this.#render() }
  attributeChangedCallback() { if (this.isConnected) this.#render() }

  #render() {
    const size = Number(this.getAttribute('size')) || 16
    this.innerHTML = iconSvg(this.getAttribute('name') || '', size)
  }
}

if (!customElements.get('lv-icon')) customElements.define('lv-icon', LvIcon)
