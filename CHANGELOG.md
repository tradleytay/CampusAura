# CampusAura platform history

This document describes the platform and records changes by date where the available project records support a date. It is based on the repository documentation and changes recorded for October 23, 2026.

The project directory available when this document was created did not include Git history. As a result, dates for older features cannot be reliably reconstructed. Those features are listed under **Date not recorded** rather than assigned invented dates. The live Supabase project and production deployment were not inspected; a change in the source files does not by itself confirm that it has been deployed.

## Platform overview

CampusAura is a responsive student platform for discovering campus accommodation, buying and selling marketplace items and services, and finding campus events. Its public site is built with HTML, CSS, and JavaScript. Supabase provides authentication, database, and file storage services.

The platform has separate experiences for students, providers, and administrators:

- **Public site:** Home, about, accommodation, marketplace, events, contact, privacy, and terms pages.
- **Student dashboard:** Saved accommodation, event RSVPs, the student's marketplace listings, and optional student-status verification.
- **Provider dashboard:** Provider listings and events according to assigned eligibility, analytics, contact activity, and provider verification.
- **Admin dashboard:** Account and document review, listing and event moderation, account controls, analytics, and email history.
- **Shared services:** Supabase authentication and data, Resend email through a Supabase Edge Function, and a service worker for installability and offline page access. Account actions and live data still require a network connection.

For setup and the full Supabase migration sequence, see [README.md](./README.md). The dated record below is not a substitute for applying migrations or deploying updated site and Edge Function code.

## 2026-10-24

### Event visibility cutoff

- Public event cards and upcoming-event counts now include events through the end of their calendar date and hide them starting at local midnight on the following date.
- The public event list, featured events, homepage previews, and student upcoming-RSVP sections refresh when the date changes, including when a page is left open overnight or returns to the foreground.
- Expired event rows are preserved in Supabase and remain available to administrators and providers; this change hides them from upcoming views rather than deleting their records.
- Incremented the service-worker cache version so deployed clients can receive the update.

## 2026-10-23

### Email sender troubleshooting

- Diagnosed the admin email failure as Resend rejecting the configured `CAMPUSAURA_EMAIL_FROM` value, rather than a problem with the email message body.
- Documented how to edit the existing Supabase Edge Function secret and enter a valid sender format at a domain verified in Resend.
- This was configuration guidance; it did not verify or change the live Supabase secret.

### Join Community destination

- Changed the public-site **Join Community** button to open `register.html` rather than the WhatsApp community link.
- Updated the navigation button on the home, about, accommodation, marketplace, events, and contact pages.

### Dashboard settings

- Added student settings for editable name, phone, and campus, saved content and notification preferences, and links to password recovery, support, legal pages, verification, and the existing sign-out control.
- Added provider settings for editable public name and phone, verification status and document guidance, listing eligibility, saved notification preferences, support, and account-security links.
- Reused existing student verification, provider eligibility, admin user-management, verification moderation, listing moderation, and sign-out features rather than duplicating their workflows.
- Added admin controls for platform name, logo, contact details, maintenance notices, scheduled platform announcements, administrator access, an audit log, and Supabase/Resend configuration checks.
- Added the `supabase/dashboard-settings.sql` migration for saved preferences, platform settings, announcements, audit records, and guarded administrator access changes.
- Added a read-only administrator status response to the `campus-aura-email` Edge Function. It reports whether the Resend key and sender are configured without exposing secret values.
- Updated the public pages to display saved announcements and maintenance notices, and incremented the service-worker cache version.
- Added migration and deployment guidance to [README.md](./README.md).

**Deployment note:** These dashboard settings are present in the source code. The database-backed features require `supabase/dashboard-settings.sql` to be run in the correct migration order. The integration check also requires redeploying `supabase/functions/campus-aura-email`. This record does not confirm either action has been completed in production.

## 2026-05-28

### Footer redesign (date recorded in the existing footer document)

- The existing [FOOTER_IMPROVEMENTS.md](./FOOTER_IMPROVEMENTS.md) records a professional, responsive footer redesign, including product and company links, support and legal links, social links, a newsletter section, and responsive layouts.
- That document also describes newsletter form behavior and visual interaction details.

This entry records what the dated project document says; it is not an independent verification of the live site or of the exact state of every footer page.

## Date not recorded

The following capabilities are documented in the repository, but their original implementation dates are not recorded in the available history:

- Public pages for accommodation, marketplace listings, events, contact, about, privacy, and terms.
- Search, filters, listing details, saved accommodation, event RSVPs, and listing views/contact analytics.
- Student and provider registration, sign-in, email confirmation, password recovery, and role-specific dashboards.
- Optional student ID verification and provider NRC review, with administrator review workflows.
- Provider eligibility for accommodation, marketplace, and event-organizer tools.
- Administrator account management, account freezes, listing moderation and suspension, analytics, and an email outbox.
- Supabase-backed listings, profiles, events, storage, analytics, and access controls defined by the SQL migrations.
- Registration, review-decision, and administrator emails sent through the Supabase Edge Function and Resend.
- PWA installation and cached offline page loading.
- Unified public navigation and the Student Hub, as described in [TODO.md](./TODO.md).
- About-page and general site functionality work as described in [TODO_about_page.md](./TODO_about_page.md) and [TODO_site_functionality.md](./TODO_site_functionality.md). Those files include unchecked items, so they should be treated as project notes, not proof that every listed task is complete.

## How to extend this history

Add a new date heading in `YYYY-MM-DD` format for each day with meaningful platform changes. Under it, summarize user-visible changes, database or Edge Function changes, relevant migration/deployment requirements, and any validation performed. Record the implementation date separately from the production deployment date whenever they differ.
