(function () {
  const client = window.campusAuraSupabase
  const details = document.getElementById('frozenAccountDetails')
  const form = document.getElementById('frozenPasswordForm')
  const status = document.getElementById('frozenSettingsStatus')
  const submitButton = document.getElementById('frozenPasswordSubmit')
  const signOutButton = document.getElementById('frozenSettingsSignOut')
  const passwordInput = document.getElementById('frozenNewPassword')
  const confirmationInput = document.getElementById('frozenConfirmPassword')

  function setStatus(message, isError) {
    status.textContent = message
    status.classList.toggle('is-error', Boolean(isError))
  }

  function getDashboard(profile) {
    return profile.role === 'provider' || profile.requested_role === 'provider'
      ? 'provider.html'
      : 'student.html'
  }

  async function initialize() {
    if (!client) {
      setStatus('Account settings are unavailable right now. Please contact CampusAura.', true)
      return
    }

    const { data, error: sessionError } = await client.auth.getSession()
    if (sessionError) throw sessionError
    if (!data.session) {
      window.location.replace('auth.html')
      return
    }

    const { data: profile, error } = await client
      .from('profiles')
      .select('full_name, role, requested_role, account_status, frozen_reason')
      .eq('id', data.session.user.id)
      .single()
    if (error) throw error
    if (!profile) throw new Error('Your account profile was not returned.')

    if (profile.role === 'admin') {
      window.location.replace('admin.html')
      return
    }
    if (profile.account_status !== 'frozen') {
      window.location.replace(getDashboard(profile))
      return
    }

    document.getElementById('frozenSettingsName').textContent =
      profile.full_name || data.session.user.user_metadata?.full_name || 'Not provided'
    document.getElementById('frozenSettingsEmail').textContent =
      data.session.user.email || 'Not available'
    document.getElementById('frozenSettingsRole').textContent =
      profile.role === 'provider' || profile.requested_role === 'provider' ? 'Provider' : 'Student'
    if (profile.frozen_reason) {
      const reason = document.getElementById('frozenSettingsReason')
      reason.textContent = `Reason provided: ${profile.frozen_reason}`
      reason.hidden = false
    }
    details.hidden = false
    form.hidden = false
    setStatus('Only account review, password changes, support, and sign out are available while your account is frozen.')
  }

  form.addEventListener('submit', async event => {
    event.preventDefault()
    if (!form.reportValidity()) return
    if (passwordInput.value !== confirmationInput.value) {
      setStatus('The passwords do not match.', true)
      confirmationInput.focus()
      return
    }

    submitButton.disabled = true
    setStatus('Updating your password…')
    try {
      const { error } = await client.auth.updateUser({ password: passwordInput.value })
      if (error) throw error
      form.reset()
      document.querySelectorAll('[data-password-toggle]').forEach(button => {
        button.textContent = '👁️'
        button.setAttribute('aria-label', 'Show password')
        button.setAttribute('aria-pressed', 'false')
        document.getElementById(button.getAttribute('aria-controls')).type = 'password'
      })
      setStatus('Your password has been updated. Your account remains frozen; contact CampusAura if you need help restoring access.')
    } catch (error) {
      setStatus(`Could not update your password: ${error.message}`, true)
    } finally {
      submitButton.disabled = false
    }
  })

  signOutButton.addEventListener('click', async () => {
    if (!client) {
      setStatus('Sign out is unavailable right now. Please try again later.', true)
      return
    }
    signOutButton.disabled = true
    setStatus('Signing you out…')
    try {
      const { error } = await client.auth.signOut()
      if (error) throw error
      window.location.replace('auth.html')
    } catch (error) {
      setStatus(`Could not sign you out: ${error.message}`, true)
      signOutButton.disabled = false
    }
  })

  document.addEventListener('DOMContentLoaded', () => {
    initialize().catch(error => {
      setStatus(`Could not load your account settings: ${error.message}`, true)
    })
  })
})()
