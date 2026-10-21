// Provider dashboard backed by Supabase.
(function () {
  const client = window.campusAuraSupabase
  const state = { accommodations: [], marketplace: [], services: [], events: [], analytics: [] }
  let providerApproved = false
  let providerListingAccess = null
  let providerIsAdmin = false
  const imageFiles = { accom: [], market: [], event: [] }
  const maxImageSize = 5 * 1024 * 1024
  const maxImageCount = 10
  let providerGalleryReturnFocus = null

  function setMessage(message, isError) {
    let element = document.getElementById('providerStatus')
    if (!element) {
      element = document.createElement('p')
      element.id = 'providerStatus'
      element.className = 'contact-status'
      document.querySelector('.admin-main')?.prepend(element)
    }
    element.textContent = message
    element.style.color = isError ? 'var(--danger)' : ''
  }

  function formatPrice(value) {
    return `K${Number(value || 0).toLocaleString()}`
  }

  function canManageSection(section) {
    return providerIsAdmin || (providerListingAccess === null
      ? section !== 'events'
      : providerListingAccess.includes(section))
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[character]))
  }

  function renderImagePreviews(key) {
    const preview = document.getElementById(`${key}ImagePreview`)
    const dropzone = document.querySelector(`[data-image-picker="${key}"] .provider-dropzone`)
    if (!preview) return
    preview.replaceChildren()
    imageFiles[key].forEach((selection, index) => {
      const card = document.createElement('div')
      card.className = 'provider-image-preview-item'
      const image = document.createElement('img')
      image.src = selection.previewUrl
      image.alt = selection.file.name
      const name = document.createElement('span')
      name.textContent = selection.file.name
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'provider-image-remove'
      remove.textContent = 'Remove'
      remove.setAttribute('aria-label', `Remove ${selection.file.name}`)
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(selection.previewUrl)
        imageFiles[key].splice(index, 1)
        renderImagePreviews(key)
      })
      card.append(image, name, remove)
      preview.appendChild(card)
    })
    preview.hidden = imageFiles[key].length === 0
    dropzone?.classList.toggle('has-image', imageFiles[key].length > 0)
  }

  function setupImagePicker(key) {
    const picker = document.querySelector(`[data-image-picker="${key}"]`)
    const input = document.getElementById(`${key}ImageFile`)
    const dropzone = picker?.querySelector('.provider-dropzone')
    if (!picker || !input || !dropzone) return

    const addFiles = files => {
      const incoming = [...(files || [])]
      if (!incoming.length) return
      if (imageFiles[key].length + incoming.length > maxImageCount) {
        setMessage(`Choose up to ${maxImageCount} photos for one listing.`, true)
        return
      }
      const invalid = incoming.find(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > maxImageSize)
      if (invalid) {
        setMessage(invalid.size > maxImageSize
          ? `${invalid.name} is larger than 5 MB. Choose a smaller photo.`
          : `${invalid.name} is not supported. Choose JPG, PNG, or WebP photos.`, true)
        return
      }
      const existing = new Set(imageFiles[key].map(item => `${item.file.name}:${item.file.size}:${item.file.lastModified}`))
      incoming.forEach(file => {
        const signature = `${file.name}:${file.size}:${file.lastModified}`
        if (existing.has(signature)) return
        existing.add(signature)
        imageFiles[key].push({ file, previewUrl: URL.createObjectURL(file) })
      })
      renderImagePreviews(key)
      setMessage(`${imageFiles[key].length} photo${imageFiles[key].length === 1 ? '' : 's'} selected.`)
    }

    input.addEventListener('change', () => {
      addFiles(input.files)
      input.value = ''
    })
    dropzone.addEventListener('click', () => input.click())
    dropzone.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        input.click()
      }
    })
    dropzone.addEventListener('dragover', event => {
      event.preventDefault()
      dropzone.classList.add('is-dragging')
    })
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('is-dragging'))
    dropzone.addEventListener('drop', event => {
      event.preventDefault()
      dropzone.classList.remove('is-dragging')
      addFiles(event.dataTransfer.files)
    })
    picker.addEventListener('paste', event => addFiles(event.clipboardData.files))
    document.addEventListener('paste', event => {
      if (document.activeElement?.closest(`[data-image-picker="${key}"]`)) {
        addFiles(event.clipboardData.files)
      }
    })
  }

  function clearImageSelection(key) {
    imageFiles[key].forEach(selection => URL.revokeObjectURL(selection.previewUrl))
    imageFiles[key] = []
    renderImagePreviews(key)
  }

  async function removeUploadedImages(uploads) {
    const paths = uploads.map(upload => upload.path)
    if (!paths.length) return
    const { error } = await client.storage.from('listing-images').remove(paths)
    if (error) console.warn('Could not clean up uploaded provider photos:', error)
  }

  async function uploadImages(key, userId, prefix) {
    const uploads = []
    try {
      for (const { file } of imageFiles[key]) {
        const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        const uniqueId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const path = `${userId}/${prefix}-${uniqueId}.${extension}`
        const { error } = await client.storage.from('listing-images').upload(path, file, {
          cacheControl: '3600',
          contentType: file.type,
          upsert: false
        })
        if (error) throw error
        const { data } = client.storage.from('listing-images').getPublicUrl(path)
        uploads.push({ path, url: data.publicUrl })
      }
      return uploads
    } catch (error) {
      await removeUploadedImages(uploads)
      throw error
    }
  }

  function getProviderImageUrls(item) {
    const urls = [...new Set((Array.isArray(item.image_urls) ? item.image_urls : []).map(url => String(url || '').trim()).filter(Boolean))]
    const primary = String(item.image_url || '').trim()
    if (primary && !urls.includes(primary)) urls.unshift(primary)
    return urls.length ? urls : ['images/room1.jpeg']
  }

  function safeProviderImageUrl(value) {
    const fallback = 'images/room1.jpeg'
    try {
      const url = new URL(String(value || ''), window.location.href)
      return url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === window.location.origin) ? url.href : fallback
    } catch {
      return fallback
    }
  }

  function openProviderGallery(kind, id, trigger) {
    const collection = kind === 'accommodation' ? state.accommodations : state.marketplace
    const item = collection.find(entry => String(entry.id) === String(id))
    if (!item) return
    const modal = document.getElementById('providerGalleryModal')
    const title = document.getElementById('providerGalleryTitle')
    const mainImage = document.getElementById('providerGalleryMainImage')
    const thumbs = document.getElementById('providerGalleryThumbs')
    const urls = getProviderImageUrls(item)
    providerGalleryReturnFocus = trigger || document.activeElement
    title.textContent = `${item.title || 'Listing'} · ${urls.length} photo${urls.length === 1 ? '' : 's'}`
    mainImage.src = safeProviderImageUrl(urls[0])
    mainImage.alt = item.title || 'Listing photo'
    thumbs.replaceChildren()
    if (urls.length > 1) {
      urls.forEach((url, index) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = `provider-gallery-thumb${index === 0 ? ' is-active' : ''}`
        button.dataset.galleryIndex = String(index)
        button.setAttribute('aria-label', `Show photo ${index + 1}`)
        button.setAttribute('aria-current', String(index === 0))
        const image = document.createElement('img')
        image.src = safeProviderImageUrl(url)
        image.alt = ''
        button.appendChild(image)
        thumbs.appendChild(button)
      })
    }
    modal.dataset.galleryUrls = JSON.stringify(urls)
    modal.classList.add('is-open')
    modal.setAttribute('aria-hidden', 'false')
    document.body.classList.add('modal-open')
    modal.querySelector('.provider-gallery-close')?.focus()
  }

  function closeProviderGallery() {
    const modal = document.getElementById('providerGalleryModal')
    modal.classList.remove('is-open')
    modal.setAttribute('aria-hidden', 'true')
    document.body.classList.remove('modal-open')
    providerGalleryReturnFocus?.focus()
    providerGalleryReturnFocus = null
  }

  function setupProviderGallery() {
    const modal = document.getElementById('providerGalleryModal')
    if (!modal) return
    modal.addEventListener('click', event => {
      if (event.target.closest('[data-provider-gallery-close]')) {
        closeProviderGallery()
        return
      }
      const button = event.target.closest('[data-gallery-index]')
      if (!button) return
      const urls = JSON.parse(modal.dataset.galleryUrls || '[]')
      const url = urls[Number(button.dataset.galleryIndex)]
      if (!url) return
      const image = document.getElementById('providerGalleryMainImage')
      image.src = safeProviderImageUrl(url)
      modal.querySelectorAll('[data-gallery-index]').forEach(thumb => {
        const active = thumb === button
        thumb.classList.toggle('is-active', active)
        thumb.setAttribute('aria-current', String(active))
      })
    })
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !modal.classList.contains('is-open')) return
      closeProviderGallery()
    })
    document.addEventListener('click', event => {
      const button = event.target.closest('[data-provider-gallery]')
      if (button) openProviderGallery(button.dataset.providerGallery, button.dataset.id, button)
    })
  }

  async function loadData(user) {
    const [accommodations, marketplace, events, analytics] = await Promise.all([
      client.from('accommodations').select('*').eq('owner_id', user.id).order('created_at', { ascending: false }),
      client.from('marketplace_items').select('*').eq('seller_id', user.id).order('created_at', { ascending: false }),
      client.from('events').select('*').eq('organizer_id', user.id).order('event_date', { ascending: true }),
      client.rpc('get_provider_listing_analytics')
    ])
    if (accommodations.error || marketplace.error || events.error || analytics.error) {
      throw accommodations.error || marketplace.error || events.error || analytics.error
    }
    state.accommodations = accommodations.data || []
    state.marketplace = marketplace.data || []
    state.events = events.data || []
    state.services = []
    state.analytics = analytics.data || []
  }

  function render() {
    const all = [...state.accommodations, ...state.marketplace, ...state.services]
    const analyticsById = new Map(state.analytics.map(item => [item.entity_id, item]))
    const totalViews = state.analytics.reduce((total, item) => total + Number(item.view_count || 0), 0)
    const totalInquiries = state.analytics.reduce((total, item) => total + Number(item.inquiry_count || 0), 0)
    const active = all.filter(item => item.status === 'published').length
    const activeAccommodations = state.accommodations.filter(item => item.status === 'published').length
    const pendingAccommodations = state.accommodations.filter(item => item.status === 'pending').length
    const activeMarketplace = state.marketplace.filter(item => item.status === 'published').length + state.services.filter(item => item.status === 'published').length
    const pendingMarketplace = state.marketplace.filter(item => item.status === 'pending').length + state.services.filter(item => item.status === 'pending').length
    const soldMarketplace = state.marketplace.filter(item => item.status === 'sold').length
    const accommodationInquiries = state.accommodations.reduce((total, item) => total + Number(analyticsById.get(item.id)?.inquiry_count || 0), 0)
    const marketplaceInquiries = state.marketplace.reduce((total, item) => total + Number(analyticsById.get(item.id)?.inquiry_count || 0), 0)
    document.getElementById('statListings').textContent = all.length
    document.getElementById('statActive').textContent = active
    document.getElementById('statViews').textContent = totalViews.toLocaleString()
    document.getElementById('statInquiries').textContent = totalInquiries.toLocaleString()
    document.getElementById('analyticsListings').textContent = all.length
    document.getElementById('analyticsViews').textContent = totalViews.toLocaleString()
    document.getElementById('analyticsInquiries').textContent = totalInquiries.toLocaleString()
    document.getElementById('analyticsConversion').textContent = `${totalViews ? (totalInquiries / totalViews * 100).toFixed(1) : '0.0'}%`
    document.getElementById('overviewAccomCount').textContent = activeAccommodations
    document.getElementById('overviewAccomPending').textContent = pendingAccommodations
    document.getElementById('overviewAccomInquiries').textContent = accommodationInquiries.toLocaleString()
    document.getElementById('overviewMarketCount').textContent = activeMarketplace
    document.getElementById('overviewMarketPending').textContent = pendingMarketplace
    document.getElementById('overviewMarketSold').textContent = soldMarketplace
    document.getElementById('overviewMarketInquiries').textContent = marketplaceInquiries.toLocaleString()

    const analyticsBars = document.getElementById('analyticsBars')
    analyticsBars.replaceChildren()
    if (!all.length) {
      const empty = document.createElement('p')
      empty.className = 'admin-recent-empty'
      empty.textContent = 'Create a listing to start tracking its views and contact clicks.'
      analyticsBars.appendChild(empty)
    } else {
      const listingMetrics = all.map(item => ({
        title: item.title,
        views: Number(analyticsById.get(item.id)?.view_count || 0)
      }))
      const maxViews = Math.max(1, ...listingMetrics.map(item => item.views))
      listingMetrics.forEach(item => {
        const row = document.createElement('div')
        row.className = 'provider-analytics-row'
        const title = document.createElement('span')
        title.className = 'provider-analytics-title'
        title.textContent = item.title
        const track = document.createElement('div')
        track.className = 'provider-analytics-track'
        const fill = document.createElement('div')
        fill.className = 'provider-analytics-fill'
        fill.style.width = `${item.views / maxViews * 100}%`
        track.appendChild(fill)
        const count = document.createElement('strong')
        count.textContent = item.views.toLocaleString()
        row.append(title, track, count)
        analyticsBars.appendChild(row)
      })
    }

    document.getElementById('accomTable').innerHTML = state.accommodations.map(item => `
      <tr><td><strong>${escapeHtml(item.title)}</strong><br><span class="muted small">${escapeHtml(item.description || '')}</span></td>
      <td>${escapeHtml(item.location)}</td><td>${formatPrice(item.price)}/mo</td><td><button class="provider-gallery-open" type="button" data-provider-gallery="accommodation" data-id="${escapeHtml(item.id)}">View photos (${getProviderImageUrls(item).length})</button></td><td><span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td><td>${Number(analyticsById.get(item.id)?.view_count || 0).toLocaleString()}</td>
      <td>${providerApproved ? `<button class="provider-edit" type="button" data-edit-kind="accommodation" data-id="${escapeHtml(item.id)}">Edit</button><button class="admin-delete" data-kind="accommodation" data-id="${escapeHtml(item.id)}">Delete</button>` : ''}</td></tr>
    `).join('') || '<tr><td colspan="7" class="admin-recent-empty">No accommodations yet.</td></tr>'

    const offers = state.marketplace.map(item => ({
      ...item,
      offerType: item.listing_type === 'service' ? 'Service' : 'Product'
    }))
    document.getElementById('marketTable').innerHTML = offers.map(item => `
      <tr><td><strong>${escapeHtml(item.title)}</strong></td><td>${escapeHtml(item.offerType || 'Product')}</td>
      <td>${formatPrice(item.price)}</td><td><button class="provider-gallery-open" type="button" data-provider-gallery="marketplace" data-id="${escapeHtml(item.id)}">View photos (${getProviderImageUrls(item).length})</button></td><td><span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td><td>${Number(analyticsById.get(item.id)?.view_count || 0).toLocaleString()}</td>
      <td>${providerApproved ? `<button class="provider-edit" type="button" data-edit-kind="marketplace" data-id="${escapeHtml(item.id)}">Edit</button><button class="admin-delete" data-kind="marketplace" data-id="${escapeHtml(item.id)}">Delete</button>` : ''}</td></tr>
    `).join('') || '<tr><td colspan="7" class="admin-recent-empty">No products or services yet.</td></tr>'

    document.getElementById('providerEventTable').innerHTML = state.events.map(item => {
      const eventDate = new Date(item.event_date)
      const formattedDate = Number.isNaN(eventDate.getTime()) ? 'Date unavailable' : eventDate.toLocaleString()
      const status = item.status === 'draft' ? 'Pending review' : item.status
      return `<tr><td><strong>${escapeHtml(item.title)}</strong><br><span class="muted small">${escapeHtml(item.description || '')}</span></td>
        <td>${escapeHtml(formattedDate)}</td><td>${escapeHtml(item.organizer_name || '')}</td>
        <td><span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(status)}</span></td>
        <td>${providerApproved ? `<button class="admin-delete" data-kind="event" data-id="${escapeHtml(item.id)}">Delete</button>` : ''}</td></tr>`
    }).join('') || '<tr><td colspan="5" class="admin-recent-empty">No events yet.</td></tr>'

    document.getElementById('overviewInquiries').textContent = totalInquiries
      ? `${totalInquiries.toLocaleString()} contact clicks across your listings.`
      : 'No contact clicks yet. Listing activity updates here in real time.'
    document.getElementById('inboxList').innerHTML = '<div class="admin-recent-empty">Per-listing click counts appear in Analytics. Direct messages are not available yet.</div>'
    document.getElementById('inboxCount').textContent = '(' + totalInquiries.toLocaleString() + ' total)'
  }

  function setupForms(user) {
    setupImagePicker('accom')
    setupImagePicker('market')
    setupImagePicker('event')
    document.getElementById('formAccom').addEventListener('submit', async event => {
      event.preventDefault()
      const button = event.target.querySelector('button[type="submit"]')
      let uploads = []
      button.disabled = true
      try {
        uploads = await uploadImages('accom', user.id, 'accommodation')
        const imageUrls = uploads.length ? uploads.map(upload => upload.url) : ['images/room1.jpeg']
        const { error } = await client.from('accommodations').insert({
          owner_id: user.id,
          title: document.getElementById('accomTitle').value.trim(),
          location: document.getElementById('accomLocation').value.trim(),
          price: Number(document.getElementById('accomPrice').value),
          image_url: imageUrls[0],
          image_urls: imageUrls,
          description: document.getElementById('accomDesc').value.trim(),
          status: 'pending'
        })
        if (error) throw error
        event.target.reset()
        clearImageSelection('accom')
        setMessage('Accommodation and photos submitted for review.')
        await loadData(user)
        render()
      } catch (error) {
        await removeUploadedImages(uploads)
        setMessage(`Could not submit accommodation: ${error.message}`, true)
      } finally {
        button.disabled = false
      }
    })

    document.getElementById('formMarket').addEventListener('submit', async event => {
      event.preventDefault()
      const button = event.target.querySelector('button[type="submit"]')
      let uploads = []
      button.disabled = true
      try {
        uploads = await uploadImages('market', user.id, 'offer')
        const imageUrls = uploads.length ? uploads.map(upload => upload.url) : ['images/books.jpeg']
        const offerType = document.getElementById('marketOfferType').value
        const { error } = await client.from('marketplace_items').insert({
          seller_id: user.id,
          title: document.getElementById('marketTitle').value.trim(),
          seller_display_name: document.getElementById('marketDisplayName').value.trim() || null,
          price: Number(document.getElementById('marketPrice').value),
          listing_type: offerType,
          category: document.getElementById('marketCategory').value.trim(),
          image_url: imageUrls[0],
          image_urls: imageUrls,
          description: document.getElementById('marketDesc').value.trim(),
          status: 'pending'
        })
        if (error) throw error
        event.target.reset()
        clearImageSelection('market')
        setMessage(`${offerType === 'service' ? 'Service' : 'Marketplace item'} and photos submitted for review.`)
        await loadData(user)
        render()
      } catch (error) {
        await removeUploadedImages(uploads)
        setMessage(`Could not submit listing: ${error.message}`, true)
      } finally {
        button.disabled = false
      }
    })

    document.getElementById('formEvent').addEventListener('submit', async event => {
      event.preventDefault()
      const button = event.target.querySelector('button[type="submit"]')
      const eventDate = new Date(document.getElementById('providerEventDate').value)
      if (Number.isNaN(eventDate.getTime())) {
        setMessage('Enter a valid event date and time.', true)
        return
      }
      let uploads = []
      button.disabled = true
      try {
        uploads = await uploadImages('event', user.id, 'event')
        const imageUrls = uploads.length ? uploads.map(upload => upload.url) : ['images/event1.jpeg']
        const { error } = await client.from('events').insert({
          organizer_id: user.id,
          organizer_name: document.getElementById('providerEventOrganizer').value.trim(),
          title: document.getElementById('providerEventTitle').value.trim(),
          event_date: eventDate.toISOString(),
          location: document.getElementById('providerEventLocation').value.trim(),
          description: document.getElementById('providerEventDescription').value.trim(),
          image_url: imageUrls[0],
          image_urls: imageUrls,
          event_type: document.getElementById('providerEventType').value,
          status: 'draft'
        })
        if (error) throw error
        event.target.reset()
        clearImageSelection('event')
        setMessage('Event submitted for administrator review.')
        try {
          await loadData(user)
          render()
        } catch (refreshError) {
          setMessage(`Event was submitted, but the dashboard could not refresh: ${refreshError.message}`, true)
        }
      } catch (error) {
        await removeUploadedImages(uploads)
        setMessage(`Could not submit event: ${error.message}`, true)
      } finally {
        button.disabled = false
      }
    })
  }

  function setupActions(user) {
    document.addEventListener('click', async event => {
      const button = event.target.closest('.admin-delete')
      if (!button) return
      const table = button.dataset.kind === 'accommodation'
        ? 'accommodations'
        : button.dataset.kind === 'event' ? 'events' : 'marketplace_items'
      const ownerColumn = button.dataset.kind === 'accommodation'
        ? 'owner_id'
        : button.dataset.kind === 'event' ? 'organizer_id' : 'seller_id'
      const { error } = await client.from(table).delete().eq('id', button.dataset.id).eq(ownerColumn, user.id)
      if (error) { setMessage(error.message, true); return }
      await loadData(user); render()
    })
  }

  function setupListingEditor(user) {
    const modal = document.getElementById('providerEditModal')
    const form = document.getElementById('providerEditForm')
    if (!modal || !form) return

    const close = () => {
      modal.classList.remove('is-open')
      modal.setAttribute('aria-hidden', 'true')
      document.body.classList.remove('modal-open')
    }

    document.addEventListener('click', event => {
      const editButton = event.target.closest('[data-edit-kind]')
      if (editButton) {
        const kind = editButton.dataset.editKind
        const section = kind === 'accommodation' ? 'accommodation' : 'marketplace'
        if (!providerApproved || !canManageSection(section)) {
          setMessage('Your account is not approved to edit this listing.', true)
          return
        }
        const items = kind === 'accommodation' ? state.accommodations : state.marketplace
        const item = items.find(listing => listing.id === editButton.dataset.id)
        if (!item) {
          setMessage('Could not find that listing. Refresh the dashboard and try again.', true)
          return
        }

        form.dataset.kind = kind
        form.dataset.id = item.id
        document.getElementById('providerEditTitle').textContent = kind === 'accommodation' ? 'Edit accommodation' : 'Edit product or service'
        document.getElementById('providerEditName').value = item.title || ''
        document.getElementById('providerEditLocation').value = item.location || ''
        document.getElementById('providerEditPrice').value = item.price ?? ''
        document.getElementById('providerEditDescription').value = item.description || ''
        document.getElementById('providerEditSeller').value = item.seller_display_name || ''
        document.getElementById('providerEditCategory').value = item.category || 'Other'
        document.getElementById('providerEditType').value = item.listing_type || 'product'
        document.getElementById('providerEditAccommodationFields').hidden = kind !== 'accommodation'
        document.getElementById('providerEditMarketplaceFields').hidden = kind !== 'marketplace'
        document.getElementById('providerEditLocation').required = kind === 'accommodation'
        document.getElementById('providerEditCategory').required = kind === 'marketplace'
        document.getElementById('providerEditStatus').textContent = ''
        modal.classList.add('is-open')
        modal.setAttribute('aria-hidden', 'false')
        document.body.classList.add('modal-open')
        document.getElementById('providerEditName').focus()
        return
      }

      if (event.target.closest('[data-provider-edit-close]')) close()
    })

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modal.classList.contains('is-open')) close()
    })

    form.addEventListener('submit', async event => {
      event.preventDefault()
      const kind = form.dataset.kind
      const table = kind === 'accommodation' ? 'accommodations' : 'marketplace_items'
      const ownerColumn = kind === 'accommodation' ? 'owner_id' : 'seller_id'
      const updates = {
        title: document.getElementById('providerEditName').value.trim(),
        price: Number(document.getElementById('providerEditPrice').value),
        description: document.getElementById('providerEditDescription').value.trim()
      }
      if (kind === 'accommodation') {
        updates.location = document.getElementById('providerEditLocation').value.trim()
      } else {
        updates.seller_display_name = document.getElementById('providerEditSeller').value.trim() || null
        updates.category = document.getElementById('providerEditCategory').value
        updates.listing_type = document.getElementById('providerEditType').value
      }

      const submit = form.querySelector('button[type="submit"]')
      const status = document.getElementById('providerEditStatus')
      submit.disabled = true
      status.textContent = 'Saving changes…'
      try {
        const { data, error } = await client.from(table)
          .update(updates)
          .eq('id', form.dataset.id)
          .eq(ownerColumn, user.id)
          .select('id')
          .maybeSingle()
        if (error) throw error
        if (!data) throw new Error('The listing was not found or is no longer available to edit.')
        await loadData(user)
        render()
        setMessage('Listing changes saved.')
        close()
      } catch (error) {
        status.textContent = `Could not save changes: ${error.message}`
        setMessage(`Could not save listing changes: ${error.message}`, true)
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

  function setupRealtime(user) {
    let refreshing = false
    let refreshAgain = false
    const refresh = async () => {
      if (refreshing) {
        refreshAgain = true
        return
      }
      refreshing = true
      do {
        refreshAgain = false
        try {
          await loadData(user)
          render()
        } catch (error) {
          setMessage(`Could not refresh live analytics: ${error.message}`, true)
        }
      } while (refreshAgain)
      refreshing = false
    }

    client.channel(`provider-analytics-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'accommodations',
        filter: `owner_id=eq.${user.id}`
      }, refresh)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'marketplace_items',
        filter: `seller_id=eq.${user.id}`
      }, refresh)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'events',
        filter: `organizer_id=eq.${user.id}`
      }, refresh)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'analytics_events'
      }, refresh)
      .subscribe((status, error) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setMessage(`Live analytics connection failed${error?.message ? `: ${error.message}` : '.'}`, true)
        }
      })
  }

  function showPanel(tabName, feedName) {
    document.querySelectorAll('.admin-tab').forEach(tab => {
      const isActive = tab.dataset.tab === tabName && (!feedName || tab.dataset.feedTarget === feedName || tab.dataset.tab === 'overview')
      tab.classList.toggle('active', isActive)
      tab.setAttribute('aria-selected', String(isActive))
    })
    document.querySelectorAll('.admin-panel').forEach(panel => panel.classList.toggle('active', panel.id === `panel-${tabName}`))
    if (tabName === 'listings' && feedName) showFeed(feedName)
  }

  function showFeed(feedName) {
    const section = feedName
    if (!canManageSection(section)) return
    document.querySelectorAll('.provider-feed').forEach(feed => {
      feed.style.display = feed.id === `feed-${feedName}` ? 'block' : 'none'
    })
    document.querySelectorAll('.type-btn').forEach(button => button.classList.toggle('active', button.dataset.feed === feedName))
  }

  function setupNavigation() {
    document.querySelectorAll('.admin-tab').forEach(tab => tab.addEventListener('click', () => showPanel(tab.dataset.tab, tab.dataset.feedTarget)))
    document.querySelectorAll('.type-btn').forEach(button => button.addEventListener('click', () => {
      showPanel('listings', button.dataset.feed)
    }))
    document.querySelectorAll('[data-tab-target]').forEach(button => button.addEventListener('click', () => {
      showPanel(button.dataset.tabTarget, button.dataset.feedTarget)
    }))
    const initialFeed = ['accommodation', 'marketplace', 'events'].find(canManageSection)
    if (initialFeed) showFeed(initialFeed)
  }

  async function init() {
    if (!client) { setMessage('Supabase is unavailable.', true); return }
    const { data: { session } } = await client.auth.getSession()
    if (!session) { window.location.href = 'auth.html'; return }
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('full_name, role, requested_role, verification_status, account_status, provider_listing_access')
      .eq('id', session.user.id)
      .single()
    const isAdmin = profile?.role === 'admin'
    const isProvider = profile?.role === 'provider' || profile?.requested_role === 'provider'
    if (profile?.account_status === 'frozen' && !isAdmin) {
      window.location.replace('account-frozen.html')
      return
    }
    if (profileError || !profile || (!isAdmin && !isProvider)) {
      document.querySelector('.admin-main').innerHTML = `
        <section class="admin-card provider-access-blocked">
          <span class="provider-kicker">Provider access</span>
          <h1>Approval required</h1>
          <p>Your provider application must be approved by an administrator before you can access this workspace.</p>
          <a class="btn btn-primary" href="index.html">Return to CampusAura</a>
        </section>
      `
      return
    }
    providerApproved = isAdmin || profile.verification_status === 'approved'
    providerIsAdmin = isAdmin
    providerListingAccess = Array.isArray(profile.provider_listing_access) ? profile.provider_listing_access : null
    document.querySelectorAll('[data-provider-section]').forEach(element => {
      element.hidden = !canManageSection(element.dataset.providerSection)
    })
    const canManageAccommodation = canManageSection('accommodation')
    const canManageMarketplace = canManageSection('marketplace')
    document.getElementById('formAccom').hidden = !canManageAccommodation
    document.getElementById('accommodationScopeNotice').hidden = canManageAccommodation
    document.getElementById('formMarket').hidden = !canManageMarketplace
    document.getElementById('marketplaceScopeNotice').hidden = canManageMarketplace
    const verificationBadge = document.getElementById('providerVerificationBadge')
    verificationBadge.textContent = providerApproved ? 'Verified' : 'Unverified'
    verificationBadge.classList.toggle('is-verified', providerApproved)
    verificationBadge.classList.toggle('is-unverified', !providerApproved)
    verificationBadge.title = providerApproved ? 'Your provider account has been approved.' : 'Provider approval is required to verify this account.'
    if (!providerApproved) {
      document.body.classList.add('provider-readonly')
      document.getElementById('providerApprovalBanner').hidden = false
      document.getElementById('providerToolsLocked').hidden = false
      const status = profile.verification_status
      document.getElementById('providerApprovalTitle').textContent = status === 'rejected' ? 'Provider approval not granted' : 'Your dashboard is available while we review your application'
      document.getElementById('providerApprovalMessage').textContent = status === 'rejected'
        ? 'Your provider application was not approved. Contact CampusAura support for next steps. Listing actions remain locked.'
        : 'You can view your dashboard and listing status. Submit your NRC if you have not already; creating or changing listings unlocks after approval.'
      if (status === 'rejected') {
        const action = document.getElementById('providerVerificationAction')
        action.href = 'contact.html'
        action.textContent = 'Contact CampusAura'
      }
    }
    const name = profile.full_name || session.user.user_metadata?.full_name || session.user.email
    const displayName = name || 'Provider'
    document.getElementById('providerName').textContent = displayName
    document.getElementById('providerSub').textContent = session.user.email
    const isEventOrganizer = providerListingAccess?.length === 1 && providerListingAccess[0] === 'events'
    document.getElementById('providerRoleChip').textContent = isEventOrganizer ? 'Events organizer' : 'Provider account'
    document.getElementById('providerAvatar').textContent = displayName.slice(0, 2).toUpperCase()
    document.getElementById('settingsName').textContent = displayName
    document.getElementById('settingsEmail').textContent = session.user.email || 'Not available'
    document.getElementById('settingsAccountType').textContent = isEventOrganizer
      ? 'Events organizer'
      : providerListingAccess?.includes('accommodation') && providerListingAccess.includes('marketplace')
        ? 'Property owner and seller'
        : providerListingAccess?.includes('accommodation')
          ? 'Property owner'
          : providerListingAccess?.includes('marketplace')
            ? 'Seller / service provider'
            : 'Administrator'
    const welcomeHeading = document.querySelector('#panel-overview .admin-panel-head h1')
    if (welcomeHeading) {
      welcomeHeading.textContent = `Welcome back, ${displayName.split(' ')[0]} 👋`
    }
    const sectionsSubtitle = document.querySelector('#panel-overview .admin-panel-head .section-subtitle')
    if (sectionsSubtitle) {
      const availableSections = providerListingAccess || ['accommodation', 'marketplace']
      const sectionLabels = availableSections.map(section => ({
        accommodation: 'properties',
        marketplace: 'products and services',
        events: 'events'
      }[section]))
      sectionsSubtitle.textContent = isEventOrganizer
        ? 'Manage your campus events. Event submissions are reviewed before publishing.'
        : `Manage your ${sectionLabels.join(' and ')} listings. Contact an administrator to add another section.`
    }
    try {
      await loadData(session.user)
      render()
      setupProviderGallery()
      setupNavigation()
      if (providerApproved) {
        setupForms(session.user)
        setupActions(session.user)
        setupListingEditor(session.user)
      }
      setupSignOut()
      setupRealtime(session.user)
    }
    catch (error) { setMessage(`Could not load provider data: ${error.message}`, true) }
  }

  document.addEventListener('DOMContentLoaded', init)
})()
