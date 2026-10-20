# TODO — CampusAura full site functionality

## 1) Audit existing pages & JS wiring
- [x] Inspect existing HTML pages: index, about, accommodation, marketplace, events, contact, profile
- [x] Inspect `js/app.js` data + render functions
- [ ] Identify missing UI elements referenced by JS (empty states, featured sections, filters, etc.)

## 2) Fix runtime/runtime issues
- [ ] Ensure JS only references existing DOM ids/classes OR update HTML to include expected ids
- [ ] Ensure filter/search buttons trigger the intended renderers (accommodation/marketplace/events)

## 3) Implement missing page-specific functionality
- [ ] Profile page: populate tabs (activity/listings/transactions/reviews) with prototype content using `localStorage`
- [ ] Events page: implement RSVP persistence + update “You’re Going” count
- [ ] Marketplace page: make list/search/sort controls actually affect the results grid
- [ ] Accommodation page: ensure sort/view controls, empty state, and load-more render correctly with current grid/list toggle

## 4) Create missing HTML components if any
- [ ] Add any missing containers expected by JS (e.g., `#featuredEvents`, correct grid ids)

## 5) Verification
- [ ] Open each page and validate:
  - [ ] No console errors
  - [ ] Cards render
  - [ ] Filters/search/sort work
  - [ ] Load more works
  - [ ] RSVP persists across refresh
  - [ ] Profile tabs switch and populate


