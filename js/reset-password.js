(function () {
  const client = window.campusAuraSupabase
  const form = document.getElementById('resetPasswordForm')
  const passwordInput = document.getElementById('newPassword')
  const confirmationInput = document.getElementById('confirmPassword')
  const submitButton = document.getElementById('resetSubmit')
  const status = document.getElementById('resetStatus')

  function setStatus(message, isError) {
    status.textContent = message
    status.classList.toggle('is-error', Boolean(isError))
  }

  async function initializeResetForm() {
    if (!client) {
      setStatus('Password recovery is unavailable right now. Please try again later.', true)
      return
    }

    try {
      const { data, error } = await client.auth.getSession()
      if (error) throw error
      if (!data.session) {
        setStatus('This password reset link is invalid or has expired. Request a new one from the sign-in page.', true)
        return
      }

      form.hidden = false
      setStatus('Enter and confirm your new password.')
    } catch (error) {
      setStatus(`Could not validate your password reset link: ${error.message}`, true)
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (passwordInput.value !== confirmationInput.value) {
      setStatus('The passwords do not match.', true)
      confirmationInput.focus()
      return
    }
    if (!client) {
      setStatus('Password recovery is unavailable right now.', true)
      return
    }

    submitButton.disabled = true
    setStatus('Updating your password...')
    try {
      const { error } = await client.auth.updateUser({ password: passwordInput.value })
      if (error) throw error

      const { error: signOutError } = await client.auth.signOut({ scope: 'local' })
      if (signOutError) {
        form.hidden = true
        setStatus(`Your password was updated, but we could not end this recovery session: ${signOutError.message}. Close this page, then sign in with your new password.`, true)
        return
      }

      form.hidden = true
      setStatus('Your password has been updated. You can now sign in with your new password.')
    } catch (error) {
      setStatus(`Could not update your password: ${error.message}`, true)
    } finally {
      submitButton.disabled = false
    }
  })

  initializeResetForm()
})()
