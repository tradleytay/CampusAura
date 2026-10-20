(function () {
  const client = window.campusAuraSupabase

  async function init() {
    const status = document.getElementById('frozenStatus')
    const signOut = document.getElementById('frozenSignOut')
    signOut.addEventListener('click', async () => {
      await client?.auth.signOut()
      window.location.href = 'auth.html'
    })

    if (!client) {
      status.textContent = 'Account status is unavailable. Please contact CampusAura.'
      return
    }
    const { data: { session } } = await client.auth.getSession()
    if (!session) {
      window.location.replace('auth.html')
      return
    }
    const { data: profile, error } = await client
      .from('profiles')
      .select('full_name, role, requested_role, account_status, frozen_reason')
      .eq('id', session.user.id)
      .single()
    if (error || !profile) {
      status.textContent = 'We could not load your account status. Please contact CampusAura.'
      return
    }
    if (profile.role === 'admin') {
      window.location.replace('admin.html')
      return
    }
    if (profile.account_status !== 'frozen') {
      const isProvider = profile.role === 'provider' || profile.requested_role === 'provider'
      window.location.replace(isProvider ? 'provider.html' : 'student.html')
      return
    }
    status.textContent = profile.full_name ? `Account holder: ${profile.full_name}` : 'Your account remains available for support.'
    if (profile.frozen_reason) {
      document.getElementById('frozenReason').textContent = profile.frozen_reason
      document.getElementById('frozenReasonWrap').hidden = false
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    init().catch(error => {
      document.getElementById('frozenStatus').textContent = `Could not check your account status: ${error.message}`
    })
  })
})()
