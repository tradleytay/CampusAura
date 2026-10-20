# CampusAura Security Review

## Review scope

Static review of repository HTML, CSS, browser JavaScript, Supabase SQL migrations, and the campus-aura-email Edge Function. This review did not connect to the live Supabase project or send real email.

## Current assessment

The application has meaningful database-side protections when the hardening migrations are applied: profile privilege changes are guarded by a trigger, review actions use administrator-only database functions, verification documents use a private storage bucket, and account freezes are enforced in database access policies. The browser's role-based redirects are navigation helpers; database policies and functions remain the security boundary.

The email path now invokes the campus-aura-email Supabase Edge Function. The old finding that the frontend email endpoint was blank is no longer accurate. The function authenticates the caller, checks administrator rights before sending review decisions, and uses server-side Resend and Supabase secrets. Actual delivery still depends on deploying the function, configuring its secrets, and verifying the sender domain.

## Remaining risks and operational checks

### 1. Anonymous endpoints can be abused

Contact submissions and newsletter signups accept anonymous inserts. Listing analytics also accepts anonymous view and contact-click events. I did not find application-level rate limits or anti-spam checks in the repository. These endpoints could receive spam or inflated analytics.

Recommended action: Add rate limits and input controls at the server or edge layer; monitor submissions and analytics for abuse.

### 2. Existing-account approval bypasses individual review

supabase/approve-existing-accounts.sql approves every existing account and promotes accounts whose requested role is provider. This is a deliberate bulk action, but it marks provider accounts verified without requiring the script to confirm that each account's documents were reviewed.

Recommended action: Use this only for accounts that have been vetted, or keep unreviewed provider accounts pending.

### 3. Listing images are intentionally public

The listing-images bucket is public so published listing photos can load without a signed-in session. Verification documents belong in the separate private verification-documents bucket. Never put identity or student ID documents in the public listing bucket.

### 4. Initial schema is not a safe final state

The initial schema lets users update their own profile row. Later hardening migrations add checks that prevent self-service changes to privileged profile fields. A database that has only the initial schema or an incomplete migration chain is not ready for real users.

### 5. Verify live configuration

Repository code cannot confirm which SQL migrations have run in the live Supabase project, whether storage policies match the current files, or whether Edge Function secrets and sender-domain verification are active. Confirm these in the Supabase dashboard and test the flows using non-production accounts.

## Findings previously reported that have changed

- The frontend email client now calls a Supabase Edge Function instead of relying on a blank endpoint.
- The administrator review UI reports when the review succeeded but the notification email failed.
- Verification documents are stored separately from public listing photos, with private-bucket access controls in the hardening migrations.

## Conclusion

The repository is substantially more secure when the full migration chain is applied. The remaining code-level concerns are abuse controls on anonymous write/analytics endpoints, the trust implications of bulk approval, and confirming the live environment matches the repository. This document is a static code review, not a penetration test or live deployment certification.