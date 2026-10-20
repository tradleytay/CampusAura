import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const htmlEntities: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
}

type EmailRequest =
  | { template: 'registration' }
  | { template: 'decision'; userId: string; status: 'approved' | 'rejected' }

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => htmlEntities[character])
}

function buildMessage(template: EmailRequest, name: string, reason: string) {
  if (template.template === 'registration') {
    return {
      subject: 'Your CampusAura account is under review',
      text: `Hello ${name},\n\nThank you for creating a CampusAura account. Your details and verification documents have been submitted for review. We will notify you when the team makes a decision.\n\nRegards,\nCampusAura Team`
    }
  }

  if (template.status === 'approved') {
    return {
      subject: 'Your CampusAura account has been approved',
      text: `Hello ${name},\n\nYour CampusAura account has been approved. You can now sign in and access your dashboard.\n\nWelcome to CampusAura.\n\nRegards,\nCampusAura Team`
    }
  }

  return {
    subject: 'Your CampusAura account application was not approved',
    text: `Hello ${name},\n\nThank you for your interest in CampusAura. After review, your application was not approved.\n\nReason: ${reason || 'No additional reason was provided.'}\n\nIf you believe this was a mistake or would like to provide more information, please contact CampusAura support.\n\nRegards,\nCampusAura Team`
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405)
  }

  try {
    const authorization = request.headers.get('Authorization')
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    const sender = Deno.env.get('CAMPUSAURA_EMAIL_FROM')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!authorization?.startsWith('Bearer ')) {
      return jsonResponse({ ok: false, error: 'Authentication is required.' }, 401)
    }
    if (!resendApiKey || !sender || !supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      console.error('Email function is missing required server configuration.')
      return jsonResponse({ ok: false, error: 'Email service is not configured.' }, 503)
    }

    const token = authorization.slice('Bearer '.length)
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: { user }, error: authError } = await userClient.auth.getUser(token)
    if (authError || !user) {
      return jsonResponse({ ok: false, error: 'Your session is invalid or expired.' }, 401)
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const payload = await request.json() as Record<string, unknown>
    let recipient: string
    let name: string
    let messageRequest: EmailRequest | null = null
    let customMessage: { subject: string; text: string } | null = null
    let outboxRecipient: { userId: string; name: string } | null = null
    let reason = ''

    if (payload.template === 'registration') {
      messageRequest = { template: 'registration' }
      if (!user.email || !user.email_confirmed_at) {
        return jsonResponse({ ok: false, error: 'A confirmed account is required.' }, 403)
      }
      const { data: profile, error: profileError } = await serviceClient
        .from('profiles')
        .select('full_name, email, verification_status')
        .eq('id', user.id)
        .maybeSingle()
      if (profileError) throw profileError
      if (!profile || profile.verification_status !== 'pending') {
        return jsonResponse({ ok: false, error: 'A pending account profile is required.' }, 409)
      }

      const { data: documents, error: documentsError } = await serviceClient
        .from('verification_documents')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .limit(1)
        .maybeSingle()
      if (documentsError) throw documentsError
      if (!documents) {
        return jsonResponse({ ok: false, error: 'Submit verification documents before sending the review notification.' }, 409)
      }

      recipient = user.email
      name = profile.full_name || 'there'
    } else if (
      payload.template === 'decision'
      && typeof payload.userId === 'string'
      && (payload.status === 'approved' || payload.status === 'rejected')
    ) {
      const { data: adminProfile, error: adminError } = await serviceClient
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      if (adminError) throw adminError
      if (adminProfile?.role !== 'admin') {
        return jsonResponse({ ok: false, error: 'Administrator access is required.' }, 403)
      }

      const { data: profile, error: profileError } = await serviceClient
        .from('profiles')
        .select('full_name, email, verification_status, rejection_reason')
        .eq('id', payload.userId)
        .maybeSingle()
      if (profileError) throw profileError
      if (!profile || profile.verification_status !== payload.status) {
        return jsonResponse({ ok: false, error: 'The account does not have the requested review status.' }, 409)
      }

      const { data: targetUser, error: targetUserError } = await serviceClient.auth.admin.getUserById(payload.userId)
      if (targetUserError) throw targetUserError
      const targetEmail = targetUser.user?.email || profile.email
      if (!targetEmail) {
        return jsonResponse({ ok: false, error: 'The account does not have an email address.' }, 409)
      }

      recipient = targetEmail
      name = profile.full_name || 'there'
      messageRequest = {
        template: 'decision',
        userId: payload.userId,
        status: payload.status
      }
      outboxRecipient = { userId: payload.userId, name }
      reason = profile.rejection_reason || ''
    } else if (
      payload.template === 'admin-message'
      && typeof payload.userId === 'string'
      && typeof payload.subject === 'string'
      && typeof payload.body === 'string'
    ) {
      const subject = payload.subject.trim()
      const body = payload.body.trim()
      if (!subject || subject.length > 180 || /[\r\n]/.test(subject)) {
        return jsonResponse({ ok: false, error: 'Enter a subject of 1 to 180 characters on one line.' }, 400)
      }
      if (!body || body.length > 10000) {
        return jsonResponse({ ok: false, error: 'Enter a message of 1 to 10,000 characters.' }, 400)
      }

      const { data: adminProfile, error: adminError } = await serviceClient
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()
      if (adminError) throw adminError
      if (adminProfile?.role !== 'admin') {
        return jsonResponse({ ok: false, error: 'Administrator access is required.' }, 403)
      }

      const { data: profile, error: profileError } = await serviceClient
        .from('profiles')
        .select('full_name, role, requested_role, email')
        .eq('id', payload.userId)
        .maybeSingle()
      if (profileError) throw profileError
      const targetRole = profile?.requested_role || profile?.role
      if (!profile || profile.role === 'admin' || !['student', 'provider'].includes(targetRole)) {
        return jsonResponse({ ok: false, error: 'Choose a registered student or provider.' }, 404)
      }

      const { data: targetUser, error: targetUserError } = await serviceClient.auth.admin.getUserById(payload.userId)
      if (targetUserError) throw targetUserError
      const targetEmail = targetUser.user?.email || profile.email
      if (!targetEmail) {
        return jsonResponse({ ok: false, error: 'The account does not have an email address.' }, 409)
      }

      recipient = targetEmail
      name = profile.full_name || 'there'
      customMessage = { subject, text: body }
      outboxRecipient = { userId: payload.userId, name }
    } else {
      return jsonResponse({ ok: false, error: 'Invalid email notification request.' }, 400)
    }

    const message = customMessage || (messageRequest ? buildMessage(messageRequest, name, reason) : null)
    if (!message) throw new Error('Email message could not be prepared.')
    const greeting = escapeHtml(name)
    const html = customMessage
      ? `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#122033">${customMessage.text.split(/\n{2,}/).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('')}</div>`
      : `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#122033"><p>Hello ${greeting},</p>${message.text.split('\n\n').slice(1).map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('')}</div>`
    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: sender,
        to: [recipient],
        subject: message.subject,
        text: message.text,
        html
      })
    })
    if (!resendResponse.ok) {
      const errorBody = await resendResponse.text()
      console.error('Resend rejected a CampusAura notification:', resendResponse.status, errorBody)
      return jsonResponse({ ok: false, error: 'Resend could not deliver the notification. Check the sender domain and Resend logs.' }, 502)
    }

    const resendResult = await resendResponse.json()
    let outboxLogged = !outboxRecipient
    if (outboxRecipient) {
      const { error: outboxError } = await serviceClient.from('admin_outbox').insert({
        recipient_user_id: outboxRecipient.userId,
        recipient_name: outboxRecipient.name,
        recipient_email: recipient,
        subject: message.subject,
        body: message.text,
        sent_by: user.id,
        provider_message_id: resendResult.id
      })
      if (outboxError) {
        console.error('Email was delivered, but the admin outbox could not be updated:', outboxError)
      } else {
        outboxLogged = true
      }
    }
    return jsonResponse({ ok: true, id: resendResult.id, outboxLogged })
  } catch (error) {
    console.error('CampusAura email function failed:', error)
    return jsonResponse({ ok: false, error: 'The email notification could not be sent.' }, 500)
  }
})
