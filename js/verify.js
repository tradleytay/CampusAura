(function () {
  const client = window.campusAuraSupabase
  const form = document.getElementById('verificationForm')
  const status = document.getElementById('verificationStatus')
  const identityDocument = document.getElementById('verifyIdentityDocument')
  const submitButton = document.getElementById('verificationSubmit')
  const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png'])
  const maxFileSize = 5 * 1024 * 1024
  let userId
  let requestedRole

  function setStatus(message, isError = false) {
    status.textContent = message
    status.classList.toggle('is-error', isError)
  }

  function validateFile(file, label) {
    if (!file) return `${label} is required.`
    if (!allowedTypes.has(file.type)) return `${label} must be a PDF, JPG, or PNG file.`
    if (file.size > maxFileSize) return `${label} must be smaller than 5 MB.`
    return ''
  }

  async function upload(file, label) {
    const extension = file.name.split('.').pop()?.toLowerCase() || 'bin'
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const path = `${userId}/${label}-${id}.${extension}`
    const { error } = await client.storage.from('verification-documents').upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false
    })
    if (error) throw error
    return path
  }

  async function initialize() {
    if (!client) throw new Error('Account verification is unavailable right now.')
    const { data: { session }, error: sessionError } = await client.auth.getSession()
    if (sessionError) throw sessionError
    if (!session) {
      window.location.replace('auth.html')
      return
    }

    userId = session.user.id
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('role, requested_role, verification_status')
      .eq('id', userId)
      .single()
    if (profileError) throw profileError
    if (profile.role === 'admin' || profile.verification_status === 'approved') {
      window.location.replace(profile.role === 'admin' ? 'admin.html' : profile.role === 'provider' ? 'provider.html' : 'student.html')
      return
    }
    if (profile.role !== 'provider' && profile.requested_role !== 'provider') {
      window.location.replace('student.html')
      return
    }
    if (profile.verification_status === 'rejected') {
      await client.auth.signOut()
      window.location.replace('auth.html')
      return
    }

    requestedRole = profile.requested_role

    const { data: existing, error: verificationError } = await client
      .from('verification_documents')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .limit(1)
    if (verificationError) throw verificationError
    if (existing.length) {
      form.hidden = true
      setStatus('Your documents have been submitted and are awaiting administrator review.')
      return
    }

    form.hidden = false
    setStatus('Your provider account is awaiting review. Submit your NRC to continue.')
  }

  form.addEventListener('submit', async event => {
    event.preventDefault()
    const identityError = validateFile(identityDocument.files[0], 'NRC')
    if (identityError) {
      setStatus(identityError, true)
      return
    }
    if (!document.getElementById('verifyDocumentConsent').checked) {
      setStatus('Please confirm the document verification consent.', true)
      return
    }

    submitButton.disabled = true
    setStatus('Uploading your NRC securely...')
    const uploadedPaths = []
    try {
      const identityPath = await upload(identityDocument.files[0], 'identity')
      uploadedPaths.push(identityPath)

      const { error } = await client.from('verification_documents').insert({
        user_id: userId,
        requested_role: requestedRole,
        identity_document_path: identityPath
      })
      if (error) throw error

      form.hidden = true
      try {
        if (window.campusAuraEmail?.sendRegistrationEmail) {
          await window.campusAuraEmail.sendRegistrationEmail()
        } else {
          throw new Error('Email notification service is unavailable.')
        }
        setStatus('Your documents were submitted for review. A confirmation email has been sent.')
      } catch (emailError) {
        console.error('Registration notification could not be sent:', emailError)
        setStatus(`Your documents were submitted for review, but the confirmation email could not be sent: ${emailError.message}`)
      }
    } catch (error) {
      if (uploadedPaths.length) {
        const { error: cleanupError } = await client.storage.from('verification-documents').remove(uploadedPaths)
        if (cleanupError) console.error('Could not remove incomplete verification uploads:', cleanupError)
      }
      setStatus(`Document submission failed: ${error.message}. Please try again.`, true)
    } finally {
      submitButton.disabled = false
    }
  })

  initialize().catch(error => {
    setStatus(`Could not prepare verification: ${error.message}`, true)
  })
})()
