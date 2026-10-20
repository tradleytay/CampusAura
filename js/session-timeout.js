(function () {
  const client = window.campusAuraSupabase
  const idleLimitMs = 30 * 60 * 1000
  const warningDurationMs = 2 * 60 * 1000
  const activityKey = 'campusAura:lastActivity'
  const activityEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove']
  let warningTimer
  let logoutTimer
  let lastActivity = Date.now()
  let warningElement

  if (!client) return

  function readLastActivity() {
    const storedValue = Number(localStorage.getItem(activityKey))
    return Number.isFinite(storedValue) && storedValue > 0 ? storedValue : Date.now()
  }

  function writeActivity() {
    lastActivity = Date.now()
    localStorage.setItem(activityKey, String(lastActivity))
    scheduleTimeouts()
  }

  function removeWarning() {
    if (!warningElement) return
    warningElement.remove()
    warningElement = null
  }

  function showWarning() {
    if (warningElement) return

    warningElement = document.createElement('div')
    warningElement.className = 'session-timeout-warning'
    warningElement.setAttribute('role', 'alertdialog')
    warningElement.setAttribute('aria-live', 'assertive')
    warningElement.innerHTML = `
      <strong>Your session is about to expire</strong>
      <span>You will be signed out soon because there has been no activity.</span>
      <button type="button">Stay signed in</button>
    `
    warningElement.querySelector('button').addEventListener('click', writeActivity)
    document.body.appendChild(warningElement)
  }

  async function signOutForInactivity() {
    removeWarning()
    const { error } = await client.auth.signOut()
    if (error) console.error('Automatic sign-out failed:', error)
    window.location.href = 'auth.html?reason=inactivity'
  }

  function scheduleTimeouts() {
    window.clearTimeout(warningTimer)
    window.clearTimeout(logoutTimer)
    removeWarning()

    const elapsed = Date.now() - lastActivity
    const warningDelay = Math.max(0, idleLimitMs - warningDurationMs - elapsed)
    const logoutDelay = Math.max(0, idleLimitMs - elapsed)

    warningTimer = window.setTimeout(showWarning, warningDelay)
    logoutTimer = window.setTimeout(signOutForInactivity, logoutDelay)
  }

  function handleActivity() {
    if (Date.now() - lastActivity < 1000) return
    writeActivity()
  }

  async function init() {
    const { data, error } = await client.auth.getSession()
    if (error) {
      console.error('Could not check session inactivity:', error)
      return
    }
    if (!data.session) return

    lastActivity = readLastActivity()
    activityEvents.forEach(eventName => {
      document.addEventListener(eventName, handleActivity, { passive: true })
    })
    window.addEventListener('storage', event => {
      if (event.key !== activityKey || !event.newValue) return
      lastActivity = Number(event.newValue) || Date.now()
      scheduleTimeouts()
    })
    scheduleTimeouts()
  }

  init()
})()
