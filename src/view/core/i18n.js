// Lightweight i18n (en + pt-BR). `setLang` persists + re-applies and dispatches
// a `lv-lang` event on document so the app can re-render without this module
// needing to import the renderer (keeps the dependency graph acyclic).

export const I18N = {
  en: {
    'ui.views': 'Views', 'ui.layouts': 'Layouts', 'ui.logs': 'Logs', 'ui.settings': 'Settings',
    'ui.viewsHint': 'Views — drag onto a panel', 'ui.dragHint': 'drag →',
    'view.sqs': 'SQS queues', 'view.s3': 'S3 buckets', 'view.docker': 'Docker', 'view.kafka': 'Kafka', 'view.pgmq': 'PGMQ',
    'set.title': 'Settings',
    'set.connections': 'Connections', 'set.addConn': 'Add connection', 'set.security': 'Security', 'set.language': 'Language',
    'set.connHint': 'Add as many as you like — views show items from every connection of their kind. Secrets are encrypted at rest.',
    'lay.reset': 'Reset to default layout', 'lay.save': 'Save current layout', 'lay.saved': 'Saved layouts', 'lay.saveBtn': 'Save',
    'pane.drag': 'Drag a panel here', 'login.title': 'Sign in', 'login.btn': 'Login', 'login.hint': 'Enter your 6-digit PIN.',
    'ops.log': 'Operations log', 'log.clear': 'Clear', 'filter.all': 'All connections',
    'dk.containers': 'Containers', 'dk.images': 'Images', 'dk.volumes': 'Volumes', 'dk.startAll': 'Start all',
    'btn.cancel': 'Cancel', 'btn.confirm': 'Confirm',
  },
  ptBR: {
    'ui.views': 'Visões', 'ui.layouts': 'Layouts', 'ui.logs': 'Logs', 'ui.settings': 'Configurações',
    'ui.viewsHint': 'Visões — arraste para um painel', 'ui.dragHint': 'arraste →',
    'view.sqs': 'Filas SQS', 'view.s3': 'Buckets S3', 'view.docker': 'Docker', 'view.kafka': 'Kafka', 'view.pgmq': 'PGMQ',
    'set.title': 'Configurações',
    'set.connections': 'Conexões', 'set.addConn': 'Adicionar conexão', 'set.security': 'Segurança', 'set.language': 'Idioma',
    'set.connHint': 'Adicione quantas quiser — as visões mostram itens de todas as conexões do mesmo tipo. Segredos são criptografados.',
    'lay.reset': 'Restaurar layout padrão', 'lay.save': 'Salvar layout atual', 'lay.saved': 'Layouts salvos', 'lay.saveBtn': 'Salvar',
    'pane.drag': 'Arraste um painel aqui', 'login.title': 'Entrar', 'login.btn': 'Entrar', 'login.hint': 'Digite seu PIN de 6 dígitos.',
    'ops.log': 'Registro de operações', 'log.clear': 'Limpar', 'filter.all': 'Todas as conexões',
    'dk.containers': 'Contêineres', 'dk.images': 'Imagens', 'dk.volumes': 'Volumes', 'dk.startAll': 'Iniciar todos',
    'btn.cancel': 'Cancelar', 'btn.confirm': 'Confirmar',
  },
}

let LANG = localStorage.getItem('ls.lang') || (typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().startsWith('pt') ? 'ptBR' : 'en')

/** Current language code. */
export function currentLang() { return LANG }
/** Translate a key (falls back to English, then the key itself). */
export function t(key) { return (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key }
/** Apply translations to all [data-i18n*] elements currently in the DOM. */
export function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.getAttribute('data-i18n')) })
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.getAttribute('data-i18n-title')) })
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.getAttribute('data-i18n-ph')) })
}
/** Switch language: persist, re-apply, and notify listeners via `lv-lang`. */
export function setLang(l) {
  LANG = l
  localStorage.setItem('ls.lang', l)
  applyI18n()
  document.dispatchEvent(new CustomEvent('lv-lang', { detail: { lang: l } }))
}
