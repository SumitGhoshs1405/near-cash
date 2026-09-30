# Near Cash — Cloudflare Free Deployment

This version moves the Node/JSON-file backend to Cloudflare Workers + D1 + SQLite-backed Durable Objects while keeping the existing frontend and API paths. It removes the Render Free cold-start page.

## Important
- The JSON file database is replaced by D1. The ZIP you supplied did not contain a persistent `data/db.json`, so there is no existing database to migrate in this package.
- Phone OTP still requires your `SMS_WEBHOOK_URL` and optional `SMS_WEBHOOK_TOKEN` secrets.
- Live updates use a Durable Object (`UserStream`).
- The frontend files are unchanged from the supplied Near Cash v4 package.

## Deploy
1. Install Node.js 18+.
2. Install Wrangler: `npm install`.
3. Log in: `npx wrangler login`.
4. Create the database: `npx wrangler d1 create near-cash-db`.
5. Put the returned database ID into `wrangler.jsonc` in place of `REPLACE_WITH_D1_DATABASE_ID`.
6. Initialize schema: `npx wrangler d1 execute near-cash-db --remote --file=schema.sql`.
7. Set secrets:
   - `npx wrangler secret put SMS_WEBHOOK_URL`
   - `npx wrangler secret put SMS_WEBHOOK_TOKEN`
8. Deploy: `npx wrangler deploy`.

## Local development
`npx wrangler dev`

Sign-in codes: production sends real SMS. Add the secrets `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (or `SMS_WEBHOOK_URL` + `SMS_WEBHOOK_TOKEN`) with `npx wrangler secret put <NAME>` **before deploying** - `REQUIRE_SIGNIN` is now `"true"`, so nobody can sign in until an SMS provider is configured. For local development copy `.dev.vars.example` to `.dev.vars` (git-ignored) to see codes on screen; `DEV_OTP` is only honoured on `localhost`/`127.0.0.1` and is ignored on any deployed hostname.

## Google Maps view
Open config.js, paste your Google Maps JavaScript API key between the quotes, and redeploy. In Google Cloud, restrict the key to your website address. Without a key the Map tab shows a setup note and the radar still works.


## Admin analytics dashboard

This build adds a read-only admin endpoint for the separate Near Cash Admin Dashboard. It does not change the normal app routes or UI.

### Cloudflare setup

1. In the Near Cash Worker **Production** environment, add a secret named exactly `ADMIN_ANALYTICS_KEY` (Workers & Pages → near-cash → Settings → **Variables and Secrets** → Add → type **Secret**, not "Text"/plaintext Variable).
2. Use a long random value as the secret. Do not commit it to GitHub.
3. Click **Deploy** in that same Variables and Secrets screen (Cloudflare requires this even for secret-only changes — it's a separate step from saving the value).
4. Verify with a plain GET request (no key needed) to `https://<your-worker>.workers.dev/api/admin/status`. It must return `"configured":true`.

**If it still says `"configured":false` after that:**
- Open the same URL again and look at the new `presentAdminBindings` field in the response. If it lists a name (e.g. a different case or a stray space), that's the actual saved name — fix it to exactly `ADMIN_ANALYTICS_KEY`. If the list is empty, the secret genuinely never reached this Worker.
- Confirm you edited the **same** Worker service this URL belongs to — if you have more than one Worker (e.g. one created via the dashboard's Quick Edit and one deployed by `wrangler deploy` from this repo), the secret has to be on the one actually serving `/api/admin/status`. The Worker name is `near-cash` per `wrangler.jsonc`.
- Confirm you added it under **Production**, not **Preview** — Preview secrets are not visible to the live `*.workers.dev` deployment.
- If you added it as a Variable (plaintext) instead of a Secret, or via a Secrets Store binding rather than a classic Worker secret, the binding name won't be readable the same way — recreate it as a classic **Secret**.
- After fixing the name/environment, re-run `npx wrangler deploy` from this project (or click Deploy again in the dashboard) — the Worker only picks up the change after that.
5. In the separate `near-cash-admin` repository, set the API base to this Worker URL (for example, `https://your-worker.workers.dev`).
6. Open the admin dashboard and enter the same admin key.

The dashboard calls `GET /api/admin/summary` with `X-Admin-Key`. For troubleshooting, `GET /api/admin/status` publicly reports only `configured` true/false; a caller who also sends the valid `X-Admin-Key` additionally sees the *names* of any admin/analytics-looking bindings — it never exposes the secret value itself. The Worker accepts the primary `ADMIN_ANALYTICS_KEY` binding and the legacy aliases `ADMIN_ANALYTICS_K` and `ADMIN_KEY`. The endpoint reads existing D1 data and returns privacy-safe aggregate statistics.

The endpoint supports CORS for the separate dashboard and does not expose phone numbers, session tokens, PINs, message text, or exact user locations.


## Security hardening (v10)

The Worker now applies API rate limiting, strict Bearer-token authentication for authenticated API requests, security response headers, production-safe error responses with request IDs, race-safe listing claiming and meetup-PIN completion, and authenticated streaming without putting the session token in the stream URL.

`ADMIN_ORIGIN` is an optional Worker environment variable. If set, browser access to the admin analytics API is restricted to that exact origin. **If it is not set, no cross-origin access is allowed (no wildcard).** Set `ADMIN_ORIGIN` to the exact origin of your admin dashboard (for example `https://near-cash-admin.pages.dev`, no trailing slash) or the dashboard's browser calls will be blocked. The admin key is always required for analytics data.

## Production observability (Upgrade 4)

This build adds a D1-backed operational event log for production troubleshooting without storing phone numbers, session tokens, meetup PINs, message bodies, or exact user locations.

Tracked operational events include:
- unhandled API/server errors
- API/admin rate-limit events
- authenticated-session failures
- health-check/database failures

The separate admin dashboard can use `GET /api/admin/observability` with the same `X-Admin-Key` already used by `/api/admin/summary`. It returns aggregate event counts for the last 24 hours plus a bounded recent-event list containing timestamps, route, status, request ID, event type, and a sanitized diagnostic message.

`GET /api/admin/summary` now reports real 24-hour/30-day server-error counts and 24-hour rate-limit/auth-failure counts instead of a hard-coded zero error count.

The new `observability_events` table is included in `schema.sql`, and `ensureSchema()` creates it automatically for existing D1 databases. Events older than 30 days are sampled for cleanup to keep the table bounded.


## Upgrade 5 — Product Analytics
- Added privacy-minimized anonymous product event telemetry.
- Added D1-backed `analytics_events` with 90-day bounded retention.
- Added protected admin summary analytics: event volume, unique anonymous clients, and top events over 30 days.
- Added client events for key funnel actions without collecting phone numbers, names, addresses, coordinates, OTPs, or financial credentials.
- Analytics collection is best-effort and never blocks the user flow if unavailable.
- OTP/auth/security/trust-safety behavior is unchanged.


## Upgrades 6–9 consolidated (v10)
- Performance/scalability: bounded nearby/thread reads and additional D1 indexes.
- Privacy/data controls: authenticated export, location removal, and explicit DELETE account removal endpoints.
- PWA/UX resilience: v10 service worker, offline fallback, safer static-asset caching, and update handling.
- Commercial/launch readiness: privacy/terms/security templates, robots.txt and security.txt launch-readiness files; add the real production sitemap/contact before launch.
- Existing security, trust & safety, observability, analytics, and OTP behavior retained.
- Legal/compliance templates require production-specific review before launch.

## Automated QA suite (consolidated build)
This package includes the regression suite from the QA hardening stage under `tests/qa.test.mjs`.
Run `npm test` to execute the regression suite, or `npm run check` to run JavaScript syntax checks followed by the QA suite.
The suite checks authentication, security headers, request/rate protections, trust & safety, race-safe matching, meetup PIN protection, service-worker versioning, and frontend secret exposure.


## Legal, privacy and trust documentation

This build includes a public Legal Centre and the following public documents:
- Privacy Policy
- Terms of Use
- Financial Crime & Acceptable Use Policy
- User Safety & Meetup Policy
- Community Guidelines
- Report & Abuse Policy
- Grievance & Dispute Policy
- Cookie & Analytics Notice
- Account & Data Deletion
- Intellectual Property & Copyright
- Security & Responsible Disclosure

Internal operational controls are in `docs/internal/` and include the data inventory, retention schedule, incident response, moderation SOP, lawful-request procedure, admin access policy, vendor due diligence, business continuity, regulatory applicability matrix and launch gate.

The complete human-readable compilation of the 25 v16 documents is included at `docs/legal/Near_Cash_v16_All_Legal_Compliance_Documents.pdf`, with an editable Word version at `docs/legal/Near_Cash_v16_Legal_Compliance_Documents_Revised.docx`. The legal-source and review basis is documented in `docs/internal/13-legal-sources-and-review-basis.md`. Official source links are recorded there; legal applicability and commencement must be confirmed by Indian counsel before launch.

These documents are intentionally drafted as a product-specific compliance framework, not as a representation that every Indian law is automatically satisfied. Before commercial launch, the operator must replace bracketed entity/contact fields, verify every vendor/data flow, and obtain Indian legal review. Any material product change—especially custody, payment processing, settlement, financial products, children, international expansion or materially more precise location—requires a fresh legal/regulatory review.


## Current operator profile (28 September 2026)
- Operating name: Near Cash
- Individual operator: Sumit Ghosh
- India; West Bengal
- Business address: Kabiraj Mess, Barbaria Main Road, Barbaria, Barasat, West Bengal 700126, India
- Contact: nearcash.info@gmail.com
- Website: https://nearcash.site
- No CIN / no GSTIN provided; do not represent Near Cash as an incorporated company.
- Non-custodial: Near Cash does not hold, custody, transfer, settle or process participant funds.


## Security hardening (v19)

| Checklist item | What is enforced |
|---|---|
| Hide secrets | No secrets in code or `wrangler.jsonc`; secrets via `wrangler secret put`; `.gitignore` covers `.dev.vars`/`.env`; `DEV_OTP` works on localhost only; CI secret scan (gitleaks) + `npm run security` |
| Real authentication | SMS OTP required (`REQUIRE_SIGNIN=true`, guests disabled); codes never returned by the API; single-use, 5-minute, 5-try codes; hashed session tokens; `POST /api/logout` revokes the session server-side; failed SMS sends do not lock the number out |
| Row-level security | D1 has no RLS, so every query is scoped in the Worker by the authenticated user id (`a=? OR b=?`, `uid=?`); covered by cross-user integration tests |
| Rate limiting | Durable (D1) limits, shared across instances and surviving redeploys: OTP 5/hour per phone and 10/hour per IP, verify 30/hour per IP, guest creation 20/hour per IP, admin 30-60/min per IP, admin key lockout after 10 wrong keys/hour per IP; plus existing per-user limits |
| Server-side validation | Body must be a JSON object (<= 10 KB); ids coerced to strings; lat/lng must be real numbers in range; amounts/minutes/types whitelisted; control characters stripped from names, areas and messages; all SQL parameterized |
| Automated checks | `npm run check` = syntax + 47 tests (including an integration suite running the real Worker on SQLite) + `scripts/security-check.mjs`; GitHub Actions runs it plus `npm audit` and gitleaks on every push/PR and weekly; Dependabot enabled |

Headers: API responses and static assets (via `public/_headers`) send a Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy and Permissions-Policy. The CSP allows inline scripts/styles because the UI uses inline `onclick` handlers; it still blocks third-party scripts, framing, plugins, `<base>` hijacking and any network request to other origins.

Apply the new table before/at deploy: it is created automatically on first request, or run `npx wrangler d1 execute near-cash-db --remote --file=schema.sql`.
