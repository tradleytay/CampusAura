(function () {
  const passwordRecoveryRedirect = 'https://campusaura.org/reset-password.html'
  const client = window.campusAuraSupabase
  const form = document.getElementById('authForm')
  const emailInput = document.getElementById('authEmail')
  const passwordInput = document.getElementById('authPassword')
  const submitButton = document.getElementById('authSubmit')
  const forgotPasswordButton = document.getElementById('forgotPassword')
  const status = document.getElementById('authStatus')

  function setStatus(message, isError) {
    status.textContent = message
    status.classList.toggle('is-error', Boolean(isError))
  }

  forgotPasswordButton.addEventListener('click', async () => {
    if (!emailInput.value.trim()) {
      setStatus('Enter your email address to request a password reset.', true)
      emailInput.focus()
      return
    }
    if (!emailInput.validity.valid) {
      emailInput.reportValidity()
      return
    }
    if (!client) {
      setStatus('Password recovery is unavailable right now.', true)
      return
    }

    forgotPasswordButton.disabled = true
    setStatus('Sending password reset instructions...')
    try {
      const { error } = await client.auth.resetPasswordForEmail(emailInput.value.trim(), {
        redirectTo: passwordRecoveryRedirect
      })
      if (error) throw error
      setStatus('If an account exists for that email, password reset instructions have been sent.')
    } catch (error) {
      setStatus(`Could not request a password reset: ${error.message}`, true)
    } finally {
      forgotPasswordButton.disabled = false
    }
  })

  async function routeAuthenticatedUser(user) {
    const { data: profile, error } = await client
      .from('profiles')
      .select('role, requested_role, verification_status, account_status')
      .eq('id', user.id)
      .single()

    if (error || !profile) {
      throw new Error(error?.message || 'Your account profile could not be loaded.')
    }

    if (profile.account_status === 'frozen' && profile.role !== 'admin') {
      window.location.href = 'account-frozen.html'
      return
    }

    const isProvider = profile.role === 'provider' || profile.requested_role === 'provider'
    const targetPage = profile.role === 'admin' ? 'admin.html' : isProvider ? 'provider.html' : 'student.html'
    window.location.href = targetPage
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!client) {
      setStatus('Authentication is unavailable right now.', true)
      return
    }

    submitButton.disabled = true
    setStatus('Signing you in...')

    try {
      const credentials = {
        email: emailInput.value.trim(),
        password: passwordInput.value
      }
      const { data, error } = await client.auth.signInWithPassword(credentials)
      if (error) throw error
      if (!data.user) throw new Error('Sign-in succeeded but no user account was returned.')

      localStorage.setItem('campusAura:lastActivity', String(Date.now()))
      await routeAuthenticatedUser(data.user)
    } catch (error) {
      setStatus(`Could not sign in: ${error.message}`, true)
    } finally {
      submitButton.disabled = false
    }
  })

  client?.auth.getSession().then(async ({ data, error }) => {
    if (error) {
      setStatus(`Could not check your sign-in status: ${error.message}`, true)
      return
    }
    if (!data.session) return
    await routeAuthenticatedUser(data.session.user).catch(error => {
      setStatus(`Could not load your account: ${error.message}`, true)
    })
  }).catch(error => {
    setStatus(`Could not check your sign-in status: ${error.message}`, true)
  })
})()
