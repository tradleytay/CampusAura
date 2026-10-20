// Student dashboard backed by Supabase.
(function () {
  const client = window.campusAuraSupabase
  const state = { saved: [], rsvps: [], listings: [], accommodations: [], verification: null }

  function setMessage(message, isError) {
    let element = document.getElementById('studentStatus')
    if (!element) {
      element = document.createElement('p')
      element.id = 'studentStatus'
      element.className = 'contact-status'
      document.querySelector('.admin-main')?.prepend(element)
    }
    element.textContent = message
    element.style.color = isError ? 'var(--danger)' : ''
  }

  function price(value) { return `K${Number(value || 0).toLocaleString()}` }
  function eventDate(value) { return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[character]))
  }

  async function loadData(user) {
    const [saved, rsvps, listings, accommodations, verification] = await Promise.all([
      client.from('saved_listings').select('id, accommodation_id, accommodations(id, title, location, price, description)').eq('user_id', user.id),
      client.from('rsvps').select('id, event_id, events(id, title, event_date, location)').eq('user_id', user.id),
      client.from('marketplace_items').select('*').eq('seller_id', user.id).order('created_at', { ascending: false }),
      client.from('accommodations').select('id').eq('status', 'published'),
      client.from('verification_documents').select('id, status, rejection_reason, created_at').eq('user_id', user.id).eq('requested_role', 'student').order('created_at', { ascending: false }).limit(1)
    ])
    const failed = [saved, rsvps, listings, accommodations, verification].find(result => result.error)
    if (failed) throw failed.error
    state.saved = saved.data || []
    state.rsvps = rsvps.data || []
    state.listings = listings.data || []
    state.accommodations = accommodations.data || []
    state.verification = verification.data?.[0] || null
  }

  function render() {
    document.getElementById('statSaved').textContent = state.saved.length
    document.getElementById('statRsvps').textContent = state.rsvps.length
    document.getElementById('statMyListings').textContent = state.listings.length
    document.getElementById('statAccom').textContent = state.accommodations.length

    const savedMarkup = state.saved.map(item => {
      const accommodation = item.accommodations || {}
      return `<div class="admin-message"><div class="admin-message-head"><span class="admin-message-name">${escapeHtml(accommodation.title || 'Accommodation listing')}</span><span class="admin-message-meta">${escapeHtml(accommodation.location || 'Location unavailable')} · ${price(accommodation.price)}/mo</span></div><p class="admin-message-body">${escapeHtml(accommodation.description || '')}</p></div>`
    }).join('') || '<div class="admin-recent-empty">You have not saved any listings yet.</div>'
    document.getElementById('overviewSaved').innerHTML = savedMarkup

    const upcomingRsvps = state.rsvps.filter(item => item.events && new Date(item.events.event_date) >= new Date()).slice(0, 3)
    const rsvpMarkup = upcomingRsvps.map(item => {
      const event = item.events
      return `<div class="dashboard-list-item"><span class="dashboard-list-icon">🎟️</span><div><strong>${escapeHtml(event.title || 'Campus event')}</strong><span>${eventDate(event.event_date)} · ${escapeHtml(event.location || 'Location unavailable')}</span></div></div>`
    }).join('') || '<div class="admin-recent-empty">No upcoming events yet. Explore what is happening on campus.</div>'
    document.getElementById('overviewRsvps').innerHTML = rsvpMarkup

    const listingMarkup = state.listings.slice(0, 4).map(item => `<div class="dashboard-market-item"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.category)} · ${price(item.price)}</span></div>`).join('') || '<div class="admin-recent-empty">You have not listed anything yet.</div>'
    document.getElementById('overviewListings').innerHTML = listingMarkup

    document.getElementById('savedTable').innerHTML = state.saved.map(item => {
      const accommodation = item.accommodations || {}
      return `<tr><td><strong>${escapeHtml(accommodation.title || 'Accommodation listing')}</strong></td><td>${escapeHtml(accommodation.location || 'Location unavailable')}</td><td>${price(accommodation.price)}/mo</td><td><button class="admin-delete" data-action="unsave" data-id="${escapeHtml(item.id)}">Unsave</button></td></tr>`
    }).join('') || '<tr><td colspan="4" class="admin-recent-empty">No saved listings yet.</td></tr>'

    document.getElementById('rsvpTable').innerHTML = state.rsvps.map(item => {
      const event = item.events || {}
      return `<tr><td><strong>${escapeHtml(event.title || 'Campus event')}</strong></td><td>${eventDate(event.event_date)}</td><td>${escapeHtml(event.location || 'Location unavailable')}</td><td><button class="admin-delete" data-action="unrsvp" data-id="${escapeHtml(item.id)}">Cancel RSVP</button></td></tr>`
    }).join('') || '<tr><td colspan="4" class="admin-recent-empty">No RSVPs yet.</td></tr>'

    document.getElementById('myListingsTable').innerHTML = state.listings.map(item => `<tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(item.category)}</td><td>${price(item.price)}</td></tr>`).join('') || '<tr><td colspan="3" class="admin-recent-empty">You have not listed any items yet.</td></tr>'
    renderVerification()
  }

  function renderVerification() {
    const status = document.getElementById('studentVerificationStatus')
    const form = document.getElementById('studentVerificationForm')
    const record = state.verification
    const badge = document.getElementById('studentVerificationBadge')
    const isVerified = record?.status === 'approved'
    if (badge) {
      badge.textContent = isVerified ? 'Verified' : 'Unverified'
      badge.classList.toggle('is-verified', isVerified)
      badge.classList.toggle('is-unverified', !isVerified)
      badge.title = record?.status === 'pending' ? 'Your student ID is awaiting review.' : isVerified ? 'Your student ID was approved.' : 'Submit a student ID to request verification.'
    }
    status.classList.remove('is-error')
    if (record?.status === 'approved') {
      status.textContent = 'Your student ID has been reviewed. Student status is verified.'
      form.hidden = true
    } else if (record?.status === 'pending') {
      status.textContent = 'Your student ID is awaiting review. Your CampusAura account remains active.'
      form.hidden = true
    } else if (record?.status === 'rejected') {
      status.textContent = `Your student ID was not approved${record.rejection_reason ? `: ${record.rejection_reason}` : ''}. You may submit a new file.`
      status.classList.add('is-error')
      form.hidden = false
    } else {
      status.textContent = 'Student verification is optional. Submit a current student ID if you want a verified student status.'
      form.hidden = false
    }
  }
  function setupActions(user) {
    const verificationForm = document.getElementById('studentVerificationForm')
    verificationForm?.addEventListener('submit', async event => {
      event.preventDefault()
      if (!verificationForm.reportValidity()) return
      const file = document.getElementById('studentIdDocument').files[0]
      const submit = document.getElementById('studentVerificationSubmit')
      const status = document.getElementById('studentVerificationStatus')
      if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) {
        status.textContent = 'Student ID must be a PDF, JPG, or PNG file.'
        status.classList.add('is-error')
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        status.textContent = 'Student ID must be smaller than 5 MB.'
        status.classList.add('is-error')
        return
      }
      submit.disabled = true
      status.classList.remove('is-error')
      status.textContent = 'Submitting your student ID securely...'
      let uploadPath
      try {
        const extension = file.name.split('.').pop()?.toLowerCase() || 'bin'
        const fileId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
        uploadPath = `${user.id}/student-${fileId}.${extension}`
        const { error: uploadError } = await client.storage.from('verification-documents').upload(uploadPath, file, {
          cacheControl: '3600', contentType: file.type, upsert: false
        })
        if (uploadError) throw uploadError
        const { error } = await client.from('verification_documents').insert({
          user_id: user.id,
          requested_role: 'student',
          identity_document_path: null,
          student_document_path: uploadPath
        })
        if (error) throw error
        uploadPath = null
        document.getElementById('studentIdConsent').checked = false
        document.getElementById('studentIdDocument').value = ''
        await loadData(user)
        render()
      } catch (error) {
        if (uploadPath) {
          const { error: cleanupError } = await client.storage.from('verification-documents').remove([uploadPath])
          if (cleanupError) console.error('Could not remove incomplete student verification upload:', cleanupError)
        }
        status.textContent = `Could not submit student ID: ${error.message}`
        status.classList.add('is-error')
      } finally {
        submit.disabled = false
      }
    })
    document.addEventListener('click', async event => {
      const button = event.target.closest('.admin-delete')
      if (!button) return
      const table = button.dataset.action === 'unsave' ? 'saved_listings' : 'rsvps'
      const { error } = await client.from(table).delete().eq('id', button.dataset.id).eq('user_id', user.id)
      if (error) { setMessage(error.message, true); return }
      await loadData(user); render()
    })
  }

  function setupSignOut() {
    const signOutBtn = document.getElementById('signOutBtn')
    if (!signOutBtn) return
    signOutBtn.addEventListener('click', async () => {
      await client.auth.signOut()
      window.location.href = 'auth.html'
    })
  }

  function setupTabs() {
    document.querySelectorAll('.admin-tab').forEach(tab => tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(item => { item.classList.remove('active'); item.setAttribute('aria-selected', 'false') })
      document.querySelectorAll('.admin-panel').forEach(panel => panel.classList.remove('active'))
      tab.classList.add('active'); tab.setAttribute('aria-selected', 'true')
      document.getElementById(`panel-${tab.dataset.tab}`)?.classList.add('active')
    }))
    document.querySelectorAll('[data-tab-target]').forEach(button => button.addEventListener('click', () => {
      document.querySelector(`.admin-tab[data-tab="${button.dataset.tabTarget}"]`)?.click()
    }))
  }

  async function init() {
    if (!client) { setMessage('Supabase is unavailable.', true); return }
    const { data: { session } } = await client.auth.getSession()
    if (!session) { window.location.href = 'auth.html'; return }

    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('role, verification_status, account_status')
      .eq('id', session.user.id)
      .single()

    if (profileError || !profile || (profile.role !== 'admin' && profile.role !== 'student')) {
      await client.auth.signOut()
      window.location.href = 'auth.html'
      return
    }
    if (profile.account_status === 'frozen' && profile.role !== 'admin') {
      window.location.replace('account-frozen.html')
      return
    }

    const name = session.user.user_metadata?.full_name || session.user.email
    const displayName = name || 'Student'
    document.querySelector('.admin-profile-name').textContent = displayName
    document.querySelector('.admin-profile-sub').textContent = session.user.email
    document.querySelector('.admin-profile-avatar').textContent = displayName.slice(0, 2).toUpperCase()
    document.querySelector('.admin-chip').textContent = 'Student account'
    const welcomeHeading = document.querySelector('#panel-overview .admin-panel-head h1')
    if (welcomeHeading) {
      welcomeHeading.textContent = `Welcome back, ${displayName.split(' ')[0]} 👋`
    }
    try { await loadData(session.user); render(); setupTabs(); setupActions(session.user); setupSignOut() }
    catch (error) { setMessage(`Could not load student data: ${error.message}`, true) }
  }

  document.addEventListener('DOMContentLoaded', init)
})()
