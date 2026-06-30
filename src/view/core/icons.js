// Central icon registry. Each entry is the inner markup of an SVG (no outer
// <svg>, no size class) using `currentColor`, so <lv-icon> can wrap + size it.
// Add icons here, never inline new SVGs in markup.

/** @typedef {{ vb?: string, stroke?: boolean, inner: string }} IconDef */

/** @type {Record<string, IconDef>} */
export const ICONS = {
  // ---- views ----
  sqs: { inner: '<path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.293 1.293a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 01-1.414-1.414L7.586 10 5.293 7.707a1 1 0 010-1.414zM11 12a1 1 0 100 2h3a1 1 0 100-2h-3z"/>' },
  s3: { inner: '<path d="M4 3a2 2 0 00-2 2v1h16V5a2 2 0 00-2-2H4zM2 9v7a2 2 0 002 2h12a2 2 0 002-2V9H2zm4 2a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1z"/>' },
  docker: { inner: '<path d="M3 7h2.6v2.4H3V7zm3.1 0h2.6v2.4H6.1V7zm3.1 0h2.6v2.4H9.2V7zM6.1 4.2h2.6v2.4H6.1V4.2zm9.6 2.9c-.4 0-.9.1-1.2.3-.2-1.1-1.1-1.7-1.6-2l-.4-.2-.3.4c-.3.6-.5 1.4-.3 2 .1.4.3.7.5.9-.3.2-1 .5-1.9.5H1.6l-.1.6c-.2 1.6.2 3.2 1.2 4.3 1 .9 2.4 1.4 4.2 1.4 3.9 0 6.8-1.8 8.2-5 .8 0 1.7-.2 2.3-1.2l.2-.3-.3-.2c-.4-.3-1.1-.4-1.8-.2z"/>' },
  kafka: { vb: '0 0 24 24', stroke: true, inner: '<circle cx="6" cy="12" r="2.2"/><circle cx="17" cy="6" r="2.2"/><circle cx="17" cy="18" r="2.2"/><path d="M8 11l7-4M8 13l7 4"/>' },
  pgmq: { inner: '<path d="M10 2c3.9 0 7 1.2 7 2.7S13.9 7.3 10 7.3 3 6.2 3 4.7 6.1 2 10 2zM3 7.2c1.3 1 4 1.6 7 1.6s5.7-.6 7-1.6v3.1c0 1.5-3.1 2.7-7 2.7s-7-1.2-7-2.7V7.2zm0 5.5c1.3 1 4 1.6 7 1.6s5.7-.6 7-1.6v2.6c0 1.5-3.1 2.7-7 2.7s-7-1.2-7-2.7v-2.6z"/>' },

  // ---- chrome / actions ----
  grip: { inner: '<path d="M7 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM7 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM7 16a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM16 16a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"/>' },
  chevron: { inner: '<path fill-rule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clip-rule="evenodd"/>' },
  funnel: { inner: '<path fill-rule="evenodd" d="M2.628 1.601C5.028 1.206 7.49 1 10 1s4.973.206 7.372.601a.75.75 0 01.628.74v2.288a2.25 2.25 0 01-.659 1.59l-4.682 4.683a2.25 2.25 0 00-.659 1.59v3.037c0 .684-.31 1.33-.844 1.757l-1.937 1.55A.75.75 0 017.5 18.25v-5.757a2.25 2.25 0 00-.659-1.591L2.16 6.22A2.25 2.25 0 011.5 4.629V2.34a.75.75 0 01.628-.74z" clip-rule="evenodd"/>' },
  trash: { inner: '<path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443a41.3 41.3 0 00-2.358.3.75.75 0 10.216 1.484l.13-.019.532 8.184A2.75 2.75 0 007.262 18.5h5.476a2.75 2.75 0 002.742-2.358l.532-8.184.13.02a.75.75 0 10.216-1.485A41.3 41.3 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd"/>' },
  pencil: { inner: '<path d="M5.433 13.917l1.262-3.155A4 4 0 017.58 9.42l6.92-6.918a2.121 2.121 0 013 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 01-.65-.65z"/><path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0010 3H4.75A2.75 2.75 0 002 5.75v9.5A2.75 2.75 0 004.75 18h9.5A2.75 2.75 0 0017 15.25V10a.75.75 0 00-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5z"/>' },
  close: { inner: '<path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>' },
  pause: { inner: '<path d="M6 4a1 1 0 011 1v10a1 1 0 11-2 0V5a1 1 0 011-1zm8 0a1 1 0 011 1v10a1 1 0 11-2 0V5a1 1 0 011-1z"/>' },
  play: { inner: '<path d="M6.3 3.8A1 1 0 005 4.7v10.6a1 1 0 001.5.87l9-5.3a1 1 0 000-1.74l-9-5.3z"/>' },
  refresh: { inner: '<path fill-rule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0V5.36l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389A5.5 5.5 0 0113.89 6.11l.311.311h-2.432a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219z" clip-rule="evenodd"/>' },
  settings: { inner: '<path fill-rule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/>' },
  apps: { inner: '<path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM13 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2h-2zM13 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2h-2z"/>' },
  layouts: { inner: '<path d="M3 5a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm6 0H5v10h4V5zm2 0v4h4V5h-4zm4 6h-4v4h4v-4z"/>' },
  logs: { vb: '0 0 16 16', inner: '<path fill-rule="evenodd" d="M2 2.5a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5zm0 4a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5zm0 4a.5.5 0 01.5-.5h6a.5.5 0 010 1h-6a.5.5 0 01-.5-.5z" clip-rule="evenodd"/>' },
  bolt: { inner: '<path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd"/>' },
  upload: { inner: '<path d="M9.25 13.5a.75.75 0 001.5 0V6.66l1.95 2.1a.75.75 0 101.1-1.02l-3.25-3.5a.75.75 0 00-1.1 0l-3.25 3.5a.75.75 0 101.1 1.02l1.95-2.1v6.84z"/><path d="M3.5 12.75a.75.75 0 00-1.5 0v1.5A2.75 2.75 0 004.75 17h10.5A2.75 2.75 0 0018 14.25v-1.5a.75.75 0 00-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-1.5z"/>' },
  expand: { vb: '0 0 24 24', stroke: true, inner: '<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>' },
  copy: { inner: '<path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.379a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z"/><path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z"/>' },
  brush: { vb: '0 0 24 24', inner: '<path d="M19.36 2.72l1.42 1.42-5.72 5.71c1.07 1.54 1.22 3.39.32 4.59L9.06 8.12c1.2-.9 3.05-.75 4.59.32l5.71-5.72zM5.93 17.57c-2.01-2.01-3.24-4.41-3.58-6.65l4.88-2.09 7.44 7.44-2.09 4.88c-2.24-.34-4.64-1.57-6.65-3.58z"/>' },
}

/**
 * Render an icon's SVG markup at a given pixel size, inheriting currentColor.
 * @param {string} name registry key
 * @param {number} [size=16]
 * @returns {string} svg markup ('' if unknown)
 */
export function iconSvg(name, size = 16) {
  const d = ICONS[name]
  if (!d) return ''
  const vb = d.vb || '0 0 20 20'
  const paint = d.stroke
    ? 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
    : 'fill="currentColor"'
  return '<svg viewBox="' + vb + '" ' + paint + ' width="' + size + '" height="' + size + '" style="display:block">' + d.inner + '</svg>'
}

/**
 * The buddy mascot (logo / favicon / empty-state pet).
 * @param {number} size
 * @param {{animate?: boolean}} [opts]
 */
export function buddySvg(size, opts = {}) {
  const eyes = opts.animate ? ' class="buddy-eyes"' : ''
  // sleek monitor-head bot: indigo head, dark visor, cyan LED eyes + antenna.
  // viewBox shifted up (minY -6) so the drawing (antenna…head) is vertically centred.
  return '<svg viewBox="0 -6 64 64" width="' + size + '" height="' + size + '" fill="none" xmlns="http://www.w3.org/2000/svg">'
    + '<line x1="32" y1="13" x2="32" y2="5" stroke="#818cf8" stroke-width="2.5" stroke-linecap="round"/>'
    + '<circle cx="32" cy="4" r="2.8" fill="#67e8f9"/>'
    + '<rect x="8.5" y="27" width="5" height="11" rx="2.5" fill="#818cf8"/>'
    + '<rect x="50.5" y="27" width="5" height="11" rx="2.5" fill="#818cf8"/>'
    + '<rect x="13" y="14" width="38" height="37" rx="11" fill="#6366f1"/>'
    + '<rect x="17" y="18" width="30" height="12" rx="6" fill="#818cf8" opacity=".4"/>'
    + '<rect x="18" y="26" width="28" height="17" rx="8.5" fill="#0f172a"/>'
    + '<g' + eyes + '>'
    + '<circle cx="26" cy="33" r="3.1" fill="#67e8f9"/><circle cx="38" cy="33" r="3.1" fill="#67e8f9"/>'
    + '</g>'
    + '</svg>'
}
