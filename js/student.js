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
    document.getElementById('statMyListings').textContent = state.listings.length
    document.getElementById('statAccom').textContent = state.accommodations.length

    const now = Date.now()
    const upcomingRsvps = state.rsvps.filter(item => {
      const date = new Date(item.events?.event_date).getTime()
      return Number.isFinite(date) && date >= now
    }).sort((left, right) => new Date(left.events.event_date) - new Date(right.events.event_date))
    document.getElementById('statRsvps').textContent = upcomingRsvps.length

    const savedMarkup = state.saved.map(item => {
      const accommodation = item.accommodations || {}
      return `<div class="admin-message"><div class="admin-message-head"><span class="admin-message-name">${escapeHtml(accommodation.title || 'Accommodation listing')}</span><span class="admin-message-meta">${escapeHtml(accommodation.location || 'Location unavailable')} · ${price(accommodation.price)}/mo</span></div><p class="admin-message-body">${escapeHtml(accommodation.description || '')}</p></div>`
    }).join('') || '<div class="admin-recent-empty">You have not saved any listings yet.</div>'
    document.getElementById('overviewSaved').innerHTML = savedMarkup

    const rsvpMarkup = upcomingRsvps.slice(0, 3).map(item => {
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

    document.getElementById('rsvpTable').innerHTML = upcomingRsvps.map(item => {
      const event = item.events || {}
      return `<tr><td><strong>${escapeHtml(event.title || 'Campus event')}</strong></td><td>${eventDate(event.event_date)}</td><td>${escapeHtml(event.location || 'Location unavailable')}</td><td><button class="admin-delete" data-action="unrsvp" data-id="${escapeHtml(item.id)}">Cancel RSVP</button></td></tr>`
    }).join('') || '<tr><td colspan="4" class="admin-recent-empty">No upcoming RSVPs. Explore events to find something to attend.</td></tr>'

    document.getElementById('myListingsTable').innerHTML = state.listings.map(item => {
      const status = item.status === 'draft' ? 'Pending review' : item.status || 'Unknown'
      return `<tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(item.category)}</td><td>${price(item.price)}</td><td><span class="status-pill status-${escapeHtml(item.status || 'unknown')}">${escapeHtml(status)}</span></td><td><div class="student-listing-actions"><button class="student-listing-edit-btn" type="button" data-student-listing-edit="${escapeHtml(item.id)}">Edit</button><button class="admin-delete" type="button" data-action="delete-listing" data-id="${escapeHtml(item.id)}">Delete</button></div></td></tr>`
    }).join('') || '<tr><td colspan="5" class="admin-recent-empty">You have not listed anything yet.</td></tr>'
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

  function setupSettings(user, profile) {
    const form = document.getElementById('studentSettingsForm')
    const status = document.getElementById('studentSettingsStatus')
    const preferences = profile.notification_preferences || {}
    const contentPreferences = profile.content_preferences || {}
    document.getElementById('studentSettingsName').value = profile.full_name || user.user_metadata?.full_name || ''
    document.getElementById('studentSettingsPhone').value = profile.phone || user.user_metadata?.phone || ''
    document.getElementById('studentSettingsEmail').value = user.email || ''
    document.getElementById('studentSettingsCampus').value = profile.campus_preference || user.user_metadata?.university || ''
    document.querySelectorAll('[name="studentContentPreference"]').forEach(input => {
      input.checked = contentPreferences[input.value] === true
    })
    document.querySelectorAll('[name="studentNotificationPreference"]').forEach(input => {
      input.checked = preferences[input.value] === true
    })

    form.addEventListener('submit', async event => {
      event.preventDefault()
      if (!form.reportValidity()) return
      const submit = form.querySelector('[type="submit"]')
      const notificationPreferences = {}
      const selectedContent = {}
      document.querySelectorAll('[name="studentNotificationPreference"]').forEach(input => {
        notificationPreferences[input.value] = input.checked
      })
      document.querySelectorAll('[name="studentContentPreference"]').forEach(input => {
        selectedContent[input.value] = input.checked
      })
      submit.disabled = true
      status.textContent = 'Saving your settings…'
      status.classList.remove('is-error')
      try {
        const { error } = await client.from('profiles').update({
          full_name: document.getElementById('studentSettingsName').value.trim(),
          phone: document.getElementById('studentSettingsPhone').value.trim(),
          campus_preference: document.getElementById('studentSettingsCampus').value.trim() || null,
          notification_preferences: notificationPreferences,
          content_preferences: selectedContent
        }).eq('id', user.id)
        if (error) throw error
        const name = document.getElementById('studentSettingsName').value.trim()
        document.querySelector('.admin-profile-name').textContent = name
        document.querySelector('.admin-profile-avatar').textContent = name.slice(0, 2).toUpperCase()
        const welcomeHeading = document.querySelector('#panel-overview .admin-panel-head h1')
        if (welcomeHeading) welcomeHeading.textContent = `Welcome back, ${name.split(' ')[0]}`
        status.textContent = 'Your profile and preferences have been saved.'
      } catch (error) {
        status.textContent = `Could not save settings: ${error.message}`
        status.classList.add('is-error')
      } finally {
        submit.disabled = false
      }
    })
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
      const action = button.dataset.action
      const confirmMessage = action === 'unsave'
        ? 'Remove this property from your saved listings?'
        : action === 'unrsvp'
          ? 'Cancel your RSVP for this event?'
          : 'Delete this marketplace listing? This cannot be undone.'
      if (!window.confirm(confirmMessage)) return
      const table = action === 'unsave' ? 'saved_listings' : action === 'unrsvp' ? 'rsvps' : 'marketplace_items'
      const ownerColumn = action === 'delete-listing' ? 'seller_id' : 'user_id'
      const { error } = await client.from(table).delete().eq('id', button.dataset.id).eq(ownerColumn, user.id)
      if (error) { setMessage(error.message, true); return }
      await loadData(user); render()
    })
  }

  function setupListingEditor(user) {
    const modal = document.getElementById('studentListingEditModal')
    const form = document.getElementById('studentListingEditForm')
    if (!modal || !form) return
    let returnFocus = null
    const close = () => {
      modal.classList.remove('is-open')
      modal.setAttribute('aria-hidden', 'true')
      document.body.classList.remove('modal-open')
      returnFocus?.focus()
      returnFocus = null
    }

    document.addEventListener('click', event => {
      const editButton = event.target.closest('[data-student-listing-edit]')
      if (editButton) {
        const item = state.listings.find(listing => String(listing.id) === editButton.dataset.studentListingEdit)
        if (!item) return
        returnFocus = editButton
        form.dataset.id = item.id
        document.getElementById('studentListingEditName').value = item.title || ''
        document.getElementById('studentListingEditCategory').value = item.category || 'Other'
        document.getElementById('studentListingEditType').value = item.listing_type || 'product'
        document.getElementById('studentListingEditPrice').value = item.price ?? ''
        document.getElementById('studentListingEditDescription').value = item.description || ''
        document.getElementById('studentListingEditStatus').textContent = ''
        modal.classList.add('is-open')
        modal.setAttribute('aria-hidden', 'false')
        document.body.classList.add('modal-open')
        document.getElementById('studentListingEditName').focus()
      } else if (event.target.closest('[data-student-edit-close]')) {
        close()
      }
    })

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modal.classList.contains('is-open')) close()
    })

    form.addEventListener('submit', async event => {
      event.preventDefault()
      const submit = form.querySelector('button[type="submit"]')
      const status = document.getElementById('studentListingEditStatus')
      submit.disabled = true
      status.textContent = 'Saving changes…'
      try {
        const { data, error } = await client.from('marketplace_items').update({
          title: document.getElementById('studentListingEditName').value.trim(),
          category: document.getElementById('studentListingEditCategory').value,
          listing_type: document.getElementById('studentListingEditType').value,
          price: Number(document.getElementById('studentListingEditPrice').value),
          description: document.getElementById('studentListingEditDescription').value.trim()
        }).eq('id', form.dataset.id).eq('seller_id', user.id).select('id').maybeSingle()
        if (error) throw error
        if (!data) throw new Error('This listing could not be found or is no longer yours to edit.')
        await loadData(user)
        render()
        setMessage('Listing updated.')
        close()
      } catch (error) {
        status.textContent = `Could not save listing: ${error.message}`
        setMessage(`Could not save listing: ${error.message}`, true)
      } finally {
        submit.disabled = false
      }
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
    const tabs = [...document.querySelectorAll('.admin-tab[role="tab"]')]
    const activate = tab => {
      tabs.forEach(item => {
        const selected = item === tab
        item.classList.toggle('active', selected)
        item.setAttribute('aria-selected', String(selected))
        item.tabIndex = selected ? 0 : -1
      })
      document.querySelectorAll('.admin-panel').forEach(panel => panel.classList.remove('active'))
      document.getElementById(`panel-${tab.dataset.tab}`)?.classList.add('active')
    }
    tabs.forEach(tab => tab.addEventListener('click', () => activate(tab)))
    document.getElementById('studentDashboardNav')?.addEventListener('keydown', event => {
      const currentIndex = tabs.indexOf(event.target.closest('[role="tab"]'))
      if (currentIndex < 0) return
      let nextIndex = currentIndex
      if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % tabs.length
      else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
      else if (event.key === 'Home') nextIndex = 0
      else if (event.key === 'End') nextIndex = tabs.length - 1
      else return
      event.preventDefault()
      tabs[nextIndex].focus()
      activate(tabs[nextIndex])
    })
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
      .select('full_name, email, phone, role, verification_status, account_status, campus_preference, notification_preferences, content_preferences')
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

    const name = profile.full_name || session.user.user_metadata?.full_name || session.user.email
    const displayName = name || 'Student'
    document.querySelector('.admin-profile-name').textContent = displayName
    document.querySelector('.admin-profile-sub').textContent = session.user.email
    document.querySelector('.admin-profile-avatar').textContent = displayName.slice(0, 2).toUpperCase()
    document.querySelector('.admin-chip').textContent = 'Student account'
    const welcomeHeading = document.querySelector('#panel-overview .admin-panel-head h1')
    if (welcomeHeading) {
      welcomeHeading.textContent = `Welcome back, ${displayName.split(' ')[0]} 👋`
    }
    try { await loadData(session.user); render(); setupTabs(); setupActions(session.user); setupListingEditor(session.user); setupSettings(session.user, profile); setupSignOut() }
    catch (error) { setMessage(`Could not load student data: ${error.message}`, true) }
  }

  document.addEventListener('DOMContentLoaded', init)
})()
