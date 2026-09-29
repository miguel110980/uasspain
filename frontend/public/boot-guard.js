(function () {
  'use strict'

  var failed = false
  var timeoutId

  function showBootError() {
    if (failed || !document.querySelector('[data-app-loading]')) return
    failed = true
    window.clearTimeout(timeoutId)

    var root = document.getElementById('root')
    if (!root) return

    root.replaceChildren()

    var panel = document.createElement('main')
    panel.setAttribute('role', 'alert')
    panel.style.cssText = 'min-height:100vh;display:grid;place-content:center;gap:1rem;padding:2rem;background:#050507;color:#e2e8f0;font-family:system-ui,sans-serif;text-align:center'

    var title = document.createElement('h1')
    title.textContent = 'No se pudo iniciar UASSPAIN'
    title.style.cssText = 'margin:0;font-size:1.5rem'

    var message = document.createElement('p')
    message.textContent = 'Recarga la pagina. Si el problema continua, contacta con el administrador.'
    message.style.cssText = 'margin:0;color:#94a3b8'

    var reload = document.createElement('button')
    reload.type = 'button'
    reload.textContent = 'Recargar'
    reload.style.cssText = 'justify-self:center;padding:.7rem 1.2rem;border:1px solid #38bdf8;border-radius:.5rem;background:#0f172a;color:#f8fafc;cursor:pointer'
    reload.addEventListener('click', function () { window.location.reload() })

    panel.append(title, message, reload)
    root.append(panel)
  }

  window.addEventListener('error', showBootError)
  window.addEventListener('unhandledrejection', showBootError)
  timeoutId = window.setTimeout(showBootError, 15000)
}())
