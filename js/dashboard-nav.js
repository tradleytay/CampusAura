(function () {
  'use strict'

  document.querySelectorAll('.dashboard-nav-toggle').forEach(toggle => {
    const nav = document.getElementById(toggle.getAttribute('aria-controls'))
    if (!nav) return

    toggle.addEventListener('click', () => {
      const isOpen = toggle.getAttribute('aria-expanded') === 'true'
      toggle.setAttribute('aria-expanded', String(!isOpen))
      nav.classList.toggle('is-open', !isOpen)
    })

    nav.addEventListener('click', event => {
      if (!event.target.closest('.admin-tab')) return
      toggle.setAttribute('aria-expanded', 'false')
      nav.classList.remove('is-open')
    })
  })
})()
