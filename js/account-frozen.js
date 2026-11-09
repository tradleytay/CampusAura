(function () {
  const client = window.campusAuraSupabase
  const status = document.getElementById('frozenStatus')
  const signOut = document.getElementById('frozenSignOut')

  function setStatus(message, isError) {
    status.textContent = message
    status.classList.toggle('is-error', Boolean(isError))
  }

  async function init() {
    signOut.addEventListener('click', async () => {
      if (!client) {
        setStatus('Sign out is unavailable right now. Please try again later.', true)
        return
      }

      signOut.disabled = true
      setStatus('Signing you out…')
      try {
        const { error } = await client.auth.signOut()
        if (error) throw error
        window.location.replace('auth.html')
      } catch (error) {
        setStatus(`Could not sign you out: ${error.message}`, true)
        signOut.disabled = false
      }
    })

    if (!client) {
      setStatus('Account status is unavailable. Please contact CampusAura.', true)
      return
    }
    const { data, error: sessionError } = await client.auth.getSession()
    if (sessionError) throw sessionError
    const { session } = data
    if (!session) {
      window.location.replace('auth.html')
      return
    }
    const { data: profile, error } = await client
      .from('profiles')
      .select('full_name, role, requested_role, account_status, frozen_reason')
      .eq('id', session.user.id)
      .single()
    if (error) throw error
    if (!profile) throw new Error('Your account profile was not returned.')
    if (profile.role === 'admin') {
      window.location.replace('admin.html')
      return
    }
    if (profile.account_status !== 'frozen') {
      const isProvider = profile.role === 'provider' || profile.requested_role === 'provider'
      window.location.replace(isProvider ? 'provider.html' : 'student.html')
      return
    }
    setStatus('Your account access is currently paused. Contact our team for help.')
    if (profile.frozen_reason) {
      document.getElementById('frozenReason').textContent = profile.frozen_reason
      document.getElementById('frozenReasonWrap').hidden = false
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(error => {
      setStatus(`Could not check your account status: ${error.message}`, true)
    })
  })
})()
