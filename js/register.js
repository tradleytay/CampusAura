(function () {
  const form = document.getElementById('registerForm')
  const submitButton = document.getElementById('registerSubmit')
  const status = document.getElementById('registerStatus')
  const successPanel = document.getElementById('registrationSuccess')
  const successRole = document.getElementById('successRole')
  const successTitle = document.getElementById('registrationSuccessTitle')
  const successMessage = document.getElementById('registrationSuccessMessage')
  const nextAction = document.getElementById('registrationNextAction')
  const studentEmailInput = document.getElementById('registerEmail')
  const providerEmailInput = document.getElementById('registerProviderEmail')
  const providerListingType = document.getElementById('providerListingType')
  const universitySelect = document.getElementById('registerUniversity')
  const otherUniversityField = document.getElementById('otherUniversityField')
  const otherUniversityInput = document.getElementById('registerOtherUniversity')
  const studentFields = document.getElementById('studentRegistrationFields')
  const providerFields = document.getElementById('providerRegistrationFields')
  const phoneInput = document.getElementById('registerPhone')
  const countryCode = document.getElementById('registerCountryCode')
  const heading = document.getElementById('registerHeading')
  const steps = document.querySelector('.auth-steps')
  const signInLink = document.getElementById('registerSignInLink')
  const providerVerificationStep = document.getElementById('providerVerificationStep')
  const registrationIntro = document.getElementById('registrationIntroText')
  const successNextSteps = document.querySelector('.registration-next-steps')
  const client = window.campusAuraSupabase
  const emailConfirmationRedirect = 'https://campusaura.org/auth.html'

  const browserRegion = navigator.language.match(/-([A-Z]{2})(?:-|$)/i)?.[1]?.toUpperCase()
  const regionalOption = Array.from(countryCode.options).find(option => option.dataset.region === browserRegion)
  if (regionalOption) countryCode.value = regionalOption.value

  phoneInput.addEventListener('input', () => {
    const digits = phoneInput.value.replace(/\D/g, '').slice(0, 9)
    if (phoneInput.value !== digits) phoneInput.value = digits
    phoneInput.setCustomValidity(digits && digits.length !== 9 ? 'Enter exactly 9 digits.' : '')
  })

  function selectedRole() {
    return document.querySelector('input[name="accountType"]:checked')?.value || 'student'
  }

  function updateRoleFlow() {
    const isProvider = selectedRole() === 'provider'
    studentFields.hidden = isProvider
    studentFields.disabled = isProvider
    providerFields.hidden = !isProvider
    providerFields.disabled = !isProvider
    studentEmailInput.disabled = isProvider
    providerEmailInput.disabled = !isProvider
    providerListingType.disabled = !isProvider
    providerVerificationStep.hidden = !isProvider
    steps.style.gridTemplateColumns = isProvider ? 'repeat(3, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))'
    registrationIntro.textContent = isProvider
      ? 'Create an account with your email. After confirming it and signing in, submit your NRC for review before using your selected dashboard tools.'
      : 'Use your UNILUS student email and select your campus. Student ID verification remains optional after you sign in.'
  }

  document.querySelectorAll('input[name=accountType]').forEach(input => input.addEventListener('change', updateRoleFlow))
  universitySelect.addEventListener('change', () => {
    const isOther = universitySelect.value === 'other'
    otherUniversityField.hidden = !isOther
    otherUniversityInput.disabled = !isOther
    otherUniversityInput.required = isOther
    if (!isOther) otherUniversityInput.value = ''
  })
  updateRoleFlow()

  function setStatus(message, isError = false) {
    status.textContent = message
    status.classList.toggle('is-error', isError)
  }

  form.addEventListener('submit', async event => {
    event.preventDefault()
    const role = selectedRole()
    const name = document.getElementById('registerName').value.trim()
    const emailInput = role === 'student' ? studentEmailInput : providerEmailInput
    const email = emailInput.value.trim().toLowerCase()
    const localPhone = phoneInput.value
    const phone = `${countryCode.value}${localPhone}`
    const password = document.getElementById('registerPassword').value
    const confirmation = document.getElementById('registerPasswordConfirm').value
    if (!form.reportValidity()) return
    if (role === 'student' && !/@stud\.unilus\.ac\.zm$/i.test(email)) {
      setStatus('Student accounts require an address ending in @stud.unilus.ac.zm. If you do not have one, please contact an administrator via CampusAura support.', true)
      studentEmailInput.focus()
      return
    }
    if (role === 'student' && universitySelect.value === 'other' && !otherUniversityInput.value.trim()) {
      setStatus('Enter the name of your university.', true)
      otherUniversityInput.focus()
      return
    }
    if (!/^\d{9}$/.test(localPhone)) {
      phoneInput.setCustomValidity('Enter exactly 9 digits.')
      phoneInput.reportValidity()
      phoneInput.focus()
      return
    }
    if (password !== confirmation) {
      setStatus('Your passwords do not match.', true)
      document.getElementById('registerPasswordConfirm').focus()
      return
    }
    if (!document.getElementById('legalConsent').checked) {
      setStatus('Please agree to the Terms of Service and acknowledge the Privacy Policy.', true)
      return
    }
    if (!client) {
      setStatus('Registration is unavailable right now. Please try again later.', true)
      return
    }

    submitButton.disabled = true
    setStatus('Creating your account...')
    try {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name,
            phone,
            requested_role: role,
            ...(role === 'provider' ? { provider_listing_type: providerListingType.value } : {}),
            ...(role === 'student' ? {
              university: universitySelect.value === 'other' ? otherUniversityInput.value.trim() : universitySelect.value,
              university_choice: universitySelect.value
            } : {}),
            terms_accepted_at: new Date().toISOString(),
            terms_version: '2026-09-27',
            privacy_policy_version: '2026-09-27'
          },
          emailRedirectTo: emailConfirmationRedirect
        }
      })
      if (error) throw error
      if (!data.user) throw new Error('The account could not be created. Please try again.')
      if (data.user.identities?.length === 0) {
        throw new Error('An account may already exist with this email. Try signing in or resetting your password.')
      }

      successRole.textContent = role === 'student' ? 'Student' : 'Provider'
      if (role === 'student') {
        successNextSteps.textContent = 'Student ID review is optional and does not affect your account access.'
        if (data.session) {
          successTitle.textContent = 'Account created'
          successMessage.textContent = 'Your student account is ready. You can start using CampusAura now.'
          nextAction.href = 'student.html'
          nextAction.textContent = 'Go to student dashboard'
        } else {
          successTitle.textContent = 'Check your email'
          successMessage.textContent = 'If this email can be registered, we will send a confirmation link. Confirm your email, then sign in to start using CampusAura.'
          nextAction.href = 'auth.html'
          nextAction.textContent = 'Go to sign in'
        }
      } else if (data.session) {
        successNextSteps.textContent = 'Your dashboard is available now. Submit your NRC and wait for approval before creating or changing listings or events.'
        successTitle.textContent = 'Account created'
        successMessage.textContent = 'Your dashboard is ready. Your selected actions unlock after your application is approved.'
        nextAction.href = 'provider.html'
        nextAction.textContent = 'Open provider dashboard'
      } else {
        successNextSteps.textContent = 'Confirm your email, then sign in to access your dashboard. Submit your NRC and wait for approval before creating listings or events.'
        successTitle.textContent = 'Check your email'
        successMessage.textContent = 'If this email can be registered, we will send a confirmation link. After confirming, sign in to access your provider dashboard.'
        nextAction.href = 'auth.html'
        nextAction.textContent = 'Go to sign in'
      }
      form.hidden = true
      heading.hidden = true
      steps.hidden = true
      signInLink.hidden = true
      successPanel.hidden = false
      requestAnimationFrame(() => successTitle.focus())
    } catch (error) {
      console.error('CampusAura account creation failed:', error)
      const duplicateEmail = /already registered|already exists|duplicate key|unique constraint/i.test(error.message)
      setStatus(duplicateEmail
        ? 'This email is already registered. Sign in or reset your password instead.'
        : `Could not create your account: ${error.message}`, true)
    } finally {
      submitButton.disabled = false
    }
  })
})()
