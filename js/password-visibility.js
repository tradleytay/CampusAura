document.querySelectorAll('[data-password-toggle]').forEach(button => {
  const input = document.getElementById(button.getAttribute('aria-controls'))
  if (!input) {
    console.error('Password visibility toggle has no matching input:', button)
    return
  }

  button.addEventListener('click', () => {
    const showPassword = input.type === 'password'
    input.type = showPassword ? 'text' : 'password'
    button.setAttribute('aria-pressed', String(showPassword))
    button.setAttribute('aria-label', `${showPassword ? 'Hide' : 'Show'} password`)
    button.textContent = showPassword ? '🙈' : '👁️'
  })
})
