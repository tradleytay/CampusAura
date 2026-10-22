// CampusAura theme preference and standalone page toggle.
(function () {
  const storageKey = 'campusaura-theme'
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

  function readThemePreference() {
    try { return localStorage.getItem(storageKey) } catch (error) {
      console.warn('CampusAura could not read the theme preference:', error)
      return null
    }
  }

  function saveThemePreference(theme) {
    try { localStorage.setItem(storageKey, theme) } catch (error) {
      console.warn('CampusAura could not save the theme preference:', error)
    }
  }

  function setTheme(theme) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', nextTheme)
    document.body?.setAttribute('data-theme', nextTheme)
    const metaTheme = document.querySelector('meta[name="theme-color"]')
    if (metaTheme) metaTheme.setAttribute('content', nextTheme === 'dark' ? '#0f172a' : '#2563eb')
    saveThemePreference(nextTheme)
    return nextTheme
  }

  function createStandaloneToggle() {
    if (document.querySelector('.nav-actions') || document.getElementById('themeToggle')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'standalone-theme-toggle'
    button.id = 'themeToggle'
    button.setAttribute('aria-pressed', 'false')
    button.setAttribute('aria-label', 'Switch to dark mode')
    document.body.appendChild(button)

    const updateLabel = () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
      button.innerHTML = `<span class="theme-toggle-icon" aria-hidden="true">${isDark ? '☀️' : '🌙'}</span><span class="theme-toggle-label">${isDark ? 'Light' : 'Dark'}</span>`
      button.setAttribute('aria-pressed', String(isDark))
      button.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode')
    }
    updateLabel()
    button.addEventListener('click', () => {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark')
      updateLabel()
    })
  }

  function createWhatsappButton() {
    if (document.querySelector('.whatsapp-fab')) return
    const link = document.createElement('a')
    link.className = 'whatsapp-fab'
    link.href = 'https://wa.me/260981637085'
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.setAttribute('aria-label', 'Chat on WhatsApp')
    link.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.52 3.48A11.86 11.86 0 0 0 12 0C5.37 0 .02 5.35.02 11.98c0 2.1.55 4.15 1.6 5.95L0 24l6.25-1.6a11.95 11.95 0 0 0 5.75 1.45c6.63 0 11.98-5.35 11.98-11.98 0-3.17-1.26-6.2-3.46-8.39ZM12 22C6.48 22 2 17.52 2 11.99 2 6.46 6.48 1.98 12 1.98c2.67 0 5.18 1.04 7.07 2.93A9.97 9.97 0 0 1 21.98 11.99C21.98 17.52 17.5 22 12 22Zm5.52-8.63c-.3-.15-1.78-.87-2.05-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.95 1.17-.18.2-.35.23-.65.08-.3-.15-1.27-.47-2.42-1.49-.89-.79-1.48-1.77-1.65-2.07-.17-.3-.02-.46.13-.61.14-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.35-.27.28-1.05 1.02-1.05 2.49 0 1.47 1.08 2.89 1.23 3.09.15.2 2.1 3.2 5.1 4.49.71.31 1.26.49 1.69.63.71.23 1.35.2 1.86.12.57-.09 1.78-.73 2.03-1.43.25-.7.25-1.3.17-1.43-.08-.13-.27-.2-.57-.35Z"/></svg>'
    document.body.appendChild(link)
  }

  const storedTheme = readThemePreference()
  setTheme(storedTheme === 'dark' || storedTheme === 'light'
    ? storedTheme
    : (mediaQuery.matches ? 'dark' : 'light'))

  document.addEventListener('DOMContentLoaded', () => {
    createStandaloneToggle()
    createWhatsappButton()
  })
  if (mediaQuery.addEventListener) {
    mediaQuery.addEventListener('change', (event) => {
      if (!readThemePreference()) setTheme(event.matches ? 'dark' : 'light')
    })
  }
}())
