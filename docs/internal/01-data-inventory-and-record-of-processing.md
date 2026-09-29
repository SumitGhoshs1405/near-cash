# Data Inventory & Record of Processing

| Data class | Examples in current build | Purpose | Access | Retention owner |
|---|---|---|---|---|
| Account | User ID, display name, phone | Authentication and account management | Backend and admin, as necessary | Data owner |
| Location | Latitude and longitude, area | Nearby matching | Matching service; precision to be minimised | Data owner |
| Listings | Type, amount, expiry, area | Matching | Matched participants and backend | Product owner |
| Communications | Thread and message text | Coordination and safety | Participants; authorised moderation only where necessary | Trust & Safety |
| Reports | Reporter, subject, thread, reason | Abuse response | Trust & Safety and admin | Trust & Safety |
| Blocks | Blocking and target user IDs | User safety | Backend | Trust & Safety |
| Ratings | Stars and tag | Reputation | Relevant users and admin | Product owner |
| Authentication | Session hashes, OTP hashes and expiry | Account security | Backend only | Security owner |
| Security logs | Route, status, request ID, diagnostics | Security and operations | Security and admin | Security owner |
| Analytics | Pseudonymous client ID and events | Product reliability | Analytics and admin | Product owner |

## Controls

1. Collect only data necessary for the stated purpose.
2. Do not expose precise location to other users unless a separately reviewed feature requires it.
3. Do not store plaintext OTPs, passwords or transaction PINs.
4. Do not place secrets in source control.
5. Do not use analytics data to infer sensitive attributes.
6. Maintain a vendor list and a data-flow diagram.
7. Review this record after any material product or vendor change.

## Current Provider Note

Cloudflare is used for the Worker, D1 database and infrastructure, together with other Cloudflare services. A conditional Twilio SMS and OTP integration is present in the application code and must be treated as an external processor or service provider if enabled in production.

## Risk-Reduction Requirements

- Record each data field, its source, purpose, access role, retention period and deletion mechanism.
- Treat precise location as sensitive operational data requiring strict access control and minimisation.
- Do not place authentication secrets or precise location in analytics metadata.
- Reconcile this inventory against the production schema after every material release.
- Record Cloudflare and any enabled SMS or OTP provider as relevant service providers or processors where they process personal data.
