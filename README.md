CampusAura — Student Lifestyle Platform

CampusAura is a responsive, multi-page student platform for accommodation, marketplace listings, and campus events. The frontend uses HTML, CSS, and JavaScript, with Supabase providing authentication, database, and storage services. Production readiness depends on completing the deployment and Supabase configuration below; this repository alone cannot verify the live service.

Files
- index.html — Home page with hero, previews, and search
- about.html — About page (mission, vision, benefits, timeline)
- accommodation.html — Accommodation listing page with filters
- marketplace.html — Marketplace page with category filters
- events.html — Events listing page with type filters and RSVP buttons
- contact.html — Contact page with form and support info
- privacy.html and terms.html — Privacy Policy and Terms of Service
- verify.html — Authenticated document submission for users who confirm their email before verification
- /css/style.css — Central styles (responsive, grid/flex, animations)
- /css/home.css — Homepage fresh-content carousel and responsive presentation
- /js/app.js — Data arrays, dynamic rendering, search, filters, mobile menu, RSVP
- /images — Placeholder images and an SVG illustration

How to view locally
- Serve the app over localhost to enable its service worker and PWA installation:

PowerShell (Windows):

```powershell
# If you have Python installed
python -m http.server 8000; # then open http://localhost:8000

# Or using Node (if you have http-server installed globally)
# npx http-server -p 8000
```

PWA and offline support
- The app can be installed from HTTPS deployments and from `localhost`. The service worker precaches the app shell, pages, local scripts, styles, and local images; when a page is not cached and the network is unavailable, it shows `offline.html`.
- The offline cache does not make account actions, listings, or other Supabase-backed features available offline. Requests marked `private` or `no-store` are not saved by the service worker.
- To verify locally, open the site through the local server, wait for the service worker to install, then use browser DevTools to simulate offline mode and visit both a cached page and an uncached URL. Confirm installability and update behavior on the deployed HTTPS domain as well.

Supabase setup
- Open `supabase/supabase-schema.sql` in the Supabase Dashboard SQL Editor and run it once.
- Then run `supabase/supabase-upgrade.sql` to enable authentication, provider permissions, admin access, saved listings, and secure role handling.
- Run `supabase/supabase-final-upgrade.sql` after the upgrade to add final schema changes.
- Run `supabase/analytics.sql` after the schema and provider upgrades to enable listing views, contact-click metrics, and live provider dashboard updates.
- Run `supabase/admin-analytics.sql` after `supabase/analytics.sql` to enable the administrator Analytics dashboard. Its security-definer function only returns aggregated analytics to signed-in administrators.
- Run `supabase/launch-hardening.sql` after the schema, provider, final, and analytics migrations. It prevents users from changing their own role or verification status, makes administrator verification decisions atomic, and requires administrator review before provider accommodation and marketplace listings become public. Only administrators can publish events. Registration with email confirmation enabled redirects users to sign in and submit verification documents on `verify.html`.
- Run `supabase/account-freeze-controls.sql` after `supabase/launch-hardening.sql` to enable administrator account freezes and block frozen accounts from protected features.
- Run `supabase/provider-listing-access.sql` after `supabase/launch-hardening.sql` and `supabase/account-freeze-controls.sql`. New providers choose either properties/accommodation or the products-and-services marketplace during registration. Admins can grant one or both sections from the provider's Users-table detail view; the database enforces this access for listing creation, updates, and deletion. Existing providers retain their current access until an administrator reviews their section assignment. The migration adds an optional per-listing seller/business display name and a case-insensitive unique index on profile email; if duplicate profile emails already exist, it stops without deleting accounts so they can be reconciled first.
- Run `supabase/admin-dashboard-controls.sql` after `supabase/provider-listing-access.sql`. It enables admin account deletion, suspension of accommodation, marketplace, and event listings, and the administrator email outbox. Redeploy `supabase/functions/campus-aura-email` after applying it so sent admin emails and review notices are recorded in the outbox.
- Run `supabase/auth-onboarding-hardening.sql` in an existing project to ensure future profile rows default to pending review. It does not change existing profile statuses.
- Run `supabase/student-onboarding-optional-id-review.sql` after the existing schema, upgrade, and hardening scripts. It enables student-only ID submissions by allowing the provider identity-document column to be empty for student verification records; without this migration, optional student ID submission will fail against older schemas.
- Run `supabase/home-feed-publishing.sql` after `supabase/launch-hardening.sql`. It tracks when accommodation and marketplace listings are published, backfills existing public listings, and adds listing/event tables to Supabase Realtime when available. The homepage uses these publication timestamps to show newly approved listings first; it also refreshes periodically if Realtime is unavailable.
- Run `supabase/admin-multi-image-uploads.sql` to enable image galleries for accommodation, marketplace, and event listings. Administrator and approved-provider uploads are stored in the public `listing-images` bucket; the first image remains in `image_url` for compatibility with older pages.
- To mark only accounts that already exist as verified, run `supabase/approve-existing-accounts.sql` once in the SQL Editor. It also approves existing verification records and activates provider roles; future registrations and account freezes are unchanged.
- If an existing deployment reports that `profiles.rejection_reason` is missing when reviewing a user, run `supabase/supabase-review-fix.sql` in the SQL Editor. It adds the review columns if needed and refreshes the PostgREST schema cache.
- Optionally run `supabase/supabase-demo-data.sql` to add the sample listings and events. Without it, public pages remain empty until real records are added.
- The browser client is configured in `js/supabase.js` with the project's publishable key.
- Only the publishable key belongs in frontend code. Never add the Supabase service-role key here.
- Registration defaults to student and requires a `@stud.unilus.ac.zm` address plus a UNILUS campus selection (or another university name). Provider registration uses its own email field. Student ID review remains optional on the student dashboard; providers submit an NRC for review after confirming email and signing in. Apply `student-onboarding-optional-id-review.sql` to existing deployments so student ID-only submissions work with the database schema.
- A provider can select only one section during registration. If they need properties plus products/services, an administrator can grant both sections after a request. Marketplace listings can optionally show a business/display name instead of the provider's account name. Supabase Auth already prevents duplicate account emails; the provider listing migration additionally protects profile email records with a normalized unique index.
- In Supabase Auth, set the production Site URL to `https://campusaura.org` and add `https://campusaura.org/auth.html` and `https://campusaura.org/reset-password.html` to the allowed redirect URLs. Signup confirmation explicitly redirects to `auth.html`; after Supabase restores the session, pending users are routed to `verify.html` to submit identity/student documents. Password recovery explicitly redirects to `reset-password.html`. These exact URLs must be allowed for the flows to work as intended. Decide whether email confirmation is required and test confirmation and password recovery from the deployed domain. Create the first administrator securely through the Supabase dashboard; never expose service-role credentials in the frontend.
- The password-recovery and signup-confirmation email templates should link through `{{ .ConfirmationURL }}` so Supabase validates the token and redirects to the flow-specific destination. Configure SMTP/delivery and test with newly generated emails.
- CampusAura registration and approval/rejection notifications, plus administrator emails to one selected student or provider at a time, use the `supabase/functions/campus-aura-email` Edge Function. Verify the sending domain in Resend, then add `RESEND_API_KEY` and `CAMPUSAURA_EMAIL_FROM` as Edge Function secrets in Supabase (for example, `CampusAura <no-reply@mail.campusaura.org>`, using an address at the domain verified in Resend). Deploy with `supabase functions deploy campus-aura-email --project-ref enzemdcsfoxbpjyvyknh`. Supabase provides the project URL, anon key, and service-role key to Edge Functions; keep the Resend key and service-role key out of frontend code and source control. The function validates the signed-in user, independently checks administrator permission, resolves the recipient address server-side, sends the administrator's plain-text subject and message to that recipient only, and records delivered admin messages in the Messages outbox.
- Before accepting real verification documents, confirm storage privacy and RLS policies in the live Supabase project, configure retention and deletion procedures, and obtain jurisdiction-specific review of the privacy and terms pages.

What I implemented
- Responsive, modern UI inspired by startup design systems (Airbnb/Stripe/Notion)
- Brand colors, gradients, and typography (Poppins/Inter)
- Student-first hero with direct accommodation and marketplace calls to action
- Live homepage carousel for newly published accommodation and marketplace listings
- Upcoming-events preview followed by category discovery and a concise listing-review trust section
- Dedicated pages for accommodation, marketplace, events, and profile
- JavaScript-driven dynamic card rendering from arrays
- Search across datasets, accommodation & marketplace filters, category filters
- Mobile menu toggle, smooth scrolling, hover animations, rounded corners
- Compact account icon/initials in the navigation and floating theme and WhatsApp controls

Launch checklist
- Replace sample content and imagery with accurate, authorized production material.
- Verify account creation, document review, listings, RSVPs, contact forms, and analytics in a staging Supabase project.
- Confirm privacy, security, accessibility, data-retention, and support processes before inviting real users.

PWA, offline access, and display
- Use `http://localhost` or deploy over HTTPS. Opening an HTML file directly can preview the UI, but browsers disable service workers and PWA installation for `file://` pages.
- The web manifest is at `icons/site.webmanifest`; its launch page and scope resolve to the site root.
- The service worker caches the site pages, styles, scripts, images, and app icons for offline loading. A network connection is still needed for Supabase-backed sign-in and live data.
- A dismissible install card presents the CampusAura app icon and install instructions. When publishing a service-worker update, increment `CACHE_NAME` in `sw.js`; the app announces the new version and offers a refresh action.
- Choose Dark or Light from the theme control; your preference is saved on this device and shared across pages.
- The layout adapts from narrow mobile screens to desktop dashboards. Tables retain their own horizontal scrolling where required.
