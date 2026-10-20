// CampusAura app.js - dynamic rendering and UI interactions
const data = {
  accommodations: [],
  marketplace: [],
  events: []
}
let publishedAtMigrationWarningShown = false

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;'
}[character]))

function getLocalCalendarDate(value){
  if(!value) return null
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value)
  return Number.isNaN(date.getTime())
    ? null
    : new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function getUpcomingEvents(events = data.events){
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return events
    .filter(event => {
      const date = getLocalCalendarDate(event.eventDate)
      return date && date >= today
    })
    .sort((first, second) => getLocalCalendarDate(first.eventDate) - getLocalCalendarDate(second.eventDate))
}

function formatEventDate(value){
  const date = getLocalCalendarDate(value)
  return date
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'Date to be announced'
}

function formatAddedDate(value){
  if(!value) return 'Recently added'
  const date = new Date(value)
  if(Number.isNaN(date.getTime())) return 'Recently added'
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  date.setHours(0, 0, 0, 0)
  const daysAgo = Math.floor((today - date) / 86400000)
  if(daysAgo <= 0) return 'Added today'
  if(daysAgo === 1) return 'Added yesterday'
  if(daysAgo < 7) return `Added ${daysAgo} days ago`
  return `Added ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

const homeCarouselState = {
  page: 0,
  pageCount: 0,
  timer: null,
  paused: false,
  inView: false,
  refreshInProgress: false,
  realtimeChannel: null,
  firstItemId: null,
  initialized: false,
  rebuild: null
}

function getHomeCarouselPageSize(){
  if(window.matchMedia('(max-width: 600px)').matches) return 1
  if(window.matchMedia('(max-width: 820px)').matches) return 2
  return 3
}

function updateHomeCarousel(){
  const track = document.getElementById('freshContentList')
  const count = document.getElementById('freshSlideCount')
  const dots = document.getElementById('freshSlideDots')
  const previous = document.getElementById('freshPrevious')
  const next = document.getElementById('freshNext')
  const pause = document.getElementById('freshPause')
  if(!track || !count || !dots) return

  const slides = [...track.querySelectorAll('.home-fresh-slide')]
  homeCarouselState.pageCount = slides.length
  homeCarouselState.page = slides.length
    ? Math.min(homeCarouselState.page, slides.length - 1)
    : 0
  track.style.transform = `translateX(-${homeCarouselState.page * 100}%)`
  slides.forEach((slide, index) => {
    const isActive = index === homeCarouselState.page
    slide.classList.toggle('is-active', isActive)
    slide.setAttribute('aria-hidden', String(!isActive))
    slide.querySelectorAll('button').forEach(button => {
      button.tabIndex = isActive ? 0 : -1
    })
    slide.querySelectorAll('.listing-card').forEach(card => {
      card.classList.toggle('is-visible', isActive)
      card.tabIndex = isActive ? 0 : -1
    })
  })
  count.textContent = slides.length
    ? `${homeCarouselState.page + 1} / ${slides.length}`
    : '0 / 0'
  if(previous) previous.disabled = slides.length < 2
  if(next) next.disabled = slides.length < 2
  if(pause){
    pause.disabled = slides.length < 2
    pause.setAttribute('aria-pressed', String(homeCarouselState.paused))
    pause.setAttribute('aria-label', homeCarouselState.paused ? 'Resume automatic slides' : 'Pause automatic slides')
    pause.textContent = homeCarouselState.paused ? '▶' : 'Ⅱ'
  }
  dots.innerHTML = slides.map((_, index) => `
    <button type="button" class="home-carousel-dot${index === homeCarouselState.page ? ' is-active' : ''}" data-carousel-page="${index}" aria-label="Go to slide ${index + 1}" aria-current="${index === homeCarouselState.page ? 'true' : 'false'}"></button>
  `).join('')
}

function setHomeCarouselPage(page){
  if(!homeCarouselState.pageCount) return
  homeCarouselState.page = (page + homeCarouselState.pageCount) % homeCarouselState.pageCount
  updateHomeCarousel()
}

function setupHomeCarousel(){
  const carousel = document.getElementById('freshCarousel')
  const track = document.getElementById('freshContentList')
  if(!carousel || !track) return
  if(homeCarouselState.initialized){
    homeCarouselState.rebuild?.()
    return
  }

  const previous = document.getElementById('freshPrevious')
  const next = document.getElementById('freshNext')
  const pause = document.getElementById('freshPause')
  const dots = document.getElementById('freshSlideDots')
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const stopTimer = () => {
    if(homeCarouselState.timer){
      window.clearInterval(homeCarouselState.timer)
      homeCarouselState.timer = null
    }
  }
  const startTimer = () => {
    stopTimer()
    if(homeCarouselState.paused || !homeCarouselState.inView || reducedMotion.matches || homeCarouselState.pageCount < 2) return
    homeCarouselState.timer = window.setInterval(() => {
      if(document.visibilityState === 'visible' && !carousel.matches(':hover') && !carousel.contains(document.activeElement)){
        setHomeCarouselPage(homeCarouselState.page + 1)
      }
    }, 6000)
  }
  const rebuild = () => {
    const items = [...track.querySelectorAll('.home-update-card')]
    if(!items.length){
      homeCarouselState.page = 0
      track.style.transform = ''
      updateHomeCarousel()
      stopTimer()
      return
    }
    const pageSize = getHomeCarouselPageSize()
    const currentItem = Math.min(homeCarouselState.page * pageSize, items.length - 1)
    homeCarouselState.page = Math.floor(currentItem / pageSize)
    const fragment = document.createDocumentFragment()
    for(let start = 0; start < items.length; start += pageSize){
      const slide = document.createElement('div')
      slide.className = 'home-fresh-slide'
      slide.setAttribute('role', 'group')
      slide.setAttribute('aria-roledescription', 'slide')
      slide.setAttribute('aria-label', `${Math.floor(start / pageSize) + 1} of ${Math.ceil(items.length / pageSize)}`)
      const grid = document.createElement('div')
      grid.className = `grid cards home-feed-grid home-fresh-grid home-fresh-page home-fresh-page-${pageSize}`
      items.slice(start, start + pageSize).forEach(item => grid.appendChild(item))
      slide.appendChild(grid)
      fragment.appendChild(slide)
    }
    track.replaceChildren(fragment)
    updateHomeCarousel()
    startTimer()
  }
  homeCarouselState.rebuild = rebuild
  homeCarouselState.initialized = true

  previous?.addEventListener('click', () => {
    setHomeCarouselPage(homeCarouselState.page - 1)
    startTimer()
  })
  next?.addEventListener('click', () => {
    setHomeCarouselPage(homeCarouselState.page + 1)
    startTimer()
  })
  pause?.addEventListener('click', () => {
    homeCarouselState.paused = !homeCarouselState.paused
    updateHomeCarousel()
    startTimer()
  })
  dots?.addEventListener('click', event => {
    const button = event.target.closest('[data-carousel-page]')
    if(!button) return
    setHomeCarouselPage(Number(button.dataset.carouselPage))
    startTimer()
  })
  carousel.addEventListener('mouseenter', stopTimer)
  carousel.addEventListener('mouseleave', startTimer)
  carousel.addEventListener('focusin', stopTimer)
  carousel.addEventListener('focusout', event => {
    if(!carousel.contains(event.relatedTarget)) startTimer()
  })
  carousel.addEventListener('keydown', event => {
    if(event.key === 'ArrowLeft') setHomeCarouselPage(homeCarouselState.page - 1)
    if(event.key === 'ArrowRight') setHomeCarouselPage(homeCarouselState.page + 1)
  })
  window.addEventListener('resize', rebuild)
  document.addEventListener('visibilitychange', () => {
    if(document.visibilityState === 'visible') startTimer()
    else stopTimer()
  })
  if('IntersectionObserver' in window){
    const observer = new IntersectionObserver(entries => {
      const entry = entries.find(candidate => candidate.target === carousel)
      if(entry){
        homeCarouselState.inView = entry.isIntersecting
        if(entry.isIntersecting){
          carousel.classList.add('is-visible')
          startTimer()
        } else {
          stopTimer()
        }
      }
    }, { threshold: 0.12 })
    observer.observe(carousel)
  } else {
    homeCarouselState.inView = true
    carousel.classList.add('is-visible')
  }

  rebuild()
}

function safeImageUrl(value, fallback) {
  const source = String(value ?? '').trim()
  if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(source)) return source
  try {
    const url = new URL(source, window.location.href)
    if (url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === window.location.origin)) {
      return url.href
    }
  } catch {}
  return fallback
}

function getListingImageUrls(item, fallback) {
  const stored = Array.isArray(item?.image_urls) ? item.image_urls : []
  const urls = [...new Set(stored.map(url => String(url || '').trim()).filter(Boolean))]
  const primary = String(item?.image_url || '').trim()
  if (primary && !urls.includes(primary)) urls.unshift(primary)
  return urls.length ? urls : [fallback]
}

// Utility selectors
const $ = (sel)=>document.querySelector(sel)
const $$ = (sel)=>Array.from(document.querySelectorAll(sel))

function renderEmptyCollection(container, title, message, actionHref, actionLabel){
  if(!container) return
  container.innerHTML = `
    <div class="empty-collection">
      <div class="empty-collection-mark">+</div>
      <h3>${title}</h3>
      <p>${message}</p>
      ${actionHref ? `<a class="btn btn-secondary" href="${actionHref}">${actionLabel}</a>` : ''}
    </div>
  `
}

function getDashboardName(role){
  if(role === 'admin') return 'Admin Dashboard'
  if(role === 'provider') return 'Provider Dashboard'
  return 'Student Dashboard'
}

function getUserInitials(user){
  const name = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || ''
  const parts = String(name).trim().split(/[\s._-]+/).filter(Boolean)
  return parts.length > 1
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : (parts[0] || '?').slice(0, 2).toUpperCase()
}

function setAuthNavState(link, role, targetPage, user){
  if(!link) return
  const isSignedIn = Boolean(role && targetPage)
  const label = isSignedIn ? getDashboardName(role) : 'Sign in'
  const avatar = isSignedIn
    ? `<span class="nav-account-avatar" aria-hidden="true">${escapeHtml(getUserInitials(user))}</span>`
    : '<svg class="nav-account-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="3.5"></circle><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"></path></svg>'
  if(link.id === 'authNavLink'){
    link.innerHTML = `${avatar}<span class="nav-auth-label">${label}</span>`
  } else {
    link.textContent = label
  }

  if(!role || !targetPage){
    link.href = 'auth.html'
    link.setAttribute('aria-label', 'Sign in to CampusAura')
    link.classList.remove('dashboard-nav-link')
    return
  }

  link.href = targetPage
  link.setAttribute('aria-label', `${getDashboardName(role)} page`)
  link.classList.add('dashboard-nav-link')
}

async function refreshAuthNavigation(){
  const link = document.getElementById('authNavLink')
  const footerLink = document.querySelector('.footer-links a[href="auth.html"]')
  if(!link && !footerLink) return

  const applyState = (targetLink, role, page, user) => {
    if(targetLink) setAuthNavState(targetLink, role, page, user)
  }

  if(!window.campusAuraSupabase?.auth){
    applyState(link)
    applyState(footerLink)
    return
  }

  const { data: { session } } = await window.campusAuraSupabase.auth.getSession()
  if(!session?.user){
    applyState(link)
    applyState(footerLink)
    return
  }

  const { data: profile, error } = await window.campusAuraSupabase
    .from('profiles')
    .select('role')
    .eq('id', session.user.id)
    .maybeSingle()

  if(error || !profile){
    applyState(link)
    applyState(footerLink)
    return
  }

  const targetPage = profile.role === 'admin' ? 'admin.html' : profile.role === 'provider' ? 'provider.html' : 'student.html'
  applyState(link, profile.role, targetPage, session.user)
  applyState(footerLink, profile.role, targetPage, session.user)
}

function setupAuthNavigation(){
  const actions = document.querySelector('.nav-actions')
  if(!actions) return

  let link = document.getElementById('authNavLink')
  if(!link){
    link = document.createElement('a')
    link.id = 'authNavLink'
    link.className = 'btn btn-ghost nav-auth-link'
    link.href = 'auth.html'
    link.textContent = 'Sign in'
    actions.insertBefore(link, actions.querySelector('.nav-toggle'))
  }

  setAuthNavState(link)

  if(window.campusAuraSupabase?.auth){
    refreshAuthNavigation()
    window.campusAuraSupabase.auth.onAuthStateChange((_event, session) => {
      const footerLink = document.querySelector('.footer-links a[href="auth.html"]')
      if(!session?.user){
        setAuthNavState(link)
        if(footerLink) setAuthNavState(footerLink)
        return
      }

      window.campusAuraSupabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .maybeSingle()
        .then(({ data: profile, error }) => {
          if(error || !profile){
            setAuthNavState(link)
            if(footerLink) setAuthNavState(footerLink)
            return
          }
          const targetPage = profile.role === 'admin' ? 'admin.html' : profile.role === 'provider' ? 'provider.html' : 'student.html'
          setAuthNavState(link, profile.role, targetPage, session.user)
          if(footerLink) setAuthNavState(footerLink, profile.role, targetPage, session.user)
        })
        .catch(() => {
          setAuthNavState(link)
          if(footerLink) setAuthNavState(footerLink)
        })
    })
  }
}

function setupThemeToggle(){
  let toggle = document.getElementById('themeToggle')
  if(!toggle){
    toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.id = 'themeToggle'
    toggle.className = 'theme-toggle btn btn-ghost'
    toggle.setAttribute('aria-label', 'Switch to dark mode')
    toggle.setAttribute('aria-pressed', 'false')
    toggle.innerHTML = '<span class="theme-toggle-icon" aria-hidden="true">🌙</span><span class="theme-toggle-label">Dark</span>'
    document.body.appendChild(toggle)
  }

  const applyTheme = (theme) => {
    const nextTheme = theme === 'dark' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', nextTheme)
    document.body?.setAttribute('data-theme', nextTheme)

    const metaTheme = document.querySelector('meta[name="theme-color"]')
    if(metaTheme){
      metaTheme.setAttribute('content', nextTheme === 'dark' ? '#0f172a' : '#2563eb')
    }

    const icon = toggle.querySelector('.theme-toggle-icon')
    const label = toggle.querySelector('.theme-toggle-label')
    if(icon) icon.textContent = nextTheme === 'dark' ? '☀️' : '🌙'
    if(label) label.textContent = nextTheme === 'dark' ? 'Light' : 'Dark'
    toggle.setAttribute('aria-pressed', String(nextTheme === 'dark'))
    toggle.setAttribute('aria-label', nextTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode')
    localStorage.setItem('campusaura-theme', nextTheme)
  }

  const storedTheme = localStorage.getItem('campusaura-theme')
  const preferredTheme = storedTheme === 'dark' || storedTheme === 'light'
    ? storedTheme
    : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

  applyTheme(preferredTheme)
  toggle.addEventListener('click', () => {
    const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
    applyTheme(nextTheme)
  })

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  if(mediaQuery.addEventListener){
    mediaQuery.addEventListener('change', (event) => {
      if(!localStorage.getItem('campusaura-theme')) {
        applyTheme(event.matches ? 'dark' : 'light')
      }
    })
  }
}

// Mobile menu toggle (unified across site)
function setupNavToggle(){
  const toggleBtns = $$('.nav-toggle')

  // Ensure initial a11y state
  toggleBtns.forEach(btn=>{
    const row = btn.closest('.nav-row')
    const nav = row?.querySelector('.nav')
    if(!nav) return
    btn.setAttribute('aria-expanded', 'false')
    nav.setAttribute('aria-hidden', 'true')
  })

  // Toggle the backdrop open/closed
  const setBackdrop = (open)=>{
    const backdrop = document.getElementById('navBackdrop')
    if(backdrop){
      backdrop.classList.toggle('show', !!open)
      backdrop.setAttribute('aria-hidden', String(!open))
    }
  }
  const hideBackdrop = ()=> setBackdrop(false)

  // Close a single nav (mobile menu) + sync attributes
  const closeNav = (nav)=>{
    if(!nav) return
    nav.classList.remove('open')
    nav.setAttribute('aria-hidden', 'true')
    const row = nav.closest('.nav-row')
    const toggle = row?.querySelector('.nav-toggle')
    if(toggle) toggle.setAttribute('aria-expanded', 'false')
    // Close any open hub dropdown inside
    const btn = nav.querySelector('[data-hub-toggle]')
    closeHub(btn)
  }

  // Close hub dropdown(s)
  const closeHub = (btn)=>{
    if(!btn) return
    const menu = btn.getAttribute('aria-controls')
    const dropdown = menu ? document.getElementById(menu) : null
    btn.setAttribute('aria-expanded', 'false')
    if(dropdown) dropdown.setAttribute('aria-hidden', 'true')
  }

  toggleBtns.forEach(btn=>{
    btn.addEventListener('click',()=>{
      const row = btn.closest('.nav-row')
      const nav = row.querySelector('.nav')

      // Close other open navs first
      document.querySelectorAll('.nav.open').forEach(otherNav=>{
        if(otherNav !== nav) closeNav(otherNav)
      })

      const isOpen = nav.classList.toggle('open')
      btn.setAttribute('aria-expanded', String(isOpen))
      nav.setAttribute('aria-hidden', String(!isOpen))
      setBackdrop(isOpen)

      if(isOpen){
        // Move focus to the first nav link for accessibility
        const firstLink = nav.querySelector('.nav-link a, .nav-link[href], a[href]')
        firstLink && firstLink.focus()
      } else {
        hideBackdrop()
      }
    })
  })

  // Close on link click + close backdrop
  const closeMobileMenu = ()=>{
    document.querySelectorAll('.nav.open').forEach(nav=>closeNav(nav))
    hideBackdrop()
  }

  document.addEventListener('click', (e)=>{
    // If a backdrop is clicked, close the menu
    if(e.target.closest('#navBackdrop')){
      closeMobileMenu()
      return
    }
    // Clicking a real nav link closes the mobile menu
    const link = e.target.closest('.nav.open a[href]')
    if(link){
      closeMobileMenu()
    }
  })

  // Escape closes both the hub dropdown and the mobile menu
  document.addEventListener('keydown', (e)=>{
    if(e.key !== 'Escape') return
    document.querySelectorAll('[data-hub-toggle][aria-expanded="true"]').forEach(closeHub)
    closeMobileMenu()
  })
}



// Render functions
function renderAccommodations(target, items){
  const container = document.getElementById(target)
  if(!container) return
  const emptyState = target === 'accommodationGrid' ? document.getElementById('emptyState') : null
  if(emptyState) emptyState.style.display = items.length ? 'none' : 'block'
  container.innerHTML = ''
  items.forEach(a=>{
    container.appendChild(createHomeListingCard(a, 'accommodation', {
      action: 'View stay',
      includeSave: true,
      imageLoading: target === 'accomList' ? 'eager' : 'lazy'
    }))
  })
}

// Render utilities that support pagination or list view
function renderList(containerId, items){
  const container = document.getElementById(containerId)
  if(!container) return
  container.innerHTML = ''
  items.forEach(i=>{
    const card = document.createElement('div')
    card.className = 'card fade-in'
    if(i.img || i.images){
      const src = safeImageUrl(i.img || i.images, 'images/room.jpeg')
      card.innerHTML = `
        <div style="display:flex;gap:16px;align-items:center">
          <img src="${escapeHtml(src)}" alt="${escapeHtml(i.title||i.name)}" style="width:120px;height:80px;object-fit:cover;border-radius:8px">
          <div style="flex:1">
            <h3>${escapeHtml(i.title||i.name)}</h3>
            <p class=\"small\">${escapeHtml(i.category? i.category + ' • ' + (i.seller||'') : (i.location||''))}</p>
            <p class=\"small\">${escapeHtml(i.desc || '')}</p>
          </div>
<div style=\"min-width:120px;text-align:right\">${i.price? '<div class=\"price\">K'+escapeHtml(i.price)+'</div>':''}<button class=\"btn btn-ghost\">View</button></div>
        </div>
      `
    } else {
      card.innerHTML = `<h3>${escapeHtml(i.title||i.name)}</h3><p class="small">${escapeHtml(i.desc||'')}</p>`
    }
    container.appendChild(card)
  })
}

function renderMarketplace(){
  const container = document.getElementById('marketList')
  const grid = document.getElementById('marketplaceGrid')
  if(container){
    container.innerHTML = ''
    if(!data.marketplace.length) renderEmptyCollection(container, 'Marketplace is ready for its first listing', 'Products added by students will appear here.', 'auth.html', 'Sign in to list an item')
    data.marketplace.slice(0,4).forEach(p=>{
      container.appendChild(createHomeListingCard(p, 'marketplace', { action: 'View find' }))
    })
  }
  if(grid){
    grid.innerHTML=''
    if(!data.marketplace.length) renderEmptyCollection(grid, 'No marketplace items yet', 'Check back soon or sign in to add the first item.', 'auth.html', 'Sign in')
    data.marketplace.forEach(p=>{
      grid.appendChild(createHomeListingCard(p, 'marketplace', { action: 'View find' }))
    })
  }
}

function renderTrending(){
  const grid = document.getElementById('trendingGrid')
  if(!grid) return
  // simple trending: highest priced first
  const items = data.marketplace.slice().sort((a,b)=>b.price-a.price).slice(0,4)
  grid.innerHTML = ''
items.forEach(p=>{
    const card = document.createElement('div')
    card.className = 'card fade-in'
    card.innerHTML = `
      <div class="img-wrap">
        <img src="${escapeHtml(safeImageUrl(p.img, 'images/market.jpeg'))}" alt="${escapeHtml(p.title)}" loading="lazy">
        <div class="card-badge">K${escapeHtml(p.price)}</div>
      </div>
      <h3>${escapeHtml(p.title)}</h3>
      <p class="small">${escapeHtml(p.category)} • ${escapeHtml(p.seller)}</p>
      <div class="meta"><div class="price">K${escapeHtml(p.price)}</div><button class="btn btn-ghost">View</button></div>
    `
    grid.appendChild(card)
  })
}

function renderEvents(){
  const list = document.getElementById('eventList')
  const grid = document.getElementById('eventsGrid')
  const upcomingEvents = getUpcomingEvents()
  if(list){
    list.innerHTML=''
    if(!upcomingEvents.length) renderEmptyCollection(list, 'No upcoming events yet', 'Check back soon for new events from your campus community.', 'events.html', 'Explore events')
    upcomingEvents.forEach(e=>{
      list.appendChild(createHomeEventCard(e))
    })
  }
  if(grid){
    grid.innerHTML=''
    if(!upcomingEvents.length) renderEmptyCollection(grid, 'No upcoming events yet', 'Check back soon for new events from your campus community.', 'events.html', 'Explore events')
    upcomingEvents.forEach(e=>{
      grid.appendChild(createHomeEventCard(e))
    })
  }
}

function createHomeListingCard(item, type, { action, includeSave = false, imageLoading = 'lazy' } = {}){
  const isAccommodation = type === 'accommodation'
  const category = isAccommodation ? 'Accommodation' : item.category || 'Marketplace'
  const subtitle = item.subtitle || (isAccommodation
    ? item.location || 'Student accommodation'
    : item.seller || 'Student marketplace')
  const image = isAccommodation ? item.images : item.img
  const fallbackImage = isAccommodation ? 'images/room.jpeg' : 'images/market.jpeg'
  const card = document.createElement('article')
  card.className = 'card fade-in listing-card home-update-card'
  card.dataset.modalType = type
  card.dataset.itemId = item.id
  card.tabIndex = 0
  card.innerHTML = `
    <div class="home-update-image">
      <img src="${escapeHtml(safeImageUrl(image, fallbackImage))}" alt="${escapeHtml(item.title)}" loading="${imageLoading}">
      <span class="home-update-type">${escapeHtml(category)}</span>
    </div>
    <div class="home-update-content">
      <p class="home-update-date">${escapeHtml(item.publishedAt ? formatAddedDate(item.publishedAt) : 'On CampusAura')}</p>
      <h3>${escapeHtml(item.title)}</h3>
      <p class="home-update-subtitle">${escapeHtml(subtitle)}</p>
      <div class="home-update-footer">
        <strong>${item.price ? `K${escapeHtml(item.price)}${isAccommodation ? '<span>/mo</span>' : ''}` : ''}</strong>
        <div class="home-update-actions">
          <button class="home-update-action" type="button" data-listing-open>${escapeHtml(action || 'View details')} <span aria-hidden="true">→</span></button>
          ${includeSave ? `<button class="home-update-save save-listing" type="button" data-accommodation-id="${escapeHtml(item.id)}" aria-label="Save ${escapeHtml(item.title)}">Save</button>` : ''}
        </div>
      </div>
    </div>
  `
  return card
}

function createHomeEventCard(event){
  const eventDate = getLocalCalendarDate(event.eventDate)
  const card = document.createElement('article')
  card.className = 'home-upcoming-card fade-in listing-card'
  card.dataset.modalType = 'event'
  card.dataset.itemId = event.id
  card.tabIndex = 0
  card.innerHTML = `
    <div class="home-event-image">
      <img src="${escapeHtml(safeImageUrl(event.img, 'images/event1.jpeg'))}" alt="${escapeHtml(event.title)}" loading="lazy">
      <div class="home-event-date" aria-label="${escapeHtml(formatEventDate(event.eventDate))}">
        <span>${eventDate ? escapeHtml(eventDate.toLocaleDateString(undefined, { month: 'short' })) : ''}</span>
        <strong>${eventDate ? eventDate.getDate() : ''}</strong>
      </div>
    </div>
    <div class="home-upcoming-content">
      <p class="home-update-date">${escapeHtml(event.type || 'Campus event')}</p>
      <h3>${escapeHtml(event.title)}</h3>
      <p class="home-upcoming-location">${escapeHtml(event.location || 'Campus location to be announced')}</p>
      <p class="home-upcoming-description">${escapeHtml(event.description || '')}</p>
    </div>
    <button class="rsvp btn btn-primary" type="button" data-event-id="${escapeHtml(event.id)}" aria-pressed="false">RSVP <span aria-hidden="true">→</span></button>
  `
  return card
}

function renderHomeFreshContent(){
  const container = document.getElementById('freshContentList')
  if(!container) return

  const items = [
    ...data.accommodations.map(item => ({
      ...item,
      type: 'accommodation',
      publishedAt: item.publishedAt || null,
      image: item.images,
      subtitle: item.location || 'Student accommodation',
      action: 'View stay'
    })),
    ...data.marketplace.map(item => ({
      ...item,
      type: 'marketplace',
      publishedAt: item.publishedAt || null,
      image: item.img,
      subtitle: item.category || 'Marketplace',
      action: 'View find'
    }))
  ].sort((first, second) => (Date.parse(second.createdAt) || 0) - (Date.parse(first.createdAt) || 0))
    .slice(0, 6)

  const firstItemId = items[0] ? `${items[0].type}:${items[0].id}` : null
  if(firstItemId !== homeCarouselState.firstItemId){
    homeCarouselState.page = 0
    homeCarouselState.firstItemId = firstItemId
  }
  container.innerHTML = ''
  if(!items.length){
    renderEmptyCollection(container, 'Be the first to share something', 'New homes and marketplace finds will show up here as soon as they are published.', 'register.html', 'Join the community')
    if(document.getElementById('freshCarousel')) setupHomeCarousel()
    return
  }

  items.forEach(item => {
    const card = createHomeListingCard(item, item.type, {
      action: item.action,
      imageLoading: 'lazy'
    })
    const image = card.querySelector('img')
    image.addEventListener('error', () => {
      image.src = 'images/hero-illustration.svg'
    }, { once: true })
    container.appendChild(card)
  })
  if(document.getElementById('freshCarousel')) setupHomeCarousel()
}

function renderHomeUpcomingEvents(){
  const container = document.getElementById('upcomingEventsList')
  if(!container) return
  const events = getUpcomingEvents().slice(0, 3)
  container.innerHTML = ''
  if(!events.length){
    renderEmptyCollection(container, 'Nothing on the calendar just yet', 'Check back soon to see what your campus community is planning.', 'events.html', 'Explore events')
    return
  }

  events.forEach(event => {
    container.appendChild(createHomeEventCard(event))
  })
}

function setupListingModals(){
  let modal = document.getElementById('listingModal')
  if(!modal){
    modal = document.createElement('div')
    modal.className = 'listing-modal'
    modal.id = 'listingModal'
    modal.setAttribute('aria-hidden', 'true')
    modal.innerHTML = `
      <div class="listing-modal-backdrop" data-modal-close></div>
      <section class="listing-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="listingModalTitle">
        <button class="listing-modal-close" type="button" aria-label="Close details" data-modal-close>&times;</button>
        <div class="listing-modal-media" id="listingModalMedia"></div>
        <div class="listing-modal-content">
          <p class="listing-modal-kicker" id="listingModalKicker"></p>
          <h2 id="listingModalTitle"></h2>
          <div class="listing-modal-meta" id="listingModalMeta"></div>
          <p class="listing-modal-description" id="listingModalDescription"></p>
          <div class="listing-modal-contact" id="listingModalContact"></div>
        </div>
      </section>
    `
    document.body.appendChild(modal)
  }

  let previouslyFocusedElement = null
  let activeGalleryImages = []
  const closeModal = ()=>{
    if(!modal.classList.contains('is-open')) return
    modal.classList.remove('is-open')
    modal.setAttribute('aria-hidden', 'true')
    document.body.classList.remove('modal-open')
    previouslyFocusedElement?.focus()
    previouslyFocusedElement = null
  }

  const hasActiveStudentSession = async ()=>{
    if(!window.campusAuraSupabase || !window.campusAuraSupabase.auth) return false
    const { data: { session } } = await window.campusAuraSupabase.auth.getSession()
    return Boolean(session)
  }

  const openModal = async (type, id)=>{
    const collection = type === 'accommodation' ? data.accommodations : type === 'marketplace' ? data.marketplace : data.events
    const item = collection.find(entry => String(entry.id) === String(id))
    if(!item) return
    previouslyFocusedElement = document.activeElement
    if(type !== 'event' && window.campusAuraSupabase){
      window.campusAuraSupabase.rpc('record_listing_analytics_event', {
        p_event_name: 'listing_view',
        p_entity_type: type,
        p_entity_id: item.id
      }).then(({ error }) => {
        if(error) console.warn('Could not record listing view:', error)
      }).catch(error => console.warn('Could not record listing view:', error))
    }

    const media = document.getElementById('listingModalMedia')
    const kicker = document.getElementById('listingModalKicker')
    const title = document.getElementById('listingModalTitle')
    const meta = document.getElementById('listingModalMeta')
    const description = document.getElementById('listingModalDescription')
    const contact = document.getElementById('listingModalContact')
    const image = type === 'accommodation' ? item.images : item.img
    const lockedForGuest = type !== 'event' && !(await hasActiveStudentSession())

    const fallbackImage = type === 'accommodation' ? 'images/room.jpeg' : type === 'marketplace' ? 'images/market.jpeg' : 'images/event1.jpeg'
    activeGalleryImages = Array.isArray(item.imageUrls) && item.imageUrls.length ? item.imageUrls : [image || fallbackImage]
    media.innerHTML = `
      <div class="listing-modal-gallery-stage">
        <img class="listing-modal-main-image" src="${escapeHtml(safeImageUrl(activeGalleryImages[0], fallbackImage))}" alt="${escapeHtml(item.title)}">
      </div>
      ${activeGalleryImages.length > 1 ? `<div class="listing-modal-gallery-thumbs" aria-label="More listing photos">${activeGalleryImages.map((url, index) => `
        <button class="listing-modal-gallery-thumb${index === 0 ? ' is-active' : ''}" type="button" data-gallery-index="${index}" aria-label="Show photo ${index + 1}" aria-current="${index === 0 ? 'true' : 'false'}">
          <img src="${escapeHtml(safeImageUrl(url, fallbackImage))}" alt="">
        </button>`).join('')}</div>` : ''}
    `
    title.textContent = item.title
    description.textContent = item.desc || item.description || 'No description provided yet.'

    if(type === 'accommodation'){
      kicker.textContent = 'Accommodation'
      meta.innerHTML = `<span>${escapeHtml(item.location)}</span><strong>K${escapeHtml(item.price)} / month</strong>`
      const phone = String(item.providerPhone || '').replace(/[^\d+]/g, '')
      contact.innerHTML = lockedForGuest
        ? `<span>Provider: <strong>${escapeHtml(item.providerName || 'CampusAura provider')}</strong></span><span>Sign in to unlock contact details.</span><a class="btn btn-primary" href="auth.html">Sign in</a>`
        : `<span>Provider: <strong>${escapeHtml(item.providerName || 'CampusAura provider')}</strong></span><span>Phone: <strong>${escapeHtml(item.providerPhone || 'Phone not provided')}</strong></span>${phone ? `<a class="btn btn-primary" href="tel:${phone}" data-listing-contact data-entity-type="accommodation" data-entity-id="${escapeHtml(item.id)}">Call provider</a>` : ''}`
    } else if(type === 'marketplace'){
      kicker.textContent = escapeHtml(item.category || 'Marketplace item')
      meta.innerHTML = `<span>${escapeHtml(item.category || 'Student listing')}</span><strong>K${escapeHtml(item.price)}</strong>`
      const phone = String(item.sellerPhone || '').replace(/[^\d+]/g, '')
      contact.innerHTML = lockedForGuest
        ? `<span>Seller: <strong>${escapeHtml(item.seller || 'CampusAura seller')}</strong></span><span>Sign in to unlock contact details.</span><a class="btn btn-primary" href="auth.html">Sign in</a>`
        : `<span>Seller: <strong>${escapeHtml(item.seller || 'CampusAura seller')}</strong></span><span>Phone: <strong>${escapeHtml(item.sellerPhone || 'Phone not provided')}</strong></span>${phone ? `<a class="btn btn-primary" href="tel:${phone}" data-listing-contact data-entity-type="marketplace" data-entity-id="${escapeHtml(item.id)}">Call seller</a>` : ''}`
    } else {
      kicker.textContent = escapeHtml(item.type || 'Campus event')
      meta.innerHTML = `<span>${escapeHtml(item.date)}</span><span>${escapeHtml(item.location)}</span>`
      contact.innerHTML = `<span>Open to the CampusAura community</span>`
    }

    if(lockedForGuest && type !== 'event'){
      description.textContent = `${description.textContent} Sign in to view full provider or seller contact details.`
    }

    modal.classList.add('is-open')
    modal.setAttribute('aria-hidden', 'false')
    document.body.classList.add('modal-open')
    modal.querySelector('.listing-modal-close')?.focus()
  }

  modal.addEventListener('click', async event=>{
    if(event.target.closest('[data-modal-close]')) closeModal()
    const galleryButton = event.target.closest('[data-gallery-index]')
    if(galleryButton){
      const index = Number(galleryButton.dataset.galleryIndex)
      const fallback = 'images/hero-illustration.svg'
      const image = activeGalleryImages[index]
      const mainImage = modal.querySelector('.listing-modal-main-image')
      if(image && mainImage){
        mainImage.src = safeImageUrl(image, fallback)
        modal.querySelectorAll('[data-gallery-index]').forEach(button=>{
          const active = button === galleryButton
          button.classList.toggle('is-active', active)
          button.setAttribute('aria-current', String(active))
        })
      }
      return
    }
    const contactLink = event.target.closest('[data-listing-contact]')
    if(!contactLink || !window.campusAuraSupabase) return
    event.preventDefault()
    const contactUrl = contactLink.href
    try {
      const { error } = await window.campusAuraSupabase.rpc('record_listing_analytics_event', {
        p_event_name: 'listing_inquiry',
        p_entity_type: contactLink.dataset.entityType,
        p_entity_id: contactLink.dataset.entityId
      })
      if(error) console.warn('Could not record listing contact click:', error)
    } catch(error) {
      console.warn('Could not record listing contact click:', error)
    }
    window.location.href = contactUrl
  })

  document.addEventListener('click', async event=>{
    const card = event.target.closest('.listing-card[data-modal-type]')
    if(!card) return
    if(event.target.closest('button, a, input, select, textarea')){
      if(event.target.closest('[data-listing-open]')){
        event.preventDefault()
        await openModal(card.dataset.modalType, card.dataset.itemId)
      }
      return
    }
    await openModal(card.dataset.modalType, card.dataset.itemId)
  })

  document.addEventListener('keydown', async event=>{
    if(event.key === 'Escape') closeModal()
    if((event.key === 'Enter' || event.key === ' ') && event.target.closest('.listing-card[data-modal-type]')){
      event.preventDefault()
      const card = event.target.closest('.listing-card[data-modal-type]')
      await openModal(card.dataset.modalType, card.dataset.itemId)
    }
  })
}

function isEventInRange(eventDate, range){
  if(!eventDate || !range) return true
  const date = new Date(eventDate)
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const day = startOfDay.getDay()
  const startOfWeek = new Date(startOfDay)
  startOfWeek.setDate(startOfDay.getDate() - (day === 0 ? 6 : day - 1))
  const endOfWeek = new Date(startOfWeek)
  endOfWeek.setDate(startOfWeek.getDate() + 7)
  if(range === 'this-week') return date >= startOfWeek && date < endOfWeek
  if(range === 'next-week'){
    const nextWeek = new Date(endOfWeek)
    const afterNextWeek = new Date(nextWeek)
    afterNextWeek.setDate(nextWeek.getDate() + 7)
    return date >= nextWeek && date < afterNextWeek
  }
  if(range === 'this-month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
  return true
}

function populateEventLocations(){
  const select = document.getElementById('newEventLocation') || document.getElementById('eventLocation')
  if(!select) return
  const locations = [...new Set(data.events.map(event=>event.location).filter(Boolean))].sort()
  select.innerHTML = '<option value="">All locations</option>' +
    locations.map(location=>`<option value="${escapeHtml(location)}">${escapeHtml(location)}</option>`).join('')
}

function populateCounts(){
  const totalListings = document.getElementById('totalListings')
  const totalMarket = document.getElementById('totalMarket')
  const totalEvents = document.getElementById('totalEvents')
  if(totalListings) totalListings.textContent = data.accommodations.length
  if(totalMarket) totalMarket.textContent = data.marketplace.length
  if(totalEvents) totalEvents.textContent = getUpcomingEvents().length
  const newTotalEvents = document.getElementById('newTotalEvents')
  const newAttendingCount = document.getElementById('newAttendingCount')
  if(newTotalEvents) newTotalEvents.textContent = getUpcomingEvents().length
  if(newAttendingCount) newAttendingCount.textContent = document.getElementById('attendingCount')?.textContent || '0'
}

async function loadSupabaseData(){
  if(!window.campusAuraSupabase) return

  const loadPublishedListings = async (table, selection) => {
    const result = await window.campusAuraSupabase
      .from(table)
      .select(`${selection}, published_at`)
      .eq('status', 'published')
      .order('published_at', { ascending: false, nullsFirst: false })

    if(result.error?.code !== '42703') return result
    if(!publishedAtMigrationWarningShown){
      console.warn('Run supabase/home-feed-publishing.sql to order newly approved listings by their publication time.')
      publishedAtMigrationWarningShown = true
    }
    return window.campusAuraSupabase
      .from(table)
      .select(selection)
      .eq('status', 'published')
      .order('created_at', { ascending: false })
  }

  const [accommodationsResult, marketplaceResult, eventsResult] = await Promise.all([
    loadPublishedListings('accommodations', 'id, title, location, price, description, image_url, image_urls, owner_id, created_at'),
    loadPublishedListings('marketplace_items', 'id, title, price, category, description, image_url, image_urls, seller_id, seller_display_name, created_at'),
    window.campusAuraSupabase
      .from('events')
      .select('id, title, event_date, location, description, image_url, image_urls, event_type, created_at')
      .eq('status', 'published')
      .order('event_date', { ascending: true })
  ])

  if(accommodationsResult.error) console.warn('Could not load accommodations:', accommodationsResult.error)
  if(marketplaceResult.error) console.warn('Could not load marketplace items:', marketplaceResult.error)
  if(eventsResult.error) console.warn('Could not load events:', eventsResult.error)

  const profileIds = [
    ...(accommodationsResult.data || []).map(item => item.owner_id),
    ...(marketplaceResult.data || []).map(item => item.seller_id)
  ].filter(Boolean)
  const { data: { user } } = await window.campusAuraSupabase.auth.getUser()
  const profilesResult = profileIds.length && user
    ? await window.campusAuraSupabase.rpc('get_listing_contacts', { p_profile_ids: [...new Set(profileIds)] })
    : { data: [], error: null }
  if(profilesResult.error) console.warn('Could not load listing contacts:', profilesResult.error)
  const profilesById = new Map((profilesResult.data || []).map(profile => [profile.id, profile]))

  if(!accommodationsResult.error){
    data.accommodations = accommodationsResult.data.map(item=>({
      id: item.id,
      title: item.title,
      location: item.location,
      price: item.price,
      images: getListingImageUrls(item, 'images/room.jpeg')[0],
      imageUrls: getListingImageUrls(item, 'images/room.jpeg'),
      desc: item.description || '',
      publishedAt: item.published_at || null,
      createdAt: item.published_at || item.created_at,
      providerName: profilesById.get(item.owner_id)?.full_name || 'CampusAura provider',
      providerPhone: profilesById.get(item.owner_id)?.phone || 'Phone not provided'
    }))
  }

  if(!marketplaceResult.error){
    data.marketplace = marketplaceResult.data.map(item=>({
      id: item.id,
      title: item.title,
      price: item.price,
      seller: item.seller_display_name?.trim() || profilesById.get(item.seller_id)?.full_name || 'CampusAura seller',
      category: item.category,
      img: getListingImageUrls(item, 'images/market.jpeg')[0],
      imageUrls: getListingImageUrls(item, 'images/market.jpeg'),
      desc: item.description || '',
      publishedAt: item.published_at || null,
      createdAt: item.published_at || item.created_at,
      sellerPhone: profilesById.get(item.seller_id)?.phone || 'Phone not provided'
    }))
  }

  if(!eventsResult.error){
    data.events = eventsResult.data.map(item=>({
      id: item.id,
      title: item.title,
      date: formatEventDate(item.event_date),
      eventDate: item.event_date,
      createdAt: item.created_at,
      location: item.location,
      description: item.description || 'Connect with students, learn something new, and make the most of campus life.',
      img: getListingImageUrls(item, 'images/event1.jpeg')[0],
      imageUrls: getListingImageUrls(item, 'images/event1.jpeg'),
      type: item.event_type
    }))
    populateEventLocations()
  }
}

async function refreshHomeFeeds(){
  if(homeCarouselState.refreshInProgress || !document.getElementById('freshContentList')) return
  homeCarouselState.refreshInProgress = true
  try {
    await loadSupabaseData()
    renderHomeFreshContent()
    renderHomeUpcomingEvents()
    populateCounts()
  } catch(error) {
    console.warn('CampusAura could not refresh homepage content:', error)
  } finally {
    homeCarouselState.refreshInProgress = false
  }
}

function setupHomeLiveUpdates(){
  if(!document.getElementById('freshContentList') || !window.campusAuraSupabase) return

  const refreshWhenVisible = () => {
    if(document.visibilityState === 'visible') refreshHomeFeeds()
  }
  window.setInterval(refreshWhenVisible, 30000)
  document.addEventListener('visibilitychange', refreshWhenVisible)

  try {
    homeCarouselState.realtimeChannel = window.campusAuraSupabase
      .channel('home-published-content')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accommodations' }, refreshHomeFeeds)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'marketplace_items' }, refreshHomeFeeds)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, refreshHomeFeeds)
      .subscribe(status => {
        if(status === 'CHANNEL_ERROR' || status === 'TIMED_OUT'){
          console.warn(`CampusAura live content updates are unavailable (${status}); periodic refresh remains enabled.`)
        }
      })
  } catch(error) {
    console.warn('CampusAura could not subscribe to live content updates; periodic refresh remains enabled:', error)
  }
}

// Search and filters
function setupSearchAndFilters(){

  const globalSearch = document.getElementById('globalSearch')
  const searchBtn = document.getElementById('searchBtn')
if(searchBtn && globalSearch){
    searchBtn.addEventListener('click',()=>{
      const q = globalSearch.value.trim().toLowerCase()
      if(!q) return
      // simple search across datasets
      const accom = data.accommodations.filter(a=>a.title.toLowerCase().includes(q) || a.location.toLowerCase().includes(q))
      const market = data.marketplace.filter(m=>m.title.toLowerCase().includes(q) || m.seller.toLowerCase().includes(q) || m.category.toLowerCase().includes(q))
      const events = data.events.filter(e=>e.title.toLowerCase().includes(q) || e.location.toLowerCase().includes(q))
      renderAccommodations('accomList',accom)
      // render marketplace results (home preview)
      const mlist = document.getElementById('marketList')
      if(mlist){
        mlist.innerHTML=''
        market.slice(0,4).forEach(p=>{
          const card = document.createElement('div')
          card.className = 'card fade-in'
          card.innerHTML = `
            <div class="img-wrap">
              <img src="${escapeHtml(safeImageUrl(p.img, 'images/market.jpeg'))}" alt="${escapeHtml(p.title)}" loading="lazy">
              <div class="card-badge">K${escapeHtml(p.price)}</div>
            </div>
            <h3>${escapeHtml(p.title)}</h3>
            <p class="small">${escapeHtml(p.category)} • ${escapeHtml(p.seller)}</p>
            <div class="meta"><div class="price">K${escapeHtml(p.price)}</div><button class="btn btn-ghost">View</button></div>
          `
          mlist.appendChild(card)
        })
      }
      // render filtered events (home preview)
      const elist = document.getElementById('eventList')
      if(elist){
        elist.innerHTML=''
        events.forEach(e=>{
          const card = document.createElement('div')
          card.className='card fade-in'
          card.innerHTML = `
            <img src="${escapeHtml(safeImageUrl(e.img, 'images/event1.jpeg'))}" alt="${escapeHtml(e.title)}">
            <h3>${escapeHtml(e.title)}</h3>
            <p class="small">${escapeHtml(e.date)} • ${escapeHtml(e.location)}</p>
            <div class="meta"><button class="rsvp" data-event-id="${escapeHtml(e.id)}">RSVP</button></div>
          `
          elist.appendChild(card)
        })
      }
      // scroll to results
      document.querySelector('main').scrollIntoView({behavior:'smooth'})
    })
  }

  // accommodation filters
  const accomBtn = document.getElementById('accomFilterBtn')
  if(accomBtn){
    accomBtn.addEventListener('click',()=>{
      const q = (document.getElementById('accomSearch').value||'').toLowerCase()
      const loc = document.getElementById('locationFilter').value
      const price = document.getElementById('priceFilter').value
      let results = data.accommodations
      if(q) results = results.filter(r=>r.title.toLowerCase().includes(q) || r.location.toLowerCase().includes(q) )
      if(loc) results = results.filter(r=>r.location===loc)
      if(price){
        const [min,max] = price.split('-').map(Number)
        results = results.filter(r=>r.price>=min && r.price<=max)
      }
      renderAccommodations('accommodationGrid',results)
    })
  }

// marketplace filters
  const marketBtn = document.getElementById('marketFilterBtn')
  if(marketBtn){
    marketBtn.addEventListener('click',()=>{
      const q = (document.getElementById('marketSearch').value||'').toLowerCase()
      const cat = document.getElementById('categoryFilter').value
      const price = document.getElementById('priceFilter').value
      let results = data.marketplace
      if(q) results = results.filter(p=>p.title.toLowerCase().includes(q) || p.seller.toLowerCase().includes(q))
      if(cat) results = results.filter(p=>p.category===cat)
if(price){
        const [min,max] = price.split('-').map(Number)
        results = results.filter(p=>p.price>=min && p.price<=max)
      }
      renderMarketplaceGrid(results)
    })
  }

  // events filters
  const eventBtn = document.getElementById('newEventFilterBtn') || document.getElementById('eventFilterBtn')
  if(eventBtn){
    eventBtn.addEventListener('click',()=>{
      const q = (document.getElementById('newEventSearch') || document.getElementById('eventSearch')).value.toLowerCase()
      const loc = (document.getElementById('newEventLocation') || document.getElementById('eventLocation')).value
      const range = (document.getElementById('newEventDate') || document.getElementById('eventDate')).value
      let results = data.events
      if(q) results = results.filter(e=>e.title.toLowerCase().includes(q) || e.location.toLowerCase().includes(q))
      if(loc) results = results.filter(e=>e.location===loc)
      if(range) results = results.filter(e=>isEventInRange(e.eventDate, range))
      renderEventsGrid(results)
    })
  }

  // reset filters buttons (may be present on multiple pages)
  const resets = document.querySelectorAll('#resetFilters')
  resets.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const container = btn.closest('.container') || document
      try {
        // Clear all text and email inputs
        container.querySelectorAll('input[type="text"], input[type="email"]').forEach(i=>i.value='')
        // Reset all selects
        container.querySelectorAll('select').forEach(s=>s.selectedIndex = 0)
        // Reset filter chips
        container.querySelectorAll('.filter-chip').forEach(chip=>{
          chip.classList.remove('active')
          if(chip.textContent.includes('All')) chip.classList.add('active')
        })
        
        // Re-render defaults for that container
        if(container.querySelector('#accommodationGrid')){
          renderAccommodations('accommodationGrid', data.accommodations)
          const emptyState = container.querySelector('#emptyState')
          if(emptyState) emptyState.style.display = 'none'
        }
        if(container.querySelector('#marketplaceGrid')){
          renderMarketplaceGrid(data.marketplace)
          const emptyState = container.querySelector('#emptyState')
          if(emptyState) emptyState.style.display = 'none'
        }
if(container.querySelector('#eventsGrid')){
          renderEventsGrid(data.events)
          const emptyState = container.querySelector('#emptyState')
          if(emptyState) emptyState.style.display = 'none'
        }
      } catch(e) {
        console.warn('Error resetting filters:', e)
      }
    })
  })

  const newReset = document.getElementById('newResetFilters')
  const newClear = document.getElementById('newClearFilters')
  const resetEvents = ()=>{
    document.getElementById('newEventSearch').value = ''
    document.getElementById('newEventLocation').value = ''
    document.getElementById('newEventDate').value = ''
    document.querySelectorAll('.events-content .filter-chip').forEach(chip=>chip.classList.toggle('active', chip.textContent.includes('All')))
    renderEventsGrid(data.events)
  }
  if(newReset) newReset.addEventListener('click', resetEvents)
  if(newClear) newClear.addEventListener('click', resetEvents)
}

function renderMarketplaceGrid(items){
  const grid = document.getElementById('marketplaceGrid')
  if(!grid) return
  grid.innerHTML=''
  const empty = document.getElementById('newEmptyState') || document.getElementById('emptyState')
  if(empty){
    empty.style.display = items.length ? 'none' : 'block'
  }
  items.forEach(p=>{
    grid.appendChild(createHomeListingCard(p, 'marketplace', {
      action: 'View find',
      imageLoading: 'eager'
    }))
  })
}

function renderEventsGrid(items){
  const grid = document.getElementById('newEventsGrid') || document.getElementById('eventsGrid')
  if(!grid) return
  items = getUpcomingEvents(items)
  grid.innerHTML=''
  const empty = document.getElementById('newEmptyState') || document.getElementById('emptyState')
  if(empty){
    empty.style.display = items.length ? 'none' : 'block'
  }
  items.forEach(e=>{
    grid.appendChild(createHomeEventCard(e))
  })
}

function renderFeaturedEvents(){
  const banner = document.getElementById('newFeaturedEvents') || document.getElementById('featuredEvents')
  if(!banner) return
  const featured = getUpcomingEvents().slice(0,2)
  banner.innerHTML=''
  featured.forEach(e=>{
    const card = document.createElement('article')
    card.className='card fade-in listing-card'
    card.dataset.modalType = 'event'
    card.dataset.itemId = e.id
    card.tabIndex = 0
    card.innerHTML = `
      <div class="img-wrap">
        <img src="${escapeHtml(safeImageUrl(e.img, 'images/event1.jpeg'))}" alt="${escapeHtml(e.title)}" loading="lazy">
        <div class="card-badge">${escapeHtml(e.date)}</div>
      </div>
      <h3 style="color:white">${escapeHtml(e.title)}</h3>
      <p class="small" style="color:rgba(255,255,255,0.9)">${escapeHtml(e.location)}</p>
      <div class="meta"><button class="rsvp" data-event-id="${escapeHtml(e.id)}">RSVP</button></div>
    `
    banner.appendChild(card)
  })
}

async function updateAttendingCount(){
  const el = document.getElementById('attendingCount')
  if(!el) return
  if(window.campusAuraSupabase){
    const { data: { user } } = await window.campusAuraSupabase.auth.getUser()
    if(user){
      const { count } = await window.campusAuraSupabase
        .from('rsvps')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
      el.textContent = count || 0
      return
    }
  }
  const rsvps = JSON.parse(localStorage.getItem('campusAuraRsvps') || '[]')
  el.textContent = rsvps.length
}

function setupRsvpButtons(){
  document.addEventListener('click', async (e)=>{
    const btn = e.target.closest('.rsvp')
    if(!btn) return
    const eventId = btn.dataset.eventId
    if(window.campusAuraSupabase && eventId){
      const { data: { user } } = await window.campusAuraSupabase.auth.getUser()
      if(!user){ window.location.href = 'auth.html'; return }
      const isGoing = btn.getAttribute('aria-pressed') === 'true'
      const result = isGoing
        ? await window.campusAuraSupabase.from('rsvps').delete().eq('event_id', eventId).eq('user_id', user.id)
        : await window.campusAuraSupabase.from('rsvps').insert({ event_id: eventId, user_id: user.id })
      if(result.error){ console.warn('RSVP update failed:', result.error); return }
      btn.setAttribute('aria-pressed', String(!isGoing))
      btn.textContent = isGoing ? 'RSVP' : '✓ Going'
      await updateAttendingCount()
      return
    }
    const isGoing = btn.getAttribute('aria-pressed') === 'true'
    btn.setAttribute('aria-pressed', String(!isGoing))
    btn.textContent = isGoing ? 'RSVP' : '✓ Going'
    const rsvps = JSON.parse(localStorage.getItem('campusAuraRsvps') || '[]')
    localStorage.setItem('campusAuraRsvps', JSON.stringify(isGoing ? [] : ['going']))
    updateAttendingCount()
  })
}

function setupSavedListingButtons(){
  document.addEventListener('click', async event => {
    const button = event.target.closest('.save-listing')
    if(!button || !window.campusAuraSupabase) return
    const { data: { user } } = await window.campusAuraSupabase.auth.getUser()
    if(!user){ window.location.href = 'auth.html'; return }
    button.disabled = true
    const { error } = await window.campusAuraSupabase
      .from('saved_listings')
      .insert({ user_id: user.id, accommodation_id: button.dataset.accommodationId })
    button.disabled = false
    if(error && error.code !== '23505'){
      console.warn('Save listing failed:', error)
      return
    }
    button.textContent = 'Saved'
    button.setAttribute('aria-pressed', 'true')
  })
}

// Helper: filter marketplace by category (used by category chips)
function filterByCategory(cat, chipEl){
  const sel = document.getElementById('categoryFilter')
  if(sel) sel.value = cat === '' ? '' : cat
  const results = cat ? data.marketplace.filter(p=>p.category===cat) : data.marketplace
  renderMarketplaceGrid(results)
  // Update active chip visual state
  document.querySelectorAll('.category-chip').forEach(chip=>{
    chip.classList.remove('active')
  })
  if(chipEl){
    chipEl.classList.add('active')
  } else {
    // fallback: highlight match by text/category
    document.querySelectorAll('.category-chip').forEach(chip=>{
      if(!cat && chip.textContent.includes('All')) chip.classList.add('active')
    })
  }
}
window.filterByCategory = filterByCategory

// Helper: filter events by type (used by event type chips)
function filterEventType(type, chipEl){
  const results = type && type !== 'all' ? data.events.filter(e=>e.type===type) : data.events
  const grid = document.getElementById('newEventsGrid') || document.getElementById('eventsGrid')
  if(grid){
    renderEventsGrid(results)
  }
  // update the home preview list too if present
  const list = document.getElementById('eventList')
  if(list){
    list.innerHTML=''
    results.forEach(e=>{
      list.appendChild(createHomeEventCard(e))
    })
  }
  // Update filter chip active state
  document.querySelectorAll('.filter-chip').forEach(chip=>{
    chip.classList.remove('active')
  })
  if(chipEl){
    chipEl.classList.add('active')
  } else {
    document.querySelectorAll('.filter-chip').forEach(chip=>{
      const chipType = chip.textContent.trim().toLowerCase()
      const target = type === 'all' ? 'all' : type
      if((target === 'all' && chipType.includes('all')) || chipType.includes(target)) chip.classList.add('active')
    })
  }
}
window.filterEventType = filterEventType

// Highlight active navbar link based on current page
function highlightActiveNav(){
  const path = window.location.pathname
  const file = path.split('/').pop() || 'index.html'
  const current = file === '' ? 'index.html' : file

  // Prefer the explicit data-page (more reliable than path parsing)
  const bodyPage = document.body.getAttribute('data-page')
  const activePage = bodyPage || current

  // Hub pages contribute to the "Student Hub" trigger being highlighted
  const hubPages = ['accommodation.html','marketplace.html','events.html','student.html','student']
  const isHubPage = hubPages.includes(activePage)

  document.querySelectorAll('.nav a[href], .nav .nav-link[href]').forEach(a=>{
    const href = a.getAttribute('href') || ''
    const normalized = href === '' ? '' : href.split('/').pop()
    const isActive = normalized === current || (current === 'index.html' && normalized === 'index.html')

    a.classList.toggle('active-nav-link', !!isActive)
  })

  // Highlight the Student Hub trigger when on any hub page
  document.querySelectorAll('[data-hub-toggle]').forEach(btn=>{
    btn.classList.toggle('active-nav-link', isHubPage)
  })

  // Highlight the matching hub item inside the dropdown
  document.querySelectorAll('.hub-item').forEach(item=>{
    const href = item.getAttribute('href') || ''
    const normalized = href.split('/').pop()
    item.classList.toggle('active-hub', normalized === activePage)
  })
}


window.highlightActiveNav = highlightActiveNav

// simple view details
function viewDetails(id){
  alert('Viewing details for listing #' + id)
}

// Smooth scroll for internal links
function setupSmoothScroll(){
  document.querySelectorAll('a[href^="#"]').forEach(a=>{
    a.addEventListener('click',e=>{
      e.preventDefault()
      const t = document.querySelector(a.getAttribute('href'))
      if(t) t.scrollIntoView({behavior:'smooth'})
    })
  })
}

function setupViewToggles(){
  document.querySelectorAll('.results-controls').forEach(ctrl=>{
    const container = ctrl.closest('.container')
    if(!container) return

    // prefer the main results grid inside this container
    const grid = container.querySelector('.grid')
    if(!grid) return

    ctrl.querySelectorAll('.view-btn').forEach(b=>{
      b.addEventListener('click',()=>{
        ctrl.querySelectorAll('.view-btn').forEach(x=>x.classList.remove('active'))
        b.classList.add('active')

        const view = b.getAttribute('data-view')
        if(view === 'list'){
          grid.classList.add('view-list')
        } else {
          grid.classList.remove('view-list')
        }
      })
    })
  })
}


function setupSortOptions(){
  document.querySelectorAll('.results-controls').forEach(ctrl=>{
    const select = ctrl.querySelector('select')
    const grid = ctrl.closest('.container')?.querySelector('.grid')
    if(!select || !grid) return
    
    select.addEventListener('change', ()=>{
      const val = select.value
      try {
        // determine which grid we're sorting
        if(grid.id === 'accommodationGrid'){
          let items = data.accommodations.slice()
          if(val==='price-low') items.sort((a,b)=>a.price-b.price)
          if(val==='price-high') items.sort((a,b)=>b.price-a.price)
          if(val==='newest') items = items.reverse()
          renderAccommodations(grid.id, items)
        } else if(grid.id === 'marketplaceGrid'){
          let items = data.marketplace.slice()
          if(val==='price-low') items.sort((a,b)=>a.price-b.price)
          if(val==='price-high') items.sort((a,b)=>b.price-a.price)
          renderMarketplaceGrid(items)
} else if(grid.id === 'eventsGrid'){
          let items = data.events.slice()
          if(val==='date') items.sort((a,b)=>{
            // sort by month/day lexicographically (date strings like "Jun 4", "Aug 20")
            const monthOrder = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}
            return (monthOrder[a.date.slice(0,3)] || 0) - (monthOrder[b.date.slice(0,3)] || 0)
          })
          if(val==='popular' || val==='attendees') items = items.slice().reverse()
          if(grid.id === 'newEventsGrid' || grid.id === 'eventsGrid') renderEventsGrid(items)
        }
      } catch(e) {
        console.warn('Error sorting:', e)
      }
    })
  })
}

// Load more handling
let accomPage = 1; const accomPerPage = 3
let marketPage = 1; const marketPerPage = 6
function setupLoadMore(){
  const loadBtn = document.getElementById('loadMoreBtn')
  const accomGrid = document.getElementById('accommodationGrid')
  if(!loadBtn || !accomGrid) return
  // show if more items exist
  if(data.accommodations.length > accomPerPage){
    loadBtn.style.display = 'inline-block'
  }
  loadBtn.addEventListener('click', ()=>{
    accomPage++
    const start = 0
    const end = accomPage * accomPerPage
    renderAccommodations('accommodationGrid', data.accommodations.slice(0,end))
    if(end >= data.accommodations.length) loadBtn.style.display = 'none'
  })
}

// Profile tabs
// Profile tabs removed (profile page removed)

// ===== Student Hub dropdown (unified) =====
// Drives the modern .nav-dropdown on every page, with a lightweight
// fallback for the legacy single-drawer markup if it ever appears.
function setupStudentHubDrawer(){
  const btns = document.querySelectorAll('[data-hub-toggle]')
  // Legacy drawer fallback (single instance, legacy markup)
  const legacyBtn = document.getElementById('featuresDrawerBtn')
  const legacyDrawer = document.getElementById('featuresDrawer')

  btns.forEach(btn=>{
    const menuId = btn.getAttribute('aria-controls')
    const menu = menuId ? document.getElementById(menuId) : null
    if(!menu) return

    // Ensure initial state
    btn.setAttribute('aria-expanded', 'false')
    menu.setAttribute('aria-hidden', 'true')

    const close = ()=>{
      btn.setAttribute('aria-expanded', 'false')
      menu.setAttribute('aria-hidden', 'true')
      menu.classList.remove('open')
      // hide children from assistive tech
      Array.from(menu.querySelectorAll('[role="menuitem"]')).forEach(i=>i.setAttribute('aria-hidden','true'))
    }

    const open = ()=>{
      // Close other open dropdowns first
      document.querySelectorAll('[data-hub-toggle][aria-expanded="true"]').forEach(other=>{
        const otherId = other.getAttribute('aria-controls')
        const otherMenu = otherId ? document.getElementById(otherId) : null
        other.setAttribute('aria-expanded','false')
        if(otherMenu){ otherMenu.classList.remove('open'); otherMenu.setAttribute('aria-hidden','true') }
      })
      btn.setAttribute('aria-expanded', 'true')
      menu.setAttribute('aria-hidden', 'false')
      menu.classList.add('open')
      const items = Array.from(menu.querySelectorAll('[role="menuitem"]'))
      items.forEach(i=>i.removeAttribute('aria-hidden'))
      if(items.length){
        setTimeout(()=>{ try{ items[0].focus() }catch(e){} }, 120)
      }
    }

    menu.querySelectorAll('[role="menuitem"]').forEach(link=>{
      link.addEventListener('click', ()=> close())
    })

    btn.addEventListener('click', (e)=>{
      e.preventDefault()
      e.stopPropagation()
      const isOpen = btn.getAttribute('aria-expanded') === 'true'
      isOpen ? close() : open()
    })
  })

  // Clicking outside any open hub menu closes it
  document.addEventListener('click', (e)=>{
    document.querySelectorAll('[data-hub-toggle][aria-expanded="true"]').forEach(btn=>{
      const menuId = btn.getAttribute('aria-controls')
      const menu = menuId ? document.getElementById(menuId) : null
      if(!menu) return
      const inside = e.target.closest(`[data-hub-toggle], #${menuId}`)
      if(inside) return
      btn.setAttribute('aria-expanded','false')
      menu.classList.remove('open')
      menu.setAttribute('aria-hidden','true')
      Array.from(menu.querySelectorAll('[role="menuitem"]')).forEach(i=>i.setAttribute('aria-hidden','true'))
    })
  }, true)

  // Escape closes dropdowns (handled in setupNavToggle, but safe to keep here too)
  document.addEventListener('keydown', (e)=>{
    if(e.key !== 'Escape') return
    document.querySelectorAll('[data-hub-toggle][aria-expanded="true"]').forEach(btn=>{
      const menuId = btn.getAttribute('aria-controls')
      const menu = menuId ? document.getElementById(menuId) : null
      btn.setAttribute('aria-expanded','false')
      if(menu){ menu.classList.remove('open'); menu.setAttribute('aria-hidden','true') }
    })
  })

  // Legacy single-drawer fallback (kept functional if present)
  if(legacyBtn && legacyDrawer){
    legacyBtn.setAttribute('aria-expanded','false')
    legacyDrawer.setAttribute('aria-hidden','true')
    const legacyClose = ()=>{
      legacyBtn.setAttribute('aria-expanded','false')
      legacyDrawer.setAttribute('aria-hidden','true')
      legacyDrawer.classList.remove('open')
      Array.from(legacyDrawer.querySelectorAll('[role="menuitem"]')).forEach(i=>i.setAttribute('aria-hidden','true'))
      try{ legacyBtn.focus() }catch(e){}
    }
    const legacyOpen = ()=>{
      legacyBtn.setAttribute('aria-expanded','true')
      legacyDrawer.setAttribute('aria-hidden','false')
      legacyDrawer.classList.add('open')
      try{
        const btnRect = legacyBtn.getBoundingClientRect()
        const navRect = legacyBtn.closest('.nav').getBoundingClientRect()
        legacyDrawer.style.left = (btnRect.left - navRect.left)+'px'
        legacyDrawer.style.top = (btnRect.bottom - navRect.top + 8)+'px'
      }catch(e){}
      const items = Array.from(legacyDrawer.querySelectorAll('[role="menuitem"]'))
      items.forEach(i=>i.removeAttribute('aria-hidden'))
      if(items.length) setTimeout(()=>{ try{ items[0].focus() }catch(e){} }, 120)
    }
    legacyDrawer.querySelectorAll('[role="menuitem"]').forEach(link=>{
      link.addEventListener('click', legacyClose)
    })
    legacyBtn.addEventListener('click',(e)=>{
      e.preventDefault(); e.stopPropagation()
      legacyBtn.getAttribute('aria-expanded') === 'true' ? legacyClose() : legacyOpen()
    })
  }
}


// initialize
async function init(){
  // Always initialize Student Hub first
  highlightActiveNav()
  setupNavToggle()
  setupStudentHubDrawer()
  setupAuthNavigation()
  setupThemeToggle()

  try { await loadSupabaseData() } catch (e) { console.warn('Supabase data loading failed', e) }

  // Other page features (don't block nav if something fails)
  try { setupSearchAndFilters() } catch (e) { console.warn('setupSearchAndFilters failed', e) }
  try { setupSmoothScroll() } catch (e) { console.warn('setupSmoothScroll failed', e) }
  try { setupViewToggles() } catch (e) { console.warn('setupViewToggles failed', e) }
  try { setupSortOptions() } catch (e) { console.warn('setupSortOptions failed', e) }
  try { setupLoadMore() } catch (e) { console.warn('setupLoadMore failed', e) }
  try { setupRsvpButtons() } catch (e) { console.warn('setupRsvpButtons failed', e) }
  try { setupSavedListingButtons() } catch (e) { console.warn('setupSavedListingButtons failed', e) }
  try { setupListingModals() } catch (e) { console.warn('setupListingModals failed', e) }

// render home lists
  if(document.getElementById('accomList')) renderAccommodations('accomList', data.accommodations.slice(0,3))
  if(document.getElementById('accommodationGrid')) renderAccommodations('accommodationGrid', data.accommodations)
  if(document.getElementById('marketplaceGrid')) renderMarketplaceGrid(data.marketplace)
  if(document.getElementById('marketList')) renderMarketplace()
  if(document.getElementById('eventList')) renderEvents()
  if(document.getElementById('trendingGrid')) renderTrending()
  if(document.getElementById('newEventsGrid') || document.getElementById('eventsGrid')) renderEventsGrid(data.events)
  if(document.getElementById('newFeaturedEvents') || document.getElementById('featuredEvents')) renderFeaturedEvents()
  renderHomeFreshContent()
  renderHomeUpcomingEvents()
  updateAttendingCount()
  populateCounts()
  setupHomeLiveUpdates()
}

// Newsletter signup handler
async function handleNewsletterSignup(event){
  event.preventDefault()
  const form = event.target
  const email = form.querySelector('input[type="email"]').value
  const button = form.querySelector('button[type="submit"]')
  
  // Validate email
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert('Please enter a valid email address.')
    return
  }
  
  if(window.campusAuraSupabase){
    const { error } = await window.campusAuraSupabase
      .from('newsletter_subscribers')
      .insert({ email })

    if(error && error.code !== '23505'){
      console.warn('Newsletter signup failed:', error)
      alert('We could not complete your subscription. Please try again.')
      return
    }
  } else {
    const subscribers = JSON.parse(localStorage.getItem('subscribers') || '[]')
    if(!subscribers.includes(email)) {
      subscribers.push(email)
      localStorage.setItem('subscribers', JSON.stringify(subscribers))
    }
  }
  
  // Show success feedback
  const originalText = button.textContent
  button.textContent = '✓ Subscribed!'
  button.style.background = 'rgba(255,255,255,0.9)'
  form.querySelector('input').value = ''
  
  setTimeout(()=>{
    button.textContent = originalText
    button.style.background = ''
  }, 3000)
}

window.addEventListener('DOMContentLoaded',init)

// ===== Loader (preloader) control =====
function setupLoader(){
  const loader = document.getElementById('loader')
  if(!loader) return

  // Lock body scroll while the loader is visible
  const lockScroll = ()=>{
    document.body.style.overflow = 'hidden'
  }
  const unlockScroll = ()=>{
    document.body.style.overflow = ''
  }

  const hideLoader = ()=>{
    loader.classList.add('loader-hide')
    unlockScroll()
    // Remove the loader from the DOM after the fade-out transition
    setTimeout(()=>{
      if(loader && loader.parentNode) loader.parentNode.removeChild(loader)
    }, 650)
  }

  lockScroll()

  let done = false
  const finish = ()=>{
    if(done) return
    done = true
    hideLoader()
  }

  // Hide as soon as the full page (incl. images) has loaded
  window.addEventListener('load', finish)

  // Fallback: never let the loader get stuck (min display time ~2.6s)
  setTimeout(finish, 2600)
}

// Run loader setup immediately (the loader markup is present in the DOM)
setupLoader()

// ===== Contact page handlers (moved from inline script) =====
function handleContactReset(){
  const form = document.querySelector('.contact-form')
  if(!form) return
  form.reset()
  const status = document.getElementById('contactStatus')
  if(status) status.textContent = ''
}

async function handleContactSubmit(event){
  event.preventDefault()
  const form = event.target
  const status = document.getElementById('contactStatus')

  const name = form.querySelector('#name')?.value?.trim()
  const email = form.querySelector('#email')?.value?.trim()
  const message = form.querySelector('#message')?.value?.trim()

  const emailOk = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  if(!name || !emailOk || !message){
    if(status) status.textContent = 'Please fill out all fields with valid information.'
    return
  }

  const submission = {
    name,
    email,
    topic: form.querySelector('#topic')?.value || '',
    campus: form.querySelector('#campus')?.value || '',
    message,
    created_at: new Date().toISOString()
  }

  if(window.campusAuraSupabase){
    const { error } = await window.campusAuraSupabase
      .from('contact_submissions')
      .insert(submission)

    if(error){
      console.warn('Contact submission failed:', error)
      if(status) status.textContent = 'We could not send your message. Please try again.'
      return
    }
  } else {
    const submissions = JSON.parse(localStorage.getItem('contactSubmissions') || '[]')
    submissions.push(submission)
    localStorage.setItem('contactSubmissions', JSON.stringify(submissions))
  }

  if(status) status.textContent = '✓ Message sent! We will get back to you soon.'
  form.reset()
}

// expose to inline HTML attributes (onsubmit/onClick)
window.handleContactSubmit = handleContactSubmit
window.handleContactReset = handleContactReset
