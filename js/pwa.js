(function () {
  const installKey = 'campusaura:pwa-install-dismissed'
  const versionKey = 'campusaura:service-worker-version'
  const hadController = 'serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller)
  let deferredInstallPrompt = null
  let latestVersion = null
  let installCard
  let installDescription
  let installButton
  let showingInstallInstructions = false

  function readStorage(storage, key) {
    try {
      return storage.getItem(key)
    } catch (error) {
      console.warn('CampusAura could not read PWA preferences:', error)
      return null
    }
  }

  function writeStorage(storage, key, value) {
    try {
      storage.setItem(key, value)
    } catch (error) {
      console.warn('CampusAura could not save PWA preferences:', error)
    }
  }

  function addPwaStyles() {
    const style = document.createElement('style')
    style.textContent = `
      .pwa-install-card,.pwa-update-notice{position:fixed;z-index:11000;display:flex;align-items:center;gap:12px;width:min(420px,calc(100vw - 32px));padding:14px;border:1px solid #dbe5f2;border-radius:16px;background:#fff;color:#0f172a;box-shadow:0 18px 48px rgba(15,23,42,.22);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
      .pwa-install-card{right:16px;bottom:16px}
      .pwa-install-icon{width:52px;height:52px;flex:0 0 52px;border-radius:12px}
      .pwa-install-copy{display:grid;gap:3px;flex:1;min-width:0}
      .pwa-install-copy strong,.pwa-update-copy strong{font-size:15px}
      .pwa-install-copy span,.pwa-update-copy span{color:#475569}
      .pwa-install-action,.pwa-update-action{flex:0 0 auto;border:0;border-radius:9px;padding:9px 12px;background:#2563eb;color:#fff;font:inherit;font-weight:700;cursor:pointer}
      .pwa-install-close,.pwa-update-close{align-self:flex-start;border:0;background:transparent;color:#475569;font-size:22px;line-height:1;cursor:pointer}
      .pwa-update-notice{top:16px;right:16px}
      .pwa-update-copy{display:grid;gap:3px;flex:1}
      @media(max-width:480px){.pwa-install-card,.pwa-update-notice{right:10px;width:calc(100vw - 20px)}.pwa-install-card{bottom:10px}.pwa-update-notice{top:10px}.pwa-install-card{gap:9px;padding:12px}.pwa-install-icon{width:44px;height:44px;flex-basis:44px}.pwa-install-action,.pwa-update-action{padding:8px 10px}}
    `
    document.head.appendChild(style)
  }

  function isInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  }

  function createInstallCard() {
    if (isInstalled() || readStorage(sessionStorage, installKey) === 'true') return
    installCard = document.createElement('aside')
    installCard.className = 'pwa-install-card'
    installCard.setAttribute('aria-label', 'Install CampusAura')
    installCard.innerHTML = `
      <img class="pwa-install-icon" src="icons/android-chrome-192x192.png" alt="CampusAura app icon">
      <div class="pwa-install-copy">
        <strong>Get the CampusAura app</strong>
        <span class="pwa-install-description">Install for quick access and an app-like experience.</span>
      </div>
      <button class="pwa-install-action" type="button">Install</button>
      <button class="pwa-install-close" type="button" aria-label="Dismiss install suggestion">&times;</button>
    `
    installDescription = installCard.querySelector('.pwa-install-description')
    installButton = installCard.querySelector('.pwa-install-action')
    installCard.querySelector('.pwa-install-close').addEventListener('click', () => {
      writeStorage(sessionStorage, installKey, 'true')
      installCard.remove()
    })
    installButton.addEventListener('click', async () => {
      if (showingInstallInstructions) {
        writeStorage(sessionStorage, installKey, 'true')
        installCard.remove()
        return
      }
      if (!deferredInstallPrompt) {
        showInstallInstructions()
        return
      }

      const prompt = deferredInstallPrompt
      deferredInstallPrompt = null
      try {
        await prompt.prompt()
        const choice = await prompt.userChoice
        if (choice.outcome === 'accepted') {
          installCard.remove()
        } else {
          installDescription.textContent = 'You can install CampusAura any time from your browser menu.'
          installButton.textContent = 'How to install'
        }
      } catch (error) {
        console.warn('CampusAura install prompt could not be opened:', error)
        showInstallInstructions()
      }
    })
    document.body.appendChild(installCard)
  }

  function showInstallInstructions() {
    showingInstallInstructions = true
    installDescription.textContent = 'Open your browser menu and choose “Install app” or “Add to Home Screen”.'
    installButton.textContent = 'Got it'
  }

  function showUpdateNotice(version) {
    document.querySelector('.pwa-update-notice')?.remove()
    const notice = document.createElement('aside')
    notice.className = 'pwa-update-notice'
    notice.setAttribute('role', 'status')
    notice.innerHTML = `
      <div class="pwa-update-copy">
        <strong>CampusAura has been updated</strong>
        <span>The latest version is ready. Refresh to load it now.</span>
      </div>
      <button class="pwa-update-action" type="button">Refresh</button>
      <button class="pwa-update-close" type="button" aria-label="Dismiss update notice">&times;</button>
    `
    notice.querySelector('.pwa-update-action').addEventListener('click', () => window.location.reload())
    notice.querySelector('.pwa-update-close').addEventListener('click', () => notice.remove())
    notice.dataset.version = version
    document.body.appendChild(notice)
  }

  function handleVersion(version) {
    if (!version || version === latestVersion) return
    latestVersion = version
    const previousVersion = readStorage(localStorage, versionKey)
    writeStorage(localStorage, versionKey, version)
    if ((previousVersion && previousVersion !== version) || (!previousVersion && hadController)) {
      showUpdateNotice(version)
    }
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredInstallPrompt = event
  })
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null
    installCard?.remove()
  })

  addPwaStyles()
  if (!isInstalled()) createInstallCard()

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'CAMPUSAURA_VERSION') handleVersion(event.data.version)
    })
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('./sw.js')
        registration.active?.postMessage({ type: 'CAMPUSAURA_GET_VERSION' })
        registration.update().catch((error) => {
          console.warn('CampusAura could not check for PWA updates:', error)
        })
      } catch (error) {
        console.warn('PWA service worker registration failed:', error)
      }
    })
  }
})()
