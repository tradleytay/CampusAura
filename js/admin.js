// Admin dashboard backed by Supabase.
(function () {
  const client = window.campusAuraSupabase
  const state = { accommodations: [], marketplace: [], events: [], messages: [], outbox: [], profiles: [], verification: [], analytics: null }
  const adminImageSelections = { accom: [], market: [], event: [] }
  const maxAdminImages = 10
  const maxAdminImageSize = 5 * 1024 * 1024
  const modalReturnFocus = new WeakMap()

  function setMessage(message, isError) {
    let element = document.getElementById('adminStatus')
    if (!element) {
      element = document.createElement('p')
      element.id = 'adminStatus'
      element.className = 'contact-status'
      element.setAttribute('role', 'status')
      element.setAttribute('aria-live', 'polite')
      element.setAttribute('aria-atomic', 'true')
      document.querySelector('.admin-main')?.prepend(element)
    }
    element.textContent = message
    element.style.color = isError ? 'var(--danger)' : '#0f172a'
    element.style.fontWeight = '600'
  }

  function price(value) { return `K${Number(value || 0).toLocaleString()}` }
  function date(value) { return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[character]))
  }

  function formatCount(value) {
    return Number(value || 0).toLocaleString()
  }

  function renderAdminImagePreviews(key) {
    const preview = document.getElementById(`${key}ImagePreviews`)
    if (!preview) return
    preview.replaceChildren()
    adminImageSelections[key].forEach((selection, index) => {
      const card = document.createElement('div')
      card.className = 'admin-image-preview'
      const image = document.createElement('img')
      image.src = selection.previewUrl
      image.alt = selection.file.name
      const name = document.createElement('span')
      name.textContent = selection.file.name
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.setAttribute('aria-label', `Remove ${selection.file.name}`)
      remove.textContent = '×'
      remove.addEventListener('click', () => {
        URL.revokeObjectURL(selection.previewUrl)
        adminImageSelections[key].splice(index, 1)
        renderAdminImagePreviews(key)
      })
      card.append(image, name, remove)
      preview.appendChild(card)
    })
  }

  function setupAdminImagePicker(key) {
    const picker = document.querySelector(`[data-admin-image-picker="${key}"]`)
    const input = document.getElementById(`${key}Images`)
    const dropzone = picker?.querySelector('.admin-image-dropzone')
    if (!picker || !input || !dropzone) return

    const addFiles = files => {
      const incoming = [...(files || [])]
      if (!incoming.length) return
      if (adminImageSelections[key].length + incoming.length > maxAdminImages) {
        setMessage(`Choose up to ${maxAdminImages} images for one listing.`, true)
        return
      }
      const invalid = incoming.find(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > maxAdminImageSize)
      if (invalid) {
        setMessage(invalid.size > maxAdminImageSize
          ? `${invalid.name} is larger than 5 MB. Choose smaller images.`
          : `${invalid.name} is not a supported image. Choose JPG, PNG, or WebP files.`, true)
        return
      }
      const existing = new Set(adminImageSelections[key].map(item => `${item.file.name}:${item.file.size}:${item.file.lastModified}`))
      incoming.forEach(file => {
        const signature = `${file.name}:${file.size}:${file.lastModified}`
        if (existing.has(signature)) return
        existing.add(signature)
        adminImageSelections[key].push({ file, previewUrl: URL.createObjectURL(file) })
      })
      renderAdminImagePreviews(key)
      setMessage(`${adminImageSelections[key].length} image${adminImageSelections[key].length === 1 ? '' : 's'} selected.`)
    }

    input.addEventListener('change', () => {
      addFiles(input.files)
      input.value = ''
    })
    dropzone.addEventListener('click', () => input.click())
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
  }

  function clearAdminImageSelection(key) {
    adminImageSelections[key].forEach(selection => URL.revokeObjectURL(selection.previewUrl))
    adminImageSelections[key] = []
    renderAdminImagePreviews(key)
  }

  async function removeAdminImageUploads(uploads) {
    const paths = uploads.map(upload => upload.path)
    if (!paths.length) return
    const { error } = await client.storage.from('listing-images').remove(paths)
    if (error) console.warn('Could not clean up uploaded listing images:', error)
  }

  async function uploadAdminImages(key, userId, prefix) {
    const uploads = []
    try {
      for (const { file } of adminImageSelections[key]) {
        const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        const uniqueId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const path = `${userId}/admin-${prefix}-${uniqueId}.${extension}`
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
      await removeAdminImageUploads(uploads)
      throw error
    }
  }

  function setAnalyticsStatus(message, isError = false) {
    const element = document.getElementById('analyticsStatus')
    element.textContent = message
    element.classList.toggle('is-error', isError)
  }

  function getModalFocusables(modal) {
    const dialog = modal.querySelector('[role="dialog"]')
    return [...dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(element => !element.closest('[hidden]') && element.getClientRects().length > 0)
  }

  function openAdminModal(modal, returnFocusTarget, initialFocusTarget) {
    modalReturnFocus.set(modal, returnFocusTarget || document.activeElement)
    modal.classList.add('is-open')
    modal.setAttribute('aria-hidden', 'false')
    document.body.classList.add('modal-open')
    const focusTarget = initialFocusTarget || getModalFocusables(modal)[0] || modal.querySelector('[role="dialog"]')
    focusTarget?.focus()
  }

  function closeAdminModal(modal) {
    if (!modal?.classList.contains('is-open')) return
    modal.classList.remove('is-open')
    modal.setAttribute('aria-hidden', 'true')
    const anotherModalIsOpen = [...document.querySelectorAll('.admin-details-modal.is-open')].length > 0
    if (!anotherModalIsOpen) document.body.classList.remove('modal-open')

    const returnTarget = modalReturnFocus.get(modal)
    modalReturnFocus.delete(modal)
    const focusTarget = returnTarget?.isConnected && returnTarget.getClientRects().length
      ? returnTarget
      : document.querySelector('.admin-tab[aria-selected="true"]')
    focusTarget?.focus()
  }

  function trapAdminModalFocus(modal, event) {
    const focusables = getModalFocusables(modal)
    const dialog = modal.querySelector('[role="dialog"]')
    if (!focusables.length) {
      event.preventDefault()
      dialog?.focus()
      return
    }

    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (!dialog.contains(document.activeElement)) {
      event.preventDefault()
      const edge = event.shiftKey ? last : first
      edge.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  async function loadAnalytics() {
    const period = Number(document.getElementById('analyticsPeriod').value)
    setAnalyticsStatus('Loading analytics…')
    const { data, error } = await client.rpc('get_admin_analytics', { p_days: period })
    if (error) throw error
    if (!data?.metrics || !Array.isArray(data.daily) || !Array.isArray(data.top_listings)) {
      throw new Error('The analytics service returned an unexpected response.')
    }
    state.analytics = data
    renderAnalytics()
    setAnalyticsStatus(`Updated ${new Date(data.generated_at).toLocaleString()} · last ${data.period_days} days`)
  }

  function renderAnalyticsTrend(containerId, emptyId, points, series, period, description) {
    const trend = document.getElementById(containerId)
    const empty = document.getElementById(emptyId)
    trend.replaceChildren()

    const chartPoints = Number(period) === 90
      ? Array.from({ length: Math.ceil(points.length / 7) }, (_, index) => {
          const days = points.slice(index * 7, (index + 1) * 7)
          const totals = Object.fromEntries(series.map(([key]) => [
            key,
            days.reduce((sum, point) => sum + Number(point[key] || 0), 0)
          ]))
          return { ...totals, day: days[0]?.day, endDay: days[days.length - 1]?.day }
        })
      : points

    const hasActivity = chartPoints.some(point => series.some(([key]) => Number(point[key]) > 0))
    empty.hidden = hasActivity
    trend.hidden = !hasActivity
    trend.dataset.period = String(period)
    trend.setAttribute('role', 'group')
    trend.setAttribute('aria-label', `${description} for the selected ${period}-day period`)
    if (!hasActivity) return

    const maxValue = Math.max(1, ...chartPoints.flatMap(point => series.map(([key]) => Number(point[key]) || 0)))
    const minimumWidth = Number(period) === 90 ? chartPoints.length * 48 + 60 : 320
    const width = Math.max(320, trend.clientWidth, minimumWidth)
    const height = 228
    const plot = { left: 44, right: width - 16, top: 16, bottom: height - 42 }
    const plotHeight = plot.bottom - plot.top
    const xFor = index => chartPoints.length < 2
      ? (plot.left + plot.right) / 2
      : plot.left + index * (plot.right - plot.left) / (chartPoints.length - 1)
    const yFor = value => plot.bottom - (Number(value || 0) / maxValue) * plotHeight
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')

    const defs = document.createElementNS(svg.namespaceURI, 'defs')
    svg.appendChild(defs)
    const appendSvg = (parent, name, attributes) => {
      const element = document.createElementNS(svg.namespaceURI, name)
      Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)))
      parent.appendChild(element)
      return element
    }

    for (let tick = 0; tick <= 4; tick += 1) {
      const value = maxValue * (4 - tick) / 4
      const y = plot.top + tick * plotHeight / 4
      appendSvg(svg, 'line', { class: 'analytics-gridline', x1: plot.left, x2: plot.right, y1: y, y2: y })
      const tickLabel = appendSvg(svg, 'text', { class: 'analytics-axis-label', x: plot.left - 8, y: y + 3, 'text-anchor': 'end' })
      tickLabel.textContent = formatCount(Math.round(value))
    }

    const formatDate = value => {
      const parsed = new Date(`${value}T00:00:00`)
      return Number.isNaN(parsed.getTime())
        ? 'Date unavailable'
        : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    }
    const formatShortDate = value => {
      const parsed = new Date(`${value}T00:00:00`)
      return Number.isNaN(parsed.getTime())
        ? ''
        : parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    }
    const dateRanges = chartPoints.map(point => {
      const startDate = formatDate(point.day)
      const endDate = formatDate(point.endDay || point.day)
      return point.endDay && point.endDay !== point.day ? `${startDate} – ${endDate}` : startDate
    })
    const dateLabelInterval = Number(period) === 7 ? 1 : Number(period) === 30 ? 5 : 1

    chartPoints.forEach((point, index) => {
      const x = xFor(index)
      appendSvg(svg, 'line', { class: 'analytics-gridline analytics-gridline-vertical', x1: x, x2: x, y1: plot.top, y2: plot.bottom })
      if (index % dateLabelInterval === 0 || index === chartPoints.length - 1) {
        const label = appendSvg(svg, 'text', { class: 'analytics-axis-label analytics-date-label', x, y: height - 14, 'text-anchor': 'middle' })
        label.textContent = formatShortDate(point.day)
      }
    })

    series.forEach(([key, className, label], seriesIndex) => {
      const coordinates = chartPoints.map((point, index) => ({ x: xFor(index), y: yFor(point[key]), value: Number(point[key]) || 0 }))
      const linePath = coordinates.map((coordinate, index) =>
        `${index === 0 ? 'M' : 'L'} ${coordinate.x} ${coordinate.y}`
      ).join(' ')
      const areaPath = `${linePath} L ${coordinates[coordinates.length - 1].x} ${plot.bottom} L ${coordinates[0].x} ${plot.bottom} Z`
      const gradientId = `${containerId}-area-gradient-${seriesIndex}`
      const lineGradientId = `${containerId}-line-gradient-${seriesIndex}`
      const color = className === 'analytics-line-signups' ? '#2563eb' : className === 'analytics-line-views' ? '#0f9f9a' : '#e99a19'
      const lineEndColor = className === 'analytics-line-inquiries' ? '#b45309' : className === 'analytics-line-views' ? '#2563eb' : '#0f9f9a'
      const gradient = appendSvg(defs, 'linearGradient', { id: gradientId, x1: '0', x2: '0', y1: '0', y2: '1' })
      appendSvg(gradient, 'stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '.25' })
      appendSvg(gradient, 'stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0' })
      const lineGradient = appendSvg(defs, 'linearGradient', { id: lineGradientId, x1: '0', x2: '1', y1: '0', y2: '0' })
      appendSvg(lineGradient, 'stop', { offset: '0%', 'stop-color': color })
      appendSvg(lineGradient, 'stop', { offset: '100%', 'stop-color': lineEndColor })
      appendSvg(svg, 'path', { class: `analytics-area ${className}`, d: areaPath, fill: `url(#${gradientId})` })
      appendSvg(svg, 'path', { class: `analytics-line ${className}`, d: linePath, style: `stroke:url(#${lineGradientId})` })

      coordinates.forEach((coordinate, index) => {
        const circle = appendSvg(svg, 'circle', {
          class: `analytics-point ${className}`,
          cx: coordinate.x,
          cy: coordinate.y,
          r: chartPoints.length > 35 ? 2.5 : 4
        })
        const title = appendSvg(circle, 'title', {})
        title.textContent = `${dateRanges[index]}: ${label || 'Sign-ups'} ${formatCount(coordinate.value)}`
      })
    })

    const table = document.createElement('table')
    table.className = 'analytics-data-table'
    const caption = document.createElement('caption')
    caption.textContent = `${description}, selected ${period}-day period`
    table.appendChild(caption)
    const thead = document.createElement('thead')
    const headerRow = document.createElement('tr')
    for (const title of ['Date', ...series.map(([, , label]) => label || 'Sign-ups')]) {
      const cell = document.createElement('th')
      cell.scope = 'col'
      cell.textContent = title
      headerRow.appendChild(cell)
    }
    thead.appendChild(headerRow)
    table.appendChild(thead)
    const tbody = document.createElement('tbody')
    chartPoints.forEach((point, index) => {
      const row = document.createElement('tr')
      const dateCell = document.createElement('th')
      dateCell.scope = 'row'
      dateCell.textContent = dateRanges[index]
      row.appendChild(dateCell)
      series.forEach(([key]) => {
        const valueCell = document.createElement('td')
        valueCell.textContent = formatCount(point[key])
        row.appendChild(valueCell)
      })
      tbody.appendChild(row)
    })
    table.appendChild(tbody)
    trend.append(svg, table)
  }

  function renderAnalytics() {
    const report = state.analytics
    if (!report) return
    const metrics = report.metrics
    document.getElementById('analyticsNewUsers').textContent = formatCount(metrics.new_users)
    document.getElementById('analyticsTotalUsers').textContent = formatCount(metrics.total_users)
    document.getElementById('analyticsStudents').textContent = formatCount(metrics.total_students)
    document.getElementById('analyticsProviders').textContent = formatCount(metrics.total_providers)
    document.getElementById('analyticsPending').textContent = formatCount(metrics.pending_verifications)
    document.getElementById('analyticsListings').textContent = formatCount(metrics.published_listings)
    document.getElementById('analyticsViews').textContent = formatCount(metrics.listing_views)
    document.getElementById('analyticsInquiries').textContent = formatCount(metrics.listing_inquiries)
    document.getElementById('analyticsEvents').textContent = formatCount(metrics.published_events)
    document.getElementById('analyticsRsvps').textContent = formatCount(metrics.upcoming_rsvps)

    renderAnalyticsTrend(
      'analyticsSignupsTrend',
      'analyticsSignupsEmpty',
      report.daily,
      [['signups', 'analytics-line-signups']],
      report.period_days,
      'Daily account sign-ups'
    )
    renderAnalyticsTrend(
      'analyticsEngagementTrend',
      'analyticsEngagementEmpty',
      report.daily,
      [['listing_views', 'analytics-line-views', 'Views'], ['listing_inquiries', 'analytics-line-inquiries', 'Contact clicks']],
      report.period_days,
      'Listing views and contact clicks'
    )

    const rows = report.top_listings.map(item => `
      <tr>
        <td><strong>${escapeHtml(item.title)}</strong></td>
        <td>${escapeHtml(item.entity_type === 'accommodation' ? 'Accommodation' : 'Marketplace')}</td>
        <td>${formatCount(item.views)}</td>
        <td>${formatCount(item.inquiries)}</td>
      </tr>
    `).join('')
    document.getElementById('analyticsTopListings').innerHTML = rows || '<tr><td colspan="4" class="admin-recent-empty">No published listings yet.</td></tr>'
  }

  function exportAnalytics() {
    if (!state.analytics) {
      setAnalyticsStatus('Load analytics before exporting the report.', true)
      return
    }
    const rows = [
      ['CampusAura admin analytics', `Last ${state.analytics.period_days} days`],
      ['Generated at', state.analytics.generated_at],
      [],
      ['Metric', 'Value'],
      ['Total accounts', state.analytics.metrics.total_users],
      ['New accounts', state.analytics.metrics.new_users],
      ['Students', state.analytics.metrics.total_students],
      ['Providers', state.analytics.metrics.total_providers],
      ['Pending verification', state.analytics.metrics.pending_verifications],
      ['Published listings', state.analytics.metrics.published_listings],
      ['Listing views', state.analytics.metrics.listing_views],
      ['Listing contact clicks', state.analytics.metrics.listing_inquiries],
      ['Published events', state.analytics.metrics.published_events],
      ['RSVPs to upcoming events', state.analytics.metrics.upcoming_rsvps],
      [],
      ['Day', 'Sign-ups', 'Listing views', 'Contact clicks'],
      ...state.analytics.daily.map(point => [point.day, point.signups, point.listing_views, point.listing_inquiries]),
      [],
      ['Top listing', 'Type', 'Views', 'Contact clicks'],
      ...state.analytics.top_listings.map(item => [item.title, item.entity_type, item.views, item.inquiries])
    ]
    const csv = rows.map(row => row.map(value => {
      const text = String(value ?? '')
      const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
      return `"${safeText.replace(/"/g, '""')}"`
    }).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `campusaura-analytics-${state.analytics.period_days}-days.csv`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function setupAnalytics() {
    window.addEventListener('resize', () => {
      if (state.analytics && document.getElementById('panel-analytics').classList.contains('active')) {
        renderAnalytics()
      }
    })
    document.getElementById('refreshAnalytics').addEventListener('click', () => {
      loadAnalytics().catch(error => {
        console.error('Could not load admin analytics:', error)
        setAnalyticsStatus(`Could not load analytics: ${error.message}. Confirm the required analytics SQL scripts have been run, then refresh.`, true)
      })
    })
    document.getElementById('analyticsPeriod').addEventListener('change', () => {
      loadAnalytics().catch(error => {
        console.error('Could not load admin analytics:', error)
        setAnalyticsStatus(`Could not load analytics: ${error.message}. Confirm the required analytics SQL scripts have been run, then refresh.`, true)
      })
    })
    document.getElementById('exportAnalytics').addEventListener('click', exportAnalytics)
    loadAnalytics().catch(error => {
      console.error('Could not load admin analytics:', error)
      setAnalyticsStatus(`Could not load analytics: ${error.message}. Confirm the required analytics SQL scripts have been run, then refresh.`, true)
    })
  }

  async function loadData() {
    const results = await Promise.all([
      client.from('accommodations').select('*').order('created_at', { ascending: false }),
      client.from('marketplace_items').select('*').order('created_at', { ascending: false }),
      client.from('events').select('*').order('event_date', { ascending: true }),
      client.from('contact_submissions').select('*').order('created_at', { ascending: false }).limit(100),
      client.from('admin_outbox').select('*').order('sent_at', { ascending: false }).limit(100),
      client.from('profiles').select('*').order('created_at', { ascending: false }),
      client.from('verification_documents').select('*').order('created_at', { ascending: false })
    ])
    const failed = results.find(result => result.error)
    if (failed) throw failed.error
    state.accommodations = results[0].data || []
    state.marketplace = results[1].data || []
    state.events = results[2].data || []
    state.messages = results[3].data || []
    state.outbox = results[4].data || []
    state.profiles = results[5].data || []
    state.verification = results[6].data || []
  }

  function getDirectoryMatches(items, search, fields, statusFilter, statusField = 'status') {
    const query = document.getElementById(search).value.trim().toLocaleLowerCase()
    const status = document.getElementById(statusFilter).value
    return items.filter(item => {
      if (query && !fields.some(field => String(field(item) || '').toLocaleLowerCase().includes(query))) return false
      return status === 'all' || String(item[statusField] || '').toLowerCase() === status
    })
  }

  function getUserDirectoryMatches() {
    const query = document.getElementById('userDirectorySearch').value.trim().toLocaleLowerCase()
    const roleFilter = document.getElementById('userDirectoryRole').value
    const verificationFilter = document.getElementById('userDirectoryVerification').value
    const accessFilter = document.getElementById('userDirectoryAccess').value
    return state.profiles.filter(profile => {
      const role = profile.requested_role || profile.role || ''
      const verification = profile.verification_status || state.verification.find(item => item.user_id === profile.id)?.status || ''
      const access = profile.account_status || 'active'
      if (roleFilter !== 'all' && role !== roleFilter) return false
      if (verificationFilter === 'unverified' ? Boolean(verification) : verificationFilter !== 'all' && verification !== verificationFilter) return false
      if (accessFilter !== 'all' && access !== accessFilter) return false
      if (query && ![profile.full_name, profile.email, profile.phone, profile.reference_code].some(value => String(value || '').toLocaleLowerCase().includes(query))) return false
      return true
    })
  }

  function setupCreateFormDisclosures() {
    for (const [id, disclosure] of [
      ['formAccom', 'accommodation'],
      ['formMarket', 'marketplace'],
      ['formEvent', 'events']
    ]) {
      const form = document.getElementById(id)
      const details = document.querySelector(`[data-create-form="${disclosure}"]`)
      if (form && details) details.appendChild(form)
    }
  }

  function setupDirectoryFilters() {
    document.querySelectorAll(
      '#accommodationSearch, #accommodationStatusFilter, #marketplaceSearch, #marketplaceStatusFilter, #marketplaceCategoryFilter, #eventsSearch, #eventsStatusFilter, #userDirectorySearch, #userDirectoryRole, #userDirectoryVerification, #userDirectoryAccess'
    ).forEach(control => {
      control.addEventListener('input', render)
      control.addEventListener('change', render)
    })
  }

  function render() {
    document.getElementById('statAccom').textContent = state.accommodations.length
    document.getElementById('statMarket').textContent = state.marketplace.length
    document.getElementById('statEvents').textContent = state.events.length
    document.getElementById('statMessages').textContent = state.messages.length
    const pendingAccommodations = state.accommodations.filter(item => item.status === 'pending').length
    const pendingMarketplace = state.marketplace.filter(item => item.status === 'pending').length
    document.getElementById('reviewAccomCount').textContent = pendingAccommodations
    document.getElementById('reviewMarketCount').textContent = pendingMarketplace
    document.getElementById('overviewPendingAccom').textContent = pendingAccommodations
    document.getElementById('overviewPendingMarket').textContent = pendingMarketplace

    const accommodations = getDirectoryMatches(
      state.accommodations,
      'accommodationSearch',
      [item => item.title, item => item.location, item => item.reference_code],
      'accommodationStatusFilter'
    )
    document.getElementById('accommodationDirectoryCount').textContent =
      `${accommodations.length.toLocaleString()} of ${state.accommodations.length.toLocaleString()} ${state.accommodations.length === 1 ? 'listing' : 'listings'}`
    document.getElementById('accomTable').innerHTML = accommodations.map(item => `
      <tr>
        <td data-label="Reference"><strong>${escapeHtml(item.reference_code || 'Not assigned')}</strong></td>
        <td data-label="Title"><strong>${escapeHtml(item.title)}</strong><br><span class="muted small">${escapeHtml([item.room_type, item.description || ''].filter(Boolean).join(' · '))}</span></td>
        <td data-label="Location">${escapeHtml(item.location)}${item.distance_km != null ? `<br><span class="muted small">${escapeHtml(item.distance_km)} km from campus</span>` : ''}</td>
        <td data-label="Price">${price(item.price)}</td>
        <td data-label="Status"><span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
        <td data-label="Actions">
          <div class="admin-row-actions">
            <button class="admin-link-btn" data-preview-table="accommodations" data-preview-id="${escapeHtml(item.id)}">View</button>
            <button class="admin-quick-action" data-edit-accommodation="${escapeHtml(item.id)}">Edit</button>
            ${item.status === 'pending' ? `<button class="admin-approve-btn" data-review-listing="${escapeHtml(item.id)}" data-listing-status="published">Publish</button><button class="admin-reject-btn" data-review-listing="${escapeHtml(item.id)}" data-listing-status="rejected">Reject</button>` : ''}
            ${['published', 'suspended'].includes(item.status) ? `<button class="admin-quick-action" data-suspend-listing="${escapeHtml(item.id)}" data-listing-table="accommodations" data-listing-status="${item.status === 'published' ? 'suspended' : 'published'}">${item.status === 'published' ? 'Suspend' : 'Unsuspend'}</button>` : ''}
            <button class="admin-delete" data-table="accommodations" data-id="${escapeHtml(item.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="6" class="admin-recent-empty">${state.accommodations.length ? 'No listings match these filters.' : 'No listings yet.'}</td></tr>`

    const categoryFilter = document.getElementById('marketplaceCategoryFilter').value
    const marketplace = getDirectoryMatches(
      state.marketplace,
      'marketplaceSearch',
      [
        item => item.title,
        item => item.category,
        item => item.seller_display_name || state.profiles.find(profile => profile.id === item.seller_id)?.full_name,
        item => item.reference_code
      ],
      'marketplaceStatusFilter'
    ).filter(item => categoryFilter === 'all' || item.category === categoryFilter)
    document.getElementById('marketplaceDirectoryCount').textContent =
      `${marketplace.length.toLocaleString()} of ${state.marketplace.length.toLocaleString()} ${state.marketplace.length === 1 ? 'item' : 'items'}`
    document.getElementById('marketTable').innerHTML = marketplace.map(item => `
      <tr>
        <td data-label="Reference"><strong>${escapeHtml(item.reference_code || 'Not assigned')}</strong></td>
        <td data-label="Product or service"><strong>${escapeHtml(item.title)}</strong></td>
        <td data-label="Category">${escapeHtml(item.category)}</td>
        <td data-label="Seller">${escapeHtml(item.seller_display_name || state.profiles.find(profile => profile.id === item.seller_id)?.full_name || 'CampusAura seller')}</td>
        <td data-label="Price">${price(item.price)}</td>
        <td data-label="Status"><span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(item.status)}</span></td>
        <td data-label="Actions">
          <div class="admin-row-actions">
            <button class="admin-link-btn" data-preview-table="marketplace_items" data-preview-id="${escapeHtml(item.id)}">View</button>
            ${item.status === 'pending' ? `<button class="admin-approve-btn" data-review-listing="${escapeHtml(item.id)}" data-listing-table="marketplace_items" data-listing-status="published">Publish</button><button class="admin-reject-btn" data-review-listing="${escapeHtml(item.id)}" data-listing-table="marketplace_items" data-listing-status="rejected">Reject</button>` : ''}
            ${['published', 'suspended'].includes(item.status) ? `<button class="admin-quick-action" data-suspend-listing="${escapeHtml(item.id)}" data-listing-table="marketplace_items" data-listing-status="${item.status === 'published' ? 'suspended' : 'published'}">${item.status === 'published' ? 'Suspend' : 'Unsuspend'}</button>` : ''}
            <button class="admin-delete" data-table="marketplace_items" data-id="${escapeHtml(item.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="7" class="admin-recent-empty">${state.marketplace.length ? 'No items match these filters.' : 'No items yet.'}</td></tr>`

    const eventQuery = document.getElementById('eventsSearch').value.trim().toLocaleLowerCase()
    const eventFilter = document.getElementById('eventsStatusFilter').value
    const now = Date.now()
    const events = state.events.filter(item => {
      const eventStatus = String(item.status || '').toLowerCase()
      const eventTime = new Date(item.event_date).getTime()
      if (eventQuery && ![item.title, item.location, item.organizer_name].some(value => String(value || '').toLocaleLowerCase().includes(eventQuery))) return false
      if (eventFilter === 'pending' && !['draft', 'pending'].includes(eventStatus)) return false
      if (eventFilter === 'upcoming' && (!Number.isFinite(eventTime) || eventTime < now || eventStatus !== 'published')) return false
      if (eventFilter === 'past' && (!Number.isFinite(eventTime) || eventTime >= now || eventStatus !== 'published')) return false
      if (!['all', 'pending', 'upcoming', 'past'].includes(eventFilter) && eventStatus !== eventFilter) return false
      return true
    }).sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime())
    document.getElementById('eventsDirectoryCount').textContent =
      `${events.length.toLocaleString()} of ${state.events.length.toLocaleString()} ${state.events.length === 1 ? 'event' : 'events'}`
    document.getElementById('eventTable').innerHTML = events.map(item => `
      <tr>
        <td data-label="Event"><strong>${escapeHtml(item.title)}</strong></td>
        <td data-label="Date">${date(item.event_date)}</td>
        <td data-label="Location">${escapeHtml(item.location)}</td>
        <td data-label="Organizer">${escapeHtml(item.organizer_name || 'Not provided')}</td>
        <td data-label="Status"><span class="status-pill status-${escapeHtml(item.status)}">${escapeHtml(item.status === 'draft' ? 'Pending review' : item.status)}</span></td>
        <td data-label="Actions">
          <div class="admin-row-actions">
            <button class="admin-link-btn" data-preview-table="events" data-preview-id="${escapeHtml(item.id)}">View</button>
            ${item.status === 'draft' ? `<button class="admin-approve-btn" data-review-event="${escapeHtml(item.id)}" data-event-status="published">Publish</button><button class="admin-reject-btn" data-review-event="${escapeHtml(item.id)}" data-event-status="cancelled">Reject</button>` : ''}
            ${['published', 'suspended'].includes(item.status) ? `<button class="admin-quick-action" data-suspend-listing="${escapeHtml(item.id)}" data-listing-table="events" data-listing-status="${item.status === 'published' ? 'suspended' : 'published'}">${item.status === 'published' ? 'Suspend' : 'Unsuspend'}</button>` : ''}
            <button class="admin-delete" data-table="events" data-id="${escapeHtml(item.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('') || `<tr><td colspan="6" class="admin-recent-empty">${state.events.length ? 'No events match these filters.' : 'No events yet.'}</td></tr>`

    const messages = state.messages.map(item => `
      <div class="admin-message"><div class="admin-message-head">
        <span class="admin-message-name">${escapeHtml(item.name)} <span class="muted">(${escapeHtml(item.email)})</span></span>
        <span class="admin-message-meta">${escapeHtml(item.topic || 'General')} · ${date(item.created_at)}</span>
      </div><p class="admin-message-body">${escapeHtml(item.message)}</p></div>
    `).join('') || '<div class="admin-recent-empty">No messages yet.</div>'
    document.getElementById('messageList').innerHTML = messages
    document.getElementById('msgCount').textContent = `(${state.messages.length})`
    document.getElementById('adminOutbox').innerHTML = state.outbox.map(item => `
      <div class="admin-message">
        <div class="admin-message-head">
          <span class="admin-message-name">${escapeHtml(item.recipient_name)} <span class="muted">(${escapeHtml(item.recipient_email)})</span></span>
          <span class="admin-message-meta">${escapeHtml(item.subject)} · ${date(item.sent_at)}</span>
        </div>
        <p class="admin-message-body">${escapeHtml(item.body)}</p>
      </div>
    `).join('') || '<div class="admin-recent-empty">No sent messages yet.</div>'

    const students = state.profiles.filter(profile => (profile.requested_role || profile.role) === 'student').length
    const providers = state.profiles.filter(profile => (profile.requested_role || profile.role) === 'provider').length
    const pendingProfileIds = state.profiles.filter(profile => profile.verification_status === 'pending').map(profile => profile.id)
    const pendingStudentIds = state.verification.filter(item => item.requested_role === 'student' && item.status === 'pending').map(item => item.user_id)
    const pending = new Set([...pendingProfileIds, ...pendingStudentIds]).size
    document.getElementById('reviewUserCount').textContent = pending
    document.getElementById('overviewPendingUsers').textContent = pending
    document.getElementById('overviewTotalPending').textContent = pendingAccommodations + pendingMarketplace + pending
    document.getElementById('userCountStudents').textContent = students
    document.getElementById('userCountProviders').textContent = providers
    document.getElementById('userCountPending').textContent = pending
    const emailRecipient = document.getElementById('adminEmailRecipient')
    emailRecipient.innerHTML = '<option value="">Choose a student or provider</option>' + state.profiles
      .filter(profile => profile.role !== 'admin' && ['student', 'provider'].includes(profile.requested_role || profile.role))
      .map(profile => {
        const role = profile.requested_role || profile.role
        const displayName = profile.full_name || 'Unnamed user'
        const reference = profile.reference_code ? ` · ${profile.reference_code}` : ''
        const access = profile.account_status === 'frozen' ? ' · frozen' : ''
        return `<option value="${escapeHtml(profile.id)}">${escapeHtml(displayName)} · ${escapeHtml(role)}${escapeHtml(reference)}${access}</option>`
      }).join('')
    const userStatusClass = status => ['pending', 'approved', 'rejected', 'active', 'frozen'].includes(status.toLowerCase())
      ? `status-${status.toLowerCase()}`
      : 'status-unknown'
    const users = getUserDirectoryMatches()
    document.getElementById('userDirectoryCount').textContent =
      `${users.length.toLocaleString()} of ${state.profiles.length.toLocaleString()} ${state.profiles.length === 1 ? 'account' : 'accounts'}`
    document.getElementById('usersTable').innerHTML = users.map(profile => {
      const role = profile.requested_role || profile.role || 'Unknown'
      const accountStatus = String(profile.account_status || 'active')
      const verificationDocument = state.verification.find(item => item.user_id === profile.id && item.requested_role === role)
      const verificationStatus = String(
        profile.verification_status === 'pending' || verificationDocument?.status === 'pending'
          ? 'pending'
          : profile.verification_status || verificationDocument?.status || 'Not provided'
      )
      const rowState = accountStatus.toLowerCase() === 'frozen'
        ? 'user-row-frozen'
        : verificationStatus.toLowerCase() === 'pending'
          ? 'user-row-pending'
          : ''
      return `
        <tr class="${rowState}">
          <td data-label="Reference"><strong>${escapeHtml(profile.reference_code || 'Not assigned')}</strong></td>
          <td data-label="User"><span class="user-directory-identity"><strong>${escapeHtml(profile.full_name || 'Unnamed user')}</strong><span>${escapeHtml(profile.email || 'No email provided')}</span></span></td>
          <td data-label="Account type"><span class="user-role-pill">${escapeHtml(role)}</span></td>
          <td data-label="Verification"><span class="status-pill ${userStatusClass(verificationStatus)}">${escapeHtml(verificationStatus)}</span></td>
          <td data-label="Access"><span class="status-pill ${userStatusClass(accountStatus)}">${escapeHtml(accountStatus)}</span></td>
          <td data-label="Actions"><div class="admin-row-actions">
            <button class="admin-link-btn" data-preview-table="profiles" data-preview-id="${escapeHtml(profile.id)}">Manage</button>
          </div></td>
        </tr>
      `
    }).join('') || `<tr><td colspan="6" class="admin-recent-empty">${state.profiles.length ? 'No accounts match these filters.' : 'No users found.'}</td></tr>`
    renderUserListPreview()
  }

  const userListColumns = [
    { key: 'full_name', label: 'Name', value: profile => profile.full_name || '' },
    { key: 'email', label: 'Email', value: profile => profile.email || '' },
    { key: 'phone', label: 'Phone', value: profile => profile.phone || '' },
    { key: 'role', label: 'Account type', value: profile => profile.requested_role || profile.role || '' },
    { key: 'reference_code', label: 'Reference', value: profile => profile.reference_code || '' },
    { key: 'verification_status', label: 'Verification', value: profile => profile.verification_status || 'Not provided' },
    { key: 'account_status', label: 'Account access', value: profile => profile.account_status || 'active' }
  ]

  function getUserListMatches() {
    const roleFilter = document.getElementById('userListRole').value
    const verificationFilter = document.getElementById('userListVerification').value
    const accountFilter = document.getElementById('userListAccountStatus').value
    const search = document.getElementById('userListSearch').value.trim().toLocaleLowerCase()
    return state.profiles.filter(profile => {
      const role = profile.requested_role || profile.role
      if (!['student', 'provider'].includes(role)) return false
      if (roleFilter !== 'all' && role !== roleFilter) return false
      if (verificationFilter !== 'all' && (profile.verification_status || '').toLowerCase() !== verificationFilter) return false
      if (accountFilter !== 'all' && (profile.account_status || 'active').toLowerCase() !== accountFilter) return false
      if (search && ![profile.full_name, profile.email, profile.phone].some(value => String(value || '').toLocaleLowerCase().includes(search))) return false
      return true
    })
  }

  function getSelectedUserListColumns() {
    const selected = new Set([...document.querySelectorAll('input[name="userListColumn"]:checked')].map(input => input.value))
    return userListColumns.filter(column => selected.has(column.key))
  }

  function renderUserListPreview() {
    const head = document.getElementById('userListPreviewHead')
    const body = document.getElementById('userListPreviewBody')
    const count = document.getElementById('userListCount')
    if (!head || !body || !count) return
    const matches = getUserListMatches()
    const columns = getSelectedUserListColumns()
    count.textContent = `${matches.length.toLocaleString()} matching ${matches.length === 1 ? 'account' : 'accounts'}`
    document.getElementById('exportUserList').disabled = !matches.length || !columns.length
    head.innerHTML = columns.length ? `<tr>${columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr>` : ''
    if (!columns.length) {
      body.innerHTML = '<tr><td class="admin-recent-empty">Choose at least one detail to preview or download.</td></tr>'
      return
    }
    body.innerHTML = matches.slice(0, 25).map(profile => `<tr>${columns.map(column => `<td data-label="${escapeHtml(column.label)}">${escapeHtml(column.value(profile) || '—')}</td>`).join('')}</tr>`).join('') ||
      `<tr><td colspan="${columns.length}" class="admin-recent-empty">No accounts match these filters.</td></tr>`
    const status = document.getElementById('userListStatus')
    status.textContent = matches.length > 25 ? 'Showing the first 25 matches in the preview. The CSV will include every match.' : ''
  }

  function csvCell(value) {
    let text = String(value ?? '')
    if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`
    return `"${text.replace(/"/g, '""')}"`
  }

  function exportUserList() {
    const matches = getUserListMatches()
    const columns = getSelectedUserListColumns()
    if (!matches.length || !columns.length) return
    const rows = [
      columns.map(column => csvCell(column.label)).join(','),
      ...matches.map(profile => columns.map(column => csvCell(column.value(profile))).join(','))
    ]
    const blob = new Blob([`\uFEFF${rows.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `campusaura-users-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    document.getElementById('userListStatus').textContent = `Downloaded ${matches.length.toLocaleString()} accounts.`
  }

  function setupUserList() {
    document.querySelectorAll('#userListRole, #userListVerification, #userListAccountStatus, #userListSearch, input[name="userListColumn"]').forEach(control => {
      control.addEventListener('input', renderUserListPreview)
      control.addEventListener('change', renderUserListPreview)
    })
    document.getElementById('exportUserList').addEventListener('click', exportUserList)
    renderUserListPreview()
  }

  function setupTabs() {
    const tablist = document.getElementById('adminDashboardNav')
    if (!tablist) return
    const tabs = () => [...tablist.querySelectorAll('[role="tab"]')].filter(tab =>
      !tab.disabled && !tab.hidden && !tab.closest('[hidden]') && getComputedStyle(tab).display !== 'none'
    )
    const activate = tab => {
      tabs().forEach(item => {
        const isActive = item === tab
        item.classList.toggle('active', isActive)
        item.setAttribute('aria-selected', String(isActive))
        item.tabIndex = isActive ? 0 : -1
      })
      document.querySelectorAll('.admin-panel').forEach(panel => {
        const isActive = panel.id === `panel-${tab.dataset.tab}`
        panel.classList.toggle('active', isActive)
        panel.setAttribute('aria-hidden', String(!isActive))
        if (isActive) panel.setAttribute('aria-labelledby', tab.id)
      })
      if (tab.dataset.tab === 'analytics' && state.analytics) renderAnalytics()
    }

    tabs().forEach(tab => tab.addEventListener('click', () => activate(tab)))
    tablist.addEventListener('keydown', event => {
      const currentTab = event.target.closest('[role="tab"]')
      if (!currentTab) return
      const availableTabs = tabs()
      const currentIndex = availableTabs.indexOf(currentTab)
      if (currentIndex < 0) return
      let nextIndex
      if (event.key === 'Home') nextIndex = 0
      else if (event.key === 'End') nextIndex = availableTabs.length - 1
      else if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % availableTabs.length
      else if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + availableTabs.length) % availableTabs.length
      else return
      event.preventDefault()
      const nextTab = availableTabs[nextIndex]
      activate(nextTab)
      nextTab.focus()
    })

    document.querySelectorAll('[data-tab-target]').forEach(button => button.addEventListener('click', () => {
      const target = document.querySelector(`.admin-tab[data-tab="${button.dataset.tabTarget}"]`)
      target?.click()
    }))
  }

  function setupAdminEmailComposer() {
    const form = document.getElementById('adminEmailForm')
    const status = document.getElementById('adminEmailStatus')
    form.addEventListener('submit', async event => {
      event.preventDefault()
      const formData = new FormData(form)
      const userId = String(formData.get('userId') || '')
      const subject = String(formData.get('subject') || '').trim()
      const body = String(formData.get('body') || '').trim()
      const profile = state.profiles.find(item => item.id === userId)
      const role = profile?.requested_role || profile?.role
      if (!profile || !['student', 'provider'].includes(role)) {
        status.textContent = 'Choose a registered student or provider.'
        status.classList.add('is-error')
        return
      }
      if (!window.confirm(`Send this email to ${profile.full_name || 'this user'} (${role})?`)) return

      const submitButton = form.querySelector('button[type="submit"]')
      submitButton.disabled = true
      status.textContent = 'Sending email…'
      status.classList.remove('is-error')
      try {
        if (!window.campusAuraEmail?.sendAdminMessageEmail) {
          throw new Error('The email service is unavailable.')
        }
        const result = await window.campusAuraEmail.sendAdminMessageEmail({ userId, subject, body })
        status.textContent = result.outboxLogged === false
          ? 'Email was accepted by Resend, but could not be saved to the outbox. Check the admin outbox migration and function logs.'
          : 'Email accepted by Resend. Check Resend email logs for its final delivery status.'
        form.reset()
        try {
          await loadData()
          render()
        } catch (refreshError) {
          console.error('Email was accepted by Resend, but the admin dashboard could not refresh:', refreshError)
          status.textContent = `Email was accepted by Resend, but the message history could not refresh: ${refreshError.message}`
          status.classList.add('is-error')
        }
      } catch (error) {
        console.error('Could not send admin email:', error)
        status.textContent = `Could not send email: ${error.message}`
        status.classList.add('is-error')
      } finally {
        submitButton.disabled = false
      }
    })
  }

  function closeAdminDetailsModal() {
    const modal = document.getElementById('adminDetailsModal')
    closeAdminModal(modal)
  }

  function setupForms(user) {
    setupAdminImagePicker('accom')
    setupAdminImagePicker('market')
    setupAdminImagePicker('event')
    setupAccommodationEditor()
    const accomTitle = document.getElementById('accomTitle')
    const accomLocation = document.getElementById('accomLocation')
    const accomPrice = document.getElementById('accomPrice')
    const accomDesc = document.getElementById('accomDesc')
    const marketTitle = document.getElementById('marketTitle')
    const marketPrice = document.getElementById('marketPrice')
    const marketCategory = document.getElementById('marketCategory')
    const eventTitle = document.getElementById('eventTitle')
    const eventLocation = document.getElementById('eventLocation')
    const eventType = document.getElementById('eventType')

    document.getElementById('formAccom').addEventListener('submit', async event => {
      event.preventDefault()
      const button = event.target.querySelector('button[type="submit"]')
      let uploads = []
      button.disabled = true
      try {
        uploads = await uploadAdminImages('accom', user.id, 'accommodation')
        const imageUrls = uploads.length ? uploads.map(upload => upload.url) : ['images/room1.jpeg']
        const { error } = await client.from('accommodations').insert({
          owner_id: user.id, title: accomTitle.value.trim(), location: accomLocation.value.trim(),
          price: Number(accomPrice.value), image_url: imageUrls[0], image_urls: imageUrls,
          description: accomDesc.value.trim(), status: 'published', verified: true,
          room_type: document.getElementById('adminAccomRoomType').value,
          distance_km: document.getElementById('adminAccomDistance').value === '' ? null : Number(document.getElementById('adminAccomDistance').value),
          deposit: Number(document.getElementById('adminAccomDeposit').value || 0),
          furnishing: document.getElementById('adminAccomFurnished').value,
          bathroom_type: document.getElementById('adminAccomBathroom').value,
          kitchen_type: document.getElementById('adminAccomKitchen').value,
          available_from: document.getElementById('adminAccomAvailableFrom').value || null,
          max_occupants: Number(document.getElementById('adminAccomOccupants').value || 1),
          transport_details: document.getElementById('adminAccomTransport').value.trim(),
          utilities_included: document.getElementById('adminAccomUtilities').value.split(',').map(value => value.trim()).filter(Boolean),
          amenities: document.getElementById('adminAccomAmenities').value.split(',').map(value => value.trim()).filter(Boolean)
        })
        if (error) throw error
        event.target.reset()
        clearAdminImageSelection('accom')
        setMessage('Accommodation added with its photos.')
        await loadData(); render()
        document.querySelector('[data-create-form="accommodation"]').open = false
      } catch (error) {
        await removeAdminImageUploads(uploads)
        setMessage(`Could not add accommodation: ${error.message}`, true)
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
        uploads = await uploadAdminImages('market', user.id, 'marketplace')
        const imageUrls = uploads.length ? uploads.map(upload => upload.url) : ['images/books.jpeg']
        const { error } = await client.from('marketplace_items').insert({
          seller_id: user.id, title: marketTitle.value.trim(), price: Number(marketPrice.value),
          seller_display_name: document.getElementById('marketSeller').value.trim(),
          category: marketCategory.value.trim(), image_url: imageUrls[0], image_urls: imageUrls,
          listing_type: document.getElementById('marketListingType')?.value || 'product',
          status: 'published'
        })
        if (error) throw error
        event.target.reset()
        clearAdminImageSelection('market')
        setMessage('Marketplace item added with its photos.')
        await loadData(); render()
        document.querySelector('[data-create-form="marketplace"]').open = false
      } catch (error) {
        await removeAdminImageUploads(uploads)
        setMessage(`Could not add marketplace item: ${error.message}`, true)
      } finally {
        button.disabled = false
      }
    })
    document.getElementById('formEvent').addEventListener('submit', async event => {
      event.preventDefault()
      const eventDate = new Date(document.getElementById('eventDate').value)
      if (Number.isNaN(eventDate.getTime())) { setMessage('Enter a valid event date.', true); return }
      const button = event.target.querySelector('button[type="submit"]')
      let uploads = []
      button.disabled = true
      try {
        uploads = await uploadAdminImages('event', user.id, 'event')
        const imageUrls = uploads.length ? uploads.map(upload => upload.url) : ['images/event1.jpeg']
        const { error } = await client.from('events').insert({
          organizer_id: user.id, organizer_name: document.getElementById('eventOrganizer').value.trim(),
          title: eventTitle.value.trim(), event_date: eventDate.toISOString(),
          location: eventLocation.value.trim(), description: document.getElementById('eventDescription').value.trim(),
          image_url: imageUrls[0], image_urls: imageUrls, event_type: eventType.value, status: 'published'
        })
        if (error) throw error
        event.target.reset()
        clearAdminImageSelection('event')
        setMessage('Event added with its photos.')
        await loadData(); render()
        document.querySelector('[data-create-form="events"]').open = false
      } catch (error) {
        await removeAdminImageUploads(uploads)
        setMessage(`Could not add event: ${error.message}`, true)
      } finally {
        button.disabled = false
      }
    })
  }

  function setupAccommodationEditor() {
    const modal = document.getElementById('adminAccommodationEditModal')
    const form = document.getElementById('adminAccommodationEditForm')
    if (!modal || !form) return

    const close = () => {
      closeAdminModal(modal)
    }

    document.addEventListener('click', event => {
      const editButton = event.target.closest('[data-edit-accommodation]')
      if (editButton) {
        const item = state.accommodations.find(listing => listing.id === editButton.dataset.editAccommodation)
        if (!item) {
          setMessage('Could not find that property. Refresh the dashboard and try again.', true)
          return
        }
        closeAdminDetailsModal()
        form.dataset.id = item.id
        document.getElementById('adminEditAccomTitle').value = item.title || ''
        document.getElementById('adminEditAccomLocation').value = item.location || ''
        document.getElementById('adminEditAccomPrice').value = item.price ?? ''
        document.getElementById('adminEditAccomRoomType').value = item.room_type || 'Other'
        document.getElementById('adminEditAccomDistance').value = item.distance_km ?? ''
        document.getElementById('adminEditAccomDeposit').value = item.deposit ?? 0
        document.getElementById('adminEditAccomFurnished').value = item.furnishing || 'unfurnished'
        document.getElementById('adminEditAccomBathroom').value = item.bathroom_type || 'not specified'
        document.getElementById('adminEditAccomKitchen').value = item.kitchen_type || 'not specified'
        document.getElementById('adminEditAccomAvailableFrom').value = item.available_from || ''
        document.getElementById('adminEditAccomOccupants').value = item.max_occupants ?? 1
        document.getElementById('adminEditAccomTransport').value = item.transport_details || ''
        document.getElementById('adminEditAccomUtilities').value = (item.utilities_included || []).join(', ')
        document.getElementById('adminEditAccomAmenities').value = (item.amenities || []).join(', ')
        document.getElementById('adminEditAccomDescription').value = item.description || ''
        document.getElementById('adminAccommodationEditStatus').textContent = ''
        openAdminModal(modal, editButton, document.getElementById('adminEditAccomTitle'))
        return
      }

      if (event.target.closest('[data-close-accommodation-editor]')) close()
    })

    document.addEventListener('keydown', event => {
      if (!modal.classList.contains('is-open')) return
      if (event.key === 'Escape') close()
      else if (event.key === 'Tab') trapAdminModalFocus(modal, event)
    })

    form.addEventListener('submit', async event => {
      event.preventDefault()
      const submit = form.querySelector('button[type="submit"]')
      const status = document.getElementById('adminAccommodationEditStatus')
      const updates = {
        title: document.getElementById('adminEditAccomTitle').value.trim(),
        location: document.getElementById('adminEditAccomLocation').value.trim(),
        price: Number(document.getElementById('adminEditAccomPrice').value),
        room_type: document.getElementById('adminEditAccomRoomType').value,
        distance_km: document.getElementById('adminEditAccomDistance').value === '' ? null : Number(document.getElementById('adminEditAccomDistance').value),
        deposit: Number(document.getElementById('adminEditAccomDeposit').value || 0),
        furnishing: document.getElementById('adminEditAccomFurnished').value,
        bathroom_type: document.getElementById('adminEditAccomBathroom').value,
        kitchen_type: document.getElementById('adminEditAccomKitchen').value,
        available_from: document.getElementById('adminEditAccomAvailableFrom').value || null,
        max_occupants: Number(document.getElementById('adminEditAccomOccupants').value || 1),
        transport_details: document.getElementById('adminEditAccomTransport').value.trim(),
        utilities_included: document.getElementById('adminEditAccomUtilities').value.split(',').map(value => value.trim()).filter(Boolean),
        amenities: document.getElementById('adminEditAccomAmenities').value.split(',').map(value => value.trim()).filter(Boolean),
        description: document.getElementById('adminEditAccomDescription').value.trim()
      }

      submit.disabled = true
      status.textContent = 'Saving property changes…'
      try {
        const { data, error } = await client.from('accommodations')
          .update(updates)
          .eq('id', form.dataset.id)
          .select('id')
          .maybeSingle()
        if (error) throw error
        if (!data) throw new Error('The property was not found or is no longer available to edit.')
        await loadData()
        render()
        close()
        setMessage('Property changes saved.')
      } catch (error) {
        status.textContent = `Could not save property changes: ${error.message}`
        setMessage(`Could not save property changes: ${error.message}`, true)
      } finally {
        submit.disabled = false
      }
    })
  }

  function setupActions() {
    document.addEventListener('click', async event => {
      const button = event.target.closest('.admin-delete[data-table]')
      if (button) {
        const { error } = await client.from(button.dataset.table).delete().eq('id', button.dataset.id)
        if (error) { setMessage(error.message, true); return }
        await loadData(); render();
        return
      }

      const eventReviewButton = event.target.closest('[data-review-event]')
      if (eventReviewButton) {
        eventReviewButton.disabled = true
        const status = eventReviewButton.dataset.eventStatus
        if (!['published', 'cancelled'].includes(status)) {
          setMessage('Invalid event review action.', true)
          eventReviewButton.disabled = false
          return
        }
        const action = status === 'published' ? 'publish' : 'reject'
        if (!window.confirm(`Are you sure you want to ${action} this event?`)) {
          eventReviewButton.disabled = false
          return
        }
        const { data, error } = await client.from('events')
          .update({ status })
          .eq('id', eventReviewButton.dataset.reviewEvent)
          .eq('status', 'draft')
          .select('id')
          .maybeSingle()
        if (error) {
          setMessage(`Could not ${action} the event: ${error.message}`, true)
        } else if (!data) {
          setMessage('This event is no longer waiting for review. Refresh and try again.', true)
        } else {
          setMessage(`Event ${status === 'published' ? 'published' : 'rejected'}.`)
          await loadData()
          render()
        }
        eventReviewButton.disabled = false
        return
      }

      const deleteUserButton = event.target.closest('[data-delete-user]')
      if (deleteUserButton) {
        const profile = state.profiles.find(item => item.id === deleteUserButton.dataset.deleteUser)
        if (!profile || profile.role === 'admin') {
          setMessage('Administrator accounts cannot be deleted from this page.', true)
          return
        }
        if (!window.confirm(`Permanently delete ${profile.full_name || 'this user'} and their account? This cannot be undone.`)) return
        deleteUserButton.disabled = true
        const { error } = await client.rpc('admin_delete_user', { p_user_id: profile.id })
        if (error) {
          setMessage(`Could not delete the user: ${error.message}`, true)
          deleteUserButton.disabled = false
          return
        }
        closeAdminDetailsModal()
        setMessage('User account deleted.')
        await loadData()
        render()
        return
      }

      const reviewButton = event.target.closest('[data-review-user]')
      if (reviewButton) {
        reviewButton.disabled = true
        const completed = await reviewUser(reviewButton.dataset.reviewUser, reviewButton.dataset.reviewStatus)
        if (completed) closeAdminDetailsModal()
        reviewButton.disabled = false
        return
      }

      const accountButton = event.target.closest('[data-account-action]')
      if (accountButton) {
        const profile = state.profiles.find(item => item.id === accountButton.dataset.accountId)
        if (!profile || profile.role === 'admin') {
          setMessage('Administrator accounts cannot be frozen from this page.', true)
          return
        }
        const nextStatus = accountButton.dataset.accountAction
        let reason = null
        if (nextStatus === 'frozen') {
          reason = window.prompt(`Why are you freezing ${profile.full_name || 'this account'}? This reason will be shown to the account holder.`)
          if (reason === null) return
          reason = reason.trim()
          if (!reason) {
            setMessage('Enter a reason before freezing the account.', true)
            return
          }
          if (!window.confirm(`Freeze ${profile.full_name || 'this account'} now? Their protected account features will be disabled and their provider listings hidden.`)) return
        } else if (!window.confirm(`Unfreeze ${profile.full_name || 'this account'}?`)) {
          return
        }

        accountButton.disabled = true
        const { error } = await client.rpc('admin_set_account_status', {
          p_user_id: profile.id,
          p_status: nextStatus,
          p_reason: reason
        })
        if (error) {
          setMessage(`Could not ${nextStatus === 'frozen' ? 'freeze' : 'unfreeze'} the account: ${error.message}`, true)
          accountButton.disabled = false
          return
        }
        setMessage(`Account ${nextStatus === 'frozen' ? 'frozen' : 'unfrozen'} successfully.`)
        await loadData()
        render()
        closeAdminDetailsModal()
        return
      }

      const suspensionButton = event.target.closest('[data-suspend-listing]')
      if (suspensionButton) {
        const table = suspensionButton.dataset.listingTable
        const status = suspensionButton.dataset.listingStatus
        if (!['accommodations', 'marketplace_items', 'events'].includes(table) || !['published', 'suspended'].includes(status)) {
          setMessage('Invalid listing suspension action.', true)
          return
        }
        const type = table === 'accommodations' ? 'property listing' : table === 'events' ? 'event' : 'product or service'
        const action = status === 'suspended' ? 'suspend' : 'unsuspend'
        if (!window.confirm(`Are you sure you want to ${action} this ${type}?`)) return
        suspensionButton.disabled = true
        const update = { status }
        if (table === 'accommodations' && status === 'published') update.verified = true
        const result = await client.from(table)
          .update(update)
          .eq('id', suspensionButton.dataset.suspendListing)
          .eq('status', status === 'suspended' ? 'published' : 'suspended')
          .select('id')
          .maybeSingle()
        if (result.error) {
          setMessage(`Could not ${action} the ${type}: ${result.error.message}`, true)
        } else if (!result.data) {
          setMessage(`This ${type} changed before your action could be applied. Refresh and try again.`, true)
        } else {
          setMessage(`${type[0].toUpperCase()}${type.slice(1)} ${status === 'suspended' ? 'suspended' : 'restored'}.`)
          await loadData()
          render()
          closeAdminDetailsModal()
        }
        suspensionButton.disabled = false
        return
      }

      const listingButton = event.target.closest('[data-review-listing]')
      if (listingButton) {
        listingButton.disabled = true
        const status = listingButton.dataset.listingStatus
        const table = listingButton.dataset.listingTable || 'accommodations'
        if (!['accommodations', 'marketplace_items'].includes(table) || !['published', 'rejected'].includes(status)) {
          setMessage('Invalid listing review action.', true)
          listingButton.disabled = false
          return
        }
        const listingType = table === 'accommodations' ? 'accommodation' : 'marketplace item'
        if (!window.confirm(`Are you sure you want to ${status === 'published' ? 'publish' : 'reject'} this ${listingType}?`)) {
          listingButton.disabled = false
          return
        }
        const update = { status }
        if (table === 'accommodations') update.verified = status === 'published'
        const { data, error } = await client.from(table)
          .update(update)
          .eq('id', listingButton.dataset.reviewListing)
          .eq('status', 'pending')
          .select('id')
          .maybeSingle()
        if (error) {
          setMessage(`Could not ${status === 'published' ? 'publish' : 'reject'} the ${listingType}: ${error.message}`, true)
        } else if (!data) {
          setMessage(`This ${listingType} is no longer waiting for review. Refresh the table and try again.`, true)
        } else {
          setMessage(`${listingType[0].toUpperCase()}${listingType.slice(1)} ${status === 'published' ? 'published' : 'rejected'}.`)
          await loadData()
          render()
        }
        listingButton.disabled = false
        return
      }

      const previewButton = event.target.closest('[data-preview-table]')
      if (previewButton) {
        const { data, error } = await client.from(previewButton.dataset.previewTable).select('*').eq('id', previewButton.dataset.previewId).single()
        if (error) { setMessage(error.message, true); return }
        await openDetailModal(previewButton.dataset.previewTable, data, previewButton)
      }
    })

    const signOutBtn = document.getElementById('signOutBtn')
    if (signOutBtn) {
      signOutBtn.addEventListener('click', async () => {
        await client.auth.signOut()
        window.location.href = 'auth.html'
      })
    }

    const modal = document.getElementById('adminDetailsModal')
    if (modal) {
      modal.addEventListener('click', event => {
        if (event.target.matches('[data-close-modal]')) {
          closeAdminDetailsModal()
        }
      })
      document.addEventListener('keydown', event => {
        if (!modal.classList.contains('is-open')) return
        if (event.key === 'Escape') closeAdminDetailsModal()
        else if (event.key === 'Tab') trapAdminModalFocus(modal, event)
      })
    }
  }

  async function reviewUser(userId, status) {
    const profile = state.profiles.find(item => item.id === userId)
    if (!profile) {
      setMessage('Could not find that user in the current admin data.', true)
      return false
    }
    const action = status === 'approved' ? 'approve' : 'reject'
    const pastAction = status === 'approved' ? 'approved' : 'rejected'
    if (!window.confirm(`Are you sure you want to ${action} ${profile.full_name || 'this user'}?`)) return false

    let rejectionReason = ''
    if (status === 'rejected') {
      rejectionReason = window.prompt('Add a reason for rejecting this user. This will be included in the email sent to them:', 'Your application did not meet the required verification standards.') || ''
      rejectionReason = rejectionReason.trim()
      if (!rejectionReason) {
        setMessage('A rejection reason is required before a user can be rejected.', true)
        return false
      }
    }

    const { error } = await client.rpc('admin_review_user', {
      p_user_id: userId,
      p_status: status,
      p_rejection_reason: status === 'rejected' ? rejectionReason : null
    })
    if (error) {
      setMessage(`Could not ${action} the user: ${error.message}`, true)
      return false
    }

    if (window.campusAuraEmail?.sendReviewDecisionEmail) {
      try {
        await window.campusAuraEmail.sendReviewDecisionEmail({
          userId,
          status
        })
      } catch (emailError) {
        console.warn('Review decision email could not be sent:', emailError)
        setMessage(`User ${pastAction} successfully, but the decision email was not sent: ${emailError.message}`, false)
        await loadData()
        render()
        return true
      }
    } else {
      setMessage(`User ${pastAction} successfully. The notification service is unavailable, so no email was sent.`, false)
      await loadData()
      render()
      return true
    }

    setMessage(`User ${pastAction} successfully.`)
    await loadData()
    render()
    return true
  }

  async function openDetailModal(table, item, trigger) {
    const modal = document.getElementById('adminDetailsModal')
    if (!modal || !item) return

    const kicker = document.getElementById('adminDetailsKicker')
    const title = document.getElementById('adminDetailsTitle')
    const meta = document.getElementById('adminDetailsMeta')
    const description = document.getElementById('adminDetailsDescription')
    const footer = document.getElementById('adminDetailsFooter')
    description.hidden = false

    if (table === 'accommodations') {
      kicker.textContent = 'Accommodation'
      title.textContent = item.title || 'Accommodation listing'
      const details = [
        ['Room type', item.room_type],
        ['Distance', item.distance_km != null ? `${item.distance_km} km from campus` : ''],
        ['Deposit', item.deposit != null ? `K${Number(item.deposit).toLocaleString()}` : ''],
        ['Furnishing', item.furnishing],
        ['Bathroom', item.bathroom_type],
        ['Kitchen', item.kitchen_type],
        ['Utilities included', (item.utilities_included || []).join(', ')],
        ['Amenities', (item.amenities || []).join(', ')],
        ['Transport', item.transport_details],
        ['Available from', item.available_from],
        ['Maximum occupants', item.max_occupants]
      ].filter(([, value]) => value !== '' && value !== null && value !== undefined)
      meta.innerHTML = `<strong>${escapeHtml(item.location || 'Location unavailable')}</strong><span>•</span><strong>K${Number(item.price || 0).toLocaleString()} / month</strong><span>•</span><span>${escapeHtml(item.status || 'Published')}</span><dl class="admin-property-detail-list">${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`
      description.textContent = item.description || 'No description provided.'
      footer.innerHTML = `
        <span class="detail-chip">Owner: ${escapeHtml(item.owner_id || 'N/A')}</span>
        <span class="detail-chip">Image: ${escapeHtml(item.image_url || 'Not supplied')}</span>
        <button class="admin-quick-action" data-edit-accommodation="${escapeHtml(item.id)}">Edit property</button>
        ${['published', 'suspended'].includes(item.status) ? `<button class="admin-quick-action" data-suspend-listing="${escapeHtml(item.id)}" data-listing-table="accommodations" data-listing-status="${item.status === 'published' ? 'suspended' : 'published'}">${item.status === 'published' ? 'Suspend listing' : 'Restore listing'}</button>` : ''}
      `
    } else if (table === 'marketplace_items') {
      kicker.textContent = 'Marketplace item'
      title.textContent = item.title || 'Marketplace listing'
      meta.innerHTML = `<strong>${escapeHtml(item.category || 'General')}</strong><span>•</span><strong>K${Number(item.price || 0).toLocaleString()}</strong><span>•</span><span>${escapeHtml(item.status || 'Published')}</span>`
      description.textContent = item.description || 'No description provided.'
      footer.innerHTML = `
        <span class="detail-chip">Seller: ${escapeHtml(item.seller_display_name || state.profiles.find(profile => profile.id === item.seller_id)?.full_name || 'CampusAura seller')}</span>
        <span class="detail-chip">Seller ID: ${escapeHtml(item.seller_id || 'N/A')}</span>
        <span class="detail-chip">Image: ${escapeHtml(item.image_url || 'Not supplied')}</span>
        ${['published', 'suspended'].includes(item.status) ? `<button class="admin-quick-action" data-suspend-listing="${escapeHtml(item.id)}" data-listing-table="marketplace_items" data-listing-status="${item.status === 'published' ? 'suspended' : 'published'}">${item.status === 'published' ? 'Suspend listing' : 'Restore listing'}</button>` : ''}
      `
    } else if (table === 'events') {
      kicker.textContent = 'Campus event'
      title.textContent = item.title || 'Event'
      meta.innerHTML = `<strong>${escapeHtml(item.location || 'Location unavailable')}</strong><span>•</span><span>${escapeHtml(new Date(item.event_date).toLocaleDateString() || 'Date unavailable')}</span><span>•</span><span>${escapeHtml(item.event_type || 'General')}</span>`
      description.textContent = item.description || 'No event summary provided.'
      footer.innerHTML = `
        <span class="detail-chip">Organizer: ${escapeHtml(item.organizer_name || item.organizer_id || 'N/A')}</span>
        <span class="detail-chip">Image: ${escapeHtml(item.image_url || 'Not supplied')}</span>
        ${['published', 'suspended'].includes(item.status) ? `<button class="admin-quick-action" data-suspend-listing="${escapeHtml(item.id)}" data-listing-table="events" data-listing-status="${item.status === 'published' ? 'suspended' : 'published'}">${item.status === 'published' ? 'Suspend event' : 'Restore event'}</button>` : ''}
      `
    } else if (table === 'profiles') {
      const verification = state.verification.find(document => document.user_id === item.id)
      const studentVerification = state.verification.find(document => document.user_id === item.id && document.requested_role === 'student')
      const requestedRole = item.requested_role || item.role || 'Unknown'
      const accessStatus = item.account_status || 'active'
      const isProvider = item.role === 'provider' || item.requested_role === 'provider'
      const providerAccess = Array.isArray(item.provider_listing_access) ? item.provider_listing_access : null
      const isStudent = requestedRole === 'student'
      const isVerified = isStudent
        ? studentVerification?.status === 'approved' || (!studentVerification && item.verification_status === 'approved')
        : item.role === 'provider' && item.verification_status === 'approved'
      const needsReview = item.verification_status === 'pending' || (isStudent && studentVerification?.status === 'pending')
      kicker.textContent = 'User account'
      title.textContent = item.full_name || 'Unnamed user'
      meta.innerHTML = `
        <span class="profile-detail-badge">${escapeHtml(requestedRole)}</span>
        <span class="profile-detail-badge ${accessStatus === 'frozen' ? 'is-warning' : 'is-success'}">${escapeHtml(accessStatus === 'frozen' ? 'Frozen' : 'Active')}</span>
        <span class="profile-detail-badge ${isVerified ? 'is-success' : needsReview ? 'is-warning' : 'is-muted'}">${isVerified ? 'Verified' : needsReview ? 'Verification pending' : 'Unverified'}</span>
      `
      description.hidden = true
      const renderProfileField = ([label, value]) => `
        <div class="profile-detail-field">
          <dt>${escapeHtml(label)}</dt>
          <dd>${escapeHtml(value || 'Not provided')}</dd>
        </div>
      `
      const renderProfileSection = (heading, fields, className = '') => `
        <section class="profile-detail-section ${className}">
          <h4>${escapeHtml(heading)}</h4>
          <dl class="profile-detail-grid">${fields.map(renderProfileField).join('')}</dl>
        </section>
      `
      const accountFields = [
        ['Account role', item.role],
        ['Requested role', item.requested_role],
        ['Verification status', item.verification_status],
        ['Account access', accessStatus],
        ['Account created', item.created_at ? new Date(item.created_at).toLocaleString() : '']
      ]
      if (accessStatus === 'frozen') {
        accountFields.push(
          ['Frozen on', item.frozen_at ? new Date(item.frozen_at).toLocaleString() : ''],
          ['Freeze reason', item.frozen_reason]
        )
      }
      const verificationFields = verification ? [
        ['Document status', verification.status],
        ['Submitted for', verification.requested_role],
        ['Submitted', verification.created_at ? new Date(verification.created_at).toLocaleString() : ''],
        ['Reviewed', verification.reviewed_at ? new Date(verification.reviewed_at).toLocaleString() : ''],
        ['Reviewed by', verification.reviewed_by]
      ] : []
      if (verification?.rejection_reason) {
        verificationFields.push(['Document review reason', verification.rejection_reason])
      }
      if (item.rejection_reason) {
        verificationFields.push(['Account review reason', item.rejection_reason])
      }
      footer.innerHTML = `
        <div class="profile-detail-sections">
          ${renderProfileSection('Contact details', [
            ['Email address', item.email],
            ['Phone number', item.phone]
          ])}
          ${renderProfileSection('Account and access', accountFields)}
          ${renderProfileSection('Identifiers', [
            ['Reference code', item.reference_code],
            ['Profile ID', item.id],
            ['Avatar URL', item.avatar_url]
          ])}
          ${isProvider ? renderProfileSection('Provider listing access', [
            ['Allowed sections', providerAccess ? providerAccess.map(section => ({
              accommodation: 'Properties',
              marketplace: 'Products and services',
              events: 'Events'
            }[section])).join(', ') : 'Legacy access — both listing sections']
          ]) : ''}
          ${isProvider ? `
            <form class="profile-access-editor" id="providerAccessForm">
              <h4>Manage provider sections</h4>
              <p>Choose one or more sections. Event organizers cannot list properties or marketplace items unless those sections are also explicitly enabled.</p>
              <label><input type="checkbox" name="providerSection" value="accommodation" ${providerAccess === null || providerAccess.includes('accommodation') ? 'checked' : ''}> Properties / accommodation</label>
              <label><input type="checkbox" name="providerSection" value="marketplace" ${providerAccess === null || providerAccess.includes('marketplace') ? 'checked' : ''}> Products and services</label>
              <label><input type="checkbox" name="providerSection" value="events" ${providerAccess?.includes('events') ? 'checked' : ''}> Events organizer</label>
              <button class="admin-quick-action" type="submit">Save provider access</button>
              <p class="profile-access-status" id="providerAccessStatus" role="status" aria-live="polite"></p>
            </form>
          ` : ''}
        <section class="profile-verification-details" aria-label="Verification documents">
          <div class="profile-detail-section">
            <h4>Verification documents</h4>
            ${verification
              ? `<dl class="profile-detail-grid">${verificationFields.map(renderProfileField).join('')}</dl>`
              : '<p class="profile-verification-empty">No verification submission is on file.</p>'}
            <div class="profile-document-actions">
              ${verification?.identity_document_path ? '<button class="admin-link-btn" id="openIdentityDocument" type="button">Open identity document</button>' : ''}
              ${verification?.student_document_path ? '<button class="admin-link-btn" id="openStudentDocument" type="button">Open student document</button>' : ''}
              ${!verification?.identity_document_path && !verification?.student_document_path ? '<span class="muted small">No documents available to open.</span>' : ''}
            </div>
          </div>
        </section>
        </div>
        <section class="profile-detail-actions" aria-label="User account actions">
          <h4>Account actions</h4>
          ${item.role !== 'admin' ? `
            ${accessStatus === 'frozen'
              ? `<button class="admin-reactivate-btn" type="button" data-account-action="active" data-account-id="${escapeHtml(item.id)}">Unfreeze account</button>`
              : `<button class="admin-freeze-btn" type="button" data-account-action="frozen" data-account-id="${escapeHtml(item.id)}">Freeze account</button>`}
            ${needsReview ? `
              <button class="admin-approve-btn" type="button" data-review-user="${escapeHtml(item.id)}" data-review-status="approved">Approve</button>
              <button class="admin-reject-btn" type="button" data-review-user="${escapeHtml(item.id)}" data-review-status="rejected">Reject</button>
            ` : ''}
            <button class="admin-delete" type="button" data-delete-user="${escapeHtml(item.id)}">Delete user</button>
          ` : '<span class="muted small">Administrator accounts cannot be changed here.</span>'}
        </section>
      `
      const openDocument = async path => {
        const result = await client.storage.from('verification-documents').createSignedUrl(path, 300)
        if (result.error) { setMessage(result.error.message, true); return }
        window.open(result.data.signedUrl, '_blank', 'noopener,noreferrer')
      }
      document.getElementById('openIdentityDocument')?.addEventListener('click', () => openDocument(verification.identity_document_path))
      document.getElementById('openStudentDocument')?.addEventListener('click', () => openDocument(verification.student_document_path))
      document.getElementById('providerAccessForm')?.addEventListener('submit', async event => {
        event.preventDefault()
        const selectedSections = [...event.currentTarget.querySelectorAll('input[name="providerSection"]:checked')].map(input => input.value)
        const status = document.getElementById('providerAccessStatus')
        const submitButton = event.currentTarget.querySelector('button[type="submit"]')
        if (!selectedSections.length) {
          status.textContent = 'Select at least one provider section.'
          return
        }
        submitButton.disabled = true
        status.textContent = 'Saving access...'
        const { error } = await client.from('profiles')
          .update({ provider_listing_access: selectedSections })
          .eq('id', item.id)
        submitButton.disabled = false
        if (error) {
          status.textContent = `Could not update access: ${error.message}`
          return
        }
        item.provider_listing_access = selectedSections
        const savedProfile = state.profiles.find(profile => profile.id === item.id)
        if (savedProfile) savedProfile.provider_listing_access = selectedSections
        status.textContent = 'Provider sections updated.'
        setMessage('Provider listing access updated.')
      })
    } else {
      kicker.textContent = 'Message'
      title.textContent = item.name || 'Message'
      meta.innerHTML = `<strong>${escapeHtml(item.email || 'No email')}</strong><span>•</span><span>${escapeHtml(item.topic || 'General inquiry')}</span>`
      description.textContent = item.message || 'No message content.'
      footer.innerHTML = `<span class="detail-chip">Received: ${item.created_at ? new Date(item.created_at).toLocaleString() : 'N/A'}</span>`
    }

    openAdminModal(modal, trigger, modal.querySelector('.admin-details-close'))
  }

  async function init() {
    if (!client) { setMessage('Supabase is unavailable.', true); return }
    const { data: { session } } = await client.auth.getSession()
    if (!session) { window.location.href = 'auth.html'; return }
    const profile = await client.from('profiles').select('role').eq('id', session.user.id).single()
    if (profile.error || profile.data?.role !== 'admin') {
      setMessage('This page is restricted to administrators.', true)
      return
    }
    const name = session.user.user_metadata?.full_name || session.user.email
    const displayName = name || 'Admin'
    const welcomeHeading = document.querySelector('#panel-dashboard .admin-overview-hero h1')
    if (welcomeHeading) {
      welcomeHeading.textContent = `Welcome back, ${displayName.split(' ')[0]} 👋`
    }
    setupTabs();
    setupCreateFormDisclosures()
    setupDirectoryFilters()
    setupForms(session.user);
    setupAnalytics();
    setupActions();
    setupUserList();
    setupAdminEmailComposer();
    try {
      await loadData();
      render();
      setMessage('Admin access granted. Dashboard is live.');
    }
    catch (error) { setMessage(`Could not load admin data: ${error.message}. Confirm supabase/admin-dashboard-controls.sql has been applied.`, true) }
  }

  document.addEventListener('DOMContentLoaded', init)
})()
