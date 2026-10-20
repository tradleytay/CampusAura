// CampusAura Supabase client.
// The publishable key is safe for browser use when Row Level Security is enabled.
(function () {
  const supabaseUrl = 'https://enzemdcsfoxbpjyvyknh.supabase.co'
  const supabasePublishableKey = 'sb_publishable_Y19u3Jd1O7uhFOzsF_jPvw_uEOYQqhS'

  if (!window.supabase) {
    console.error('Supabase library is unavailable.')
    return
  }

  const client = window.supabase.createClient(
    supabaseUrl,
    supabasePublishableKey
  )

  window.campusAuraSupabase = client

  if (!window.campusAuraEmail) {
    async function getFunctionError(error) {
      const response = error.context
      if (!response || typeof response.clone !== 'function') return error

      const body = await response.clone().text()
      let message = ''
      if (body) {
        try {
          const payload = JSON.parse(body)
          message = payload.error || payload.message || ''
        } catch (parseError) {
          if (!(parseError instanceof SyntaxError)) throw parseError
        }
      }

      return new Error(message
        ? `${message} (HTTP ${response.status})`
        : `Email function returned HTTP ${response.status}. Check the Supabase Edge Function logs.`)
    }

    async function sendEmail(payload) {
      const { data, error } = await client.functions.invoke('campus-aura-email', {
        body: payload
      })

      if (error) throw await getFunctionError(error)
      if (!data?.ok) throw new Error(data?.error || 'Email delivery failed.')
      return data
    }

    window.campusAuraEmail = {
      sendRegistrationEmail() {
        return sendEmail({ template: 'registration' })
      },
      sendReviewDecisionEmail({ userId, status }) {
        return sendEmail({ template: 'decision', userId, status })
      },
      sendAdminMessageEmail({ userId, subject, body }) {
        return sendEmail({ template: 'admin-message', userId, subject, body })
      }
    }
  }
})()