(function () {
  const client = window.campusAuraSupabase

  function setStatus(id, message, isError = false) {
    const status = document.getElementById(id)
    if (!status) return
    status.textContent = message
    status.classList.toggle('is-error', isError)
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

  function getSupportUrl(value) {
    const trimmed = value.trim()
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    if (/^[a-z0-9][a-z0-9/_-]*(?:\.html)?(?:[?#].*)?$/i.test(trimmed)) return trimmed
    throw new Error('Enter a valid support-page URL or a relative page path such as contact.html.')
  }

  function localDateTime(value) {
    if (!value) return null
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid announcement date.')
    return date.toISOString()
  }

  function toLocalDateTimeInput(value) {
    if (!value) return ''
    const date = new Date(value)
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
    return date.toISOString().slice(0, 16)
  }

  function formatDateTime(value) {
    return value ? new Date(value).toLocaleString() : 'No date set'
  }

  function setupAdminSettings() {
    const platformForm = document.getElementById('platformSettingsForm')
    if (!platformForm) return
    const platformStatus = document.getElementById('platformSettingsStatus')
    const announcementForm = document.getElementById('platformAnnouncementForm')
    const announcementStatus = document.getElementById('announcementStatus')
    const integrationStatus = document.getElementById('integrationStatus')
    let editingAnnouncementId = null

    async function loadPlatformSettings() {
      const { data, error } = await client.from('platform_settings')
        .select('platform_name, logo_url, contact_email, contact_phone, support_url, maintenance_mode, maintenance_message')
        .eq('id', 1)
        .single()
      if (error) throw error
      document.getElementById('platformName').value = data.platform_name
      document.getElementById('platformLogoUrl').value = data.logo_url || ''
      document.getElementById('platformContactEmail').value = data.contact_email
      document.getElementById('platformContactPhone').value = data.contact_phone || ''
      document.getElementById('platformSupportUrl').value = data.support_url
      document.getElementById('platformMaintenanceMode').checked = data.maintenance_mode
      document.getElementById('platformMaintenanceMessage').value = data.maintenance_message
    }

    async function loadAnnouncements() {
      const { data, error } = await client.from('platform_announcements')
        .select('id, title, message, is_published, starts_at, ends_at, created_at')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      document.getElementById('platformAnnouncementsTable').innerHTML = (data || []).map(item => `
        <tr>
          <td><strong>${escapeHtml(item.title)}</strong><br><span class="muted small">${escapeHtml(item.message)}</span></td>
          <td>${escapeHtml(formatDateTime(item.starts_at))}<br>Ends: ${escapeHtml(formatDateTime(item.ends_at))}</td>
          <td>${item.is_published ? 'Published / scheduled' : 'Draft'}</td>
          <td><button class="admin-quick-action" type="button" data-announcement-edit="${escapeHtml(item.id)}">Edit</button> <button class="admin-quick-action" type="button" data-announcement-delete="${escapeHtml(item.id)}">Delete</button></td>
        </tr>`).join('') || '<tr><td colspan="4" class="admin-recent-empty">No announcements have been created.</td></tr>'
    }

    async function loadAuditLogs() {
      const { data, error } = await client.from('admin_audit_logs')
        .select('id, actor_id, action, table_name, record_id, changed_fields, created_at, profiles(full_name, email)')
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      document.getElementById('adminAuditLogsTable').innerHTML = (data || []).map(item => `
        <tr><td>${escapeHtml(formatDateTime(item.created_at))}</td>
        <td>${escapeHtml(item.profiles?.full_name || item.profiles?.email || 'Administrator account')}</td>
        <td>${escapeHtml(item.action)}</td><td>${escapeHtml(item.table_name)}</td>
        <td>${escapeHtml((item.changed_fields || []).join(', ') || '—')}</td></tr>`).join('')
        || '<tr><td colspan="5" class="admin-recent-empty">No administrator changes are recorded yet.</td></tr>'
    }

    async function loadAdministrators() {
      const { data, error } = await client.from('profiles')
        .select('id, full_name, email, role')
        .order('full_name', { ascending: true })
      if (error) throw error
      const { data: { user }, error: userError } = await client.auth.getUser()
      if (userError) throw userError
      const administrators = (data || []).filter(profile => profile.role === 'admin')
      const otherUsers = (data || []).filter(profile => profile.role !== 'admin')
      const userSelect = document.getElementById('adminAccessUser')
      userSelect.innerHTML = '<option value="">Select a user</option>' + otherUsers.map(profile =>
        `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.full_name || profile.email || 'User')} · ${escapeHtml(profile.role)}</option>`
      ).join('')
      document.getElementById('adminAdministratorsTable').innerHTML = administrators.map(profile => `
        <tr><td>${escapeHtml(profile.full_name || 'Administrator')}</td><td>${escapeHtml(profile.email || '')}</td>
        <td>${profile.id === user?.id ? 'Current administrator' : `<button class="admin-quick-action" type="button" data-remove-admin="${escapeHtml(profile.id)}">Remove access</button>`}</td></tr>`
      ).join('') || '<tr><td colspan="3" class="admin-recent-empty">No administrators were found.</td></tr>'
    }

    Promise.all([loadPlatformSettings(), loadAnnouncements(), loadAuditLogs(), loadAdministrators()])
      .catch(error => {
        platformStatus.textContent = `Could not load admin settings. Apply supabase/dashboard-settings.sql, then reload: ${error.message}`
        platformStatus.classList.add('is-error')
      })

    platformForm.addEventListener('submit', async event => {
      event.preventDefault()
      if (!platformForm.reportValidity()) return
      const submit = platformForm.querySelector('[type="submit"]')
      submit.disabled = true
      platformStatus.textContent = 'Saving platform settings…'
      platformStatus.classList.remove('is-error')
      try {
        const supportUrl = getSupportUrl(document.getElementById('platformSupportUrl').value)
        const logoUrl = document.getElementById('platformLogoUrl').value.trim()
        if (logoUrl && new URL(logoUrl).protocol !== 'https:') {
          throw new Error('The logo URL must use HTTPS.')
        }
        const { data: { user }, error: userError } = await client.auth.getUser()
        if (userError) throw userError
        const { error } = await client.from('platform_settings').update({
          platform_name: document.getElementById('platformName').value.trim(),
          logo_url: logoUrl,
          contact_email: document.getElementById('platformContactEmail').value.trim(),
          contact_phone: document.getElementById('platformContactPhone').value.trim(),
          support_url: supportUrl,
          maintenance_mode: document.getElementById('platformMaintenanceMode').checked,
          maintenance_message: document.getElementById('platformMaintenanceMessage').value.trim(),
          updated_at: new Date().toISOString(),
          updated_by: user?.id || null
        }).eq('id', 1)
        if (error) throw error
        platformStatus.textContent = 'Platform settings saved. Public pages will show the updated details on reload.'
      } catch (error) {
        platformStatus.textContent = `Could not save platform settings: ${error.message}`
        platformStatus.classList.add('is-error')
      } finally {
        submit.disabled = false
      }
    })

    announcementForm.addEventListener('submit', async event => {
      event.preventDefault()
      if (!announcementForm.reportValidity()) return
      const submit = announcementForm.querySelector('[type="submit"]')
      submit.disabled = true
      announcementStatus.textContent = 'Saving announcement…'
      announcementStatus.classList.remove('is-error')
      try {
        const startsAt = localDateTime(document.getElementById('announcementStartsAt').value)
        const endsAt = localDateTime(document.getElementById('announcementEndsAt').value)
        if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
          throw new Error('The end time must be after the start time.')
        }
        const { data: { user }, error: userError } = await client.auth.getUser()
        if (userError) throw userError
        if (!user) throw new Error('Your session has expired. Sign in again to save an announcement.')
        const announcement = {
          title: document.getElementById('announcementTitle').value.trim(),
          message: document.getElementById('announcementMessage').value.trim(),
          is_published: document.getElementById('announcementPublish').checked,
          starts_at: startsAt,
          ends_at: endsAt,
          updated_at: new Date().toISOString()
        }
        const result = editingAnnouncementId
          ? await client.from('platform_announcements').update(announcement).eq('id', editingAnnouncementId)
          : await client.from('platform_announcements').insert({ ...announcement, created_by: user.id })
        if (result.error) throw result.error
        editingAnnouncementId = null
        announcementForm.reset()
        announcementForm.querySelector('[type="submit"]').textContent = 'Create announcement'
        await loadAnnouncements()
        announcementStatus.textContent = 'Announcement saved.'
      } catch (error) {
        announcementStatus.textContent = `Could not save announcement: ${error.message}`
        announcementStatus.classList.add('is-error')
      } finally {
        submit.disabled = false
      }
    })

    announcementForm.addEventListener('click', async event => {
      const editButton = event.target.closest('[data-announcement-edit]')
      const deleteButton = event.target.closest('[data-announcement-delete]')
      if (editButton) {
        const { data, error } = await client.from('platform_announcements').select('*').eq('id', editButton.dataset.announcementEdit).single()
        if (error) {
          setStatus('announcementStatus', `Could not load announcement: ${error.message}`, true)
          return
        }
        editingAnnouncementId = data.id
        document.getElementById('announcementTitle').value = data.title
        document.getElementById('announcementMessage').value = data.message
        document.getElementById('announcementPublish').checked = data.is_published
        document.getElementById('announcementStartsAt').value = toLocalDateTimeInput(data.starts_at)
        document.getElementById('announcementEndsAt').value = toLocalDateTimeInput(data.ends_at)
        announcementForm.querySelector('[type="submit"]').textContent = 'Save announcement'
      } else if (deleteButton) {
        if (!window.confirm('Delete this announcement? This cannot be undone.')) return
        const { error } = await client.from('platform_announcements').delete().eq('id', deleteButton.dataset.announcementDelete)
        if (error) {
          setStatus('announcementStatus', `Could not delete announcement: ${error.message}`, true)
          return
        }
        await loadAnnouncements()
        setStatus('announcementStatus', 'Announcement deleted.')
      }
    })

    document.getElementById('adminAccessForm').addEventListener('submit', async event => {
      event.preventDefault()
      const status = document.getElementById('adminAccessStatus')
      const button = event.currentTarget.querySelector('[type="submit"]')
      const userId = document.getElementById('adminAccessUser').value
      if (!userId) return
      button.disabled = true
      status.textContent = 'Updating administrator access…'
      status.classList.remove('is-error')
      try {
        const { error } = await client.rpc('admin_set_admin_access', { p_user_id: userId, p_enabled: true })
        if (error) throw error
        await Promise.all([loadAdministrators(), loadAuditLogs()])
        status.textContent = 'Administrator access granted.'
      } catch (error) {
        status.textContent = `Could not change administrator access: ${error.message}`
        status.classList.add('is-error')
      } finally {
        button.disabled = false
      }
    })

    document.getElementById('adminAdministratorsTable').addEventListener('click', async event => {
      const button = event.target.closest('[data-remove-admin]')
      if (!button || !window.confirm('Remove administrator access from this account?')) return
      button.disabled = true
      try {
        const { error } = await client.rpc('admin_set_admin_access', { p_user_id: button.dataset.removeAdmin, p_enabled: false })
        if (error) throw error
        setStatus('adminAccessStatus', 'Administrator access removed.')
        await Promise.all([loadAdministrators(), loadAuditLogs()])
      } catch (error) {
        setStatus('adminAccessStatus', `Could not remove administrator access: ${error.message}`, true)
        button.disabled = false
      }
    })

    document.getElementById('checkIntegrationsBtn').addEventListener('click', async event => {
      const button = event.currentTarget
      button.disabled = true
      integrationStatus.textContent = 'Checking Supabase and email configuration…'
      integrationStatus.classList.remove('is-error')
      document.getElementById('settingsSupabaseStatus').textContent = 'Checking…'
      document.getElementById('settingsResendStatus').textContent = 'Checking…'
      document.getElementById('settingsSenderStatus').textContent = 'Checking…'
      try {
        const { error: databaseError } = await client.from('platform_settings').select('id').eq('id', 1).single()
        if (databaseError) throw databaseError
        document.getElementById('settingsSupabaseStatus').textContent = 'Connected'
        const { data, error } = await client.functions.invoke('campus-aura-email', { method: 'GET' })
        if (error) throw error
        if (!data?.ok) throw new Error(data?.error || 'The email status endpoint did not return a status.')
        document.getElementById('settingsResendStatus').textContent = data.resendConfigured ? 'Configured' : 'Not configured'
        document.getElementById('settingsSenderStatus').textContent = data.senderConfigured ? 'Configured' : 'Not configured'
        integrationStatus.textContent = 'Supabase is connected. Email checks confirm only whether server settings are configured, not whether Resend will accept or deliver email.'
      } catch (error) {
        if (document.getElementById('settingsSupabaseStatus').textContent === 'Checking…') {
          document.getElementById('settingsSupabaseStatus').textContent = 'Unavailable'
        }
        document.getElementById('settingsResendStatus').textContent = 'Check unavailable'
        document.getElementById('settingsSenderStatus').textContent = 'Check unavailable'
        integrationStatus.textContent = `Could not check integrations: ${error.message}. Confirm the dashboard settings migration and email function deployment.`
        integrationStatus.classList.add('is-error')
      } finally {
        button.disabled = false
      }
    })
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!client) return
    setupAdminSettings()
  })
})()
