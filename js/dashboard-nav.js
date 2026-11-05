(function () {
  'use strict'

  const dashboardMenu = document.getElementById('dashboardMenuToggle')
  const dashboardDrawer = document.getElementById('studentDashboardDrawer') || document.getElementById('providerDashboardDrawer') || document.getElementById('adminDashboardDrawer')
  if (dashboardMenu && dashboardDrawer) {
    const isStudentDashboard = dashboardDrawer.id === 'studentDashboardDrawer'
    const isProviderDashboard = dashboardDrawer.id === 'providerDashboardDrawer'
    const dashboardPrefix = isStudentDashboard ? 'student' : isProviderDashboard ? 'provider' : 'admin'
    const backdrop = document.getElementById(`${dashboardPrefix}DrawerBackdrop`)
    const closeButton = document.getElementById(`${dashboardPrefix}DrawerClose`)
    const collapsedClass = `${dashboardPrefix}-sidebar-collapsed`
    const openClass = `${dashboardPrefix}-drawer-open`
    const nav = document.getElementById(dashboardMenu.getAttribute('aria-controls'))
    const mobileDrawer = window.matchMedia('(max-width: 960px)')
    const setOpen = (isOpen, focusOnOpen = true, returnFocus = true) => {
      const isMobile = mobileDrawer.matches
      dashboardMenu.setAttribute('aria-expanded', String(isOpen))
      dashboardMenu.setAttribute('aria-label', isOpen
        ? (isMobile ? 'Close dashboard sections' : 'Hide dashboard sections')
        : (isMobile ? 'Open dashboard sections' : 'Show dashboard sections'))
      dashboardDrawer.setAttribute('aria-hidden', String(!isOpen))
      dashboardDrawer.setAttribute('role', isMobile ? 'dialog' : 'complementary')
      if (isMobile && isOpen) dashboardDrawer.setAttribute('aria-modal', 'true')
      else dashboardDrawer.removeAttribute('aria-modal')
      dashboardDrawer.inert = !isOpen
      dashboardDrawer.classList.toggle('is-open', isOpen)
      document.body.classList.toggle(collapsedClass, !isMobile && !isOpen)
      document.body.classList.toggle(openClass, isMobile && isOpen)
      if (backdrop) backdrop.hidden = !isMobile || !isOpen
      if (closeButton) closeButton.hidden = !isMobile
      if (isOpen && focusOnOpen && isMobile) {
        window.requestAnimationFrame(() => {
          if (dashboardDrawer.classList.contains('is-open')) nav?.querySelector('[aria-selected="true"]')?.focus()
        })
      } else if (returnFocus) {
        window.requestAnimationFrame(() => dashboardMenu.focus())
      }
    }

    dashboardMenu.addEventListener('click', () => {
      setOpen(dashboardMenu.getAttribute('aria-expanded') !== 'true')
    })
    closeButton?.addEventListener('click', () => setOpen(false))
    backdrop?.addEventListener('click', () => setOpen(false))
    nav?.addEventListener('click', event => {
      const tab = event.target.closest('.admin-tab')
      if (!tab || !mobileDrawer.matches) return
      setOpen(false)
    })
    document.addEventListener('keydown', event => {
      if (!mobileDrawer.matches || !dashboardDrawer.classList.contains('is-open')) return
      if (event.key === 'Escape') {
        setOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...dashboardDrawer.querySelectorAll('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    })
    const syncLayout = () => setOpen(!mobileDrawer.matches, false, false)
    mobileDrawer.addEventListener('change', syncLayout)
    window.addEventListener('resize', syncLayout)
    setOpen(!mobileDrawer.matches, false, false)
  }

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
