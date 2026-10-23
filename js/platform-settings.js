(function () {
  const client = window.campusAuraSupabase

  function renderBrand(settings) {
    document.querySelectorAll('.brand-text').forEach(element => {
      element.textContent = settings.platform_name
    })
    document.querySelectorAll('.admin-brand > span').forEach(element => {
      const name = Array.from(element.childNodes).find(node => node.nodeType === Node.TEXT_NODE)
      if (name) name.nodeValue = settings.platform_name + ' '
    })
    if (settings.logo_url) {
      document.querySelectorAll('.brand-logo, .admin-brand-logo').forEach(image => {
        image.src = settings.logo_url
      })
    }
    document.querySelectorAll('title').forEach(title => {
      title.textContent = title.textContent.replace(/CampusAura/g, settings.platform_name)
    })
    document.querySelectorAll('a[href^="mailto:hello@campusaura.com"]').forEach(link => {
      link.href = `mailto:${settings.contact_email}`
      const label = link.querySelector('strong')
      if (label) label.textContent = settings.contact_email
      else if (link.textContent.includes('hello@campusaura.com')) link.textContent = settings.contact_email
    })
    if (settings.support_url) {
      document.querySelectorAll('a[href="contact.html"], a[href="./contact.html"]').forEach(link => {
        link.href = settings.support_url
      })
    }
    if (settings.contact_phone) {
      document.querySelectorAll('a[href^="tel:"]').forEach(link => {
        link.href = `tel:${settings.contact_phone.replace(/[^\d+]/g, '')}`
        const label = link.querySelector('strong')
        if (label) label.textContent = settings.contact_phone
      })
    }
  }

  function addNotice(className, label, text) {
    const notice = document.createElement('aside')
    notice.className = `platform-site-notice ${className}`
    notice.setAttribute('role', 'status')
    const heading = document.createElement('strong')
    heading.textContent = label
    const message = document.createElement('span')
    message.textContent = text
    notice.append(heading, message)
    document.body.prepend(notice)
  }

  async function applyPublicSettings() {
    const { data: settings, error } = await client
      .from('platform_settings')
      .select('platform_name, logo_url, contact_email, contact_phone, support_url, maintenance_mode, maintenance_message')
      .eq('id', 1)
      .maybeSingle()
    if (error) throw error
    if (settings) {
      renderBrand(settings)
      if (settings.maintenance_mode) addNotice('platform-site-notice-maintenance', 'Maintenance notice', settings.maintenance_message)
    }
    const { data: announcements, error: announcementError } = await client
      .from('platform_announcements')
      .select('title, message')
      .eq('is_published', true)
      .or(`starts_at.is.null,starts_at.lte.${new Date().toISOString()}`)
      .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(3)
    if (announcementError) throw announcementError
    ;(announcements || []).reverse().forEach(announcement => {
      addNotice('platform-site-notice-announcement', announcement.title, announcement.message)
    })
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!client) {
      console.error('Platform settings could not load because Supabase is unavailable.')
      return
    }
    applyPublicSettings().catch(error => {
      console.error('Could not load platform settings or announcements:', error)
    })
  })
})()
