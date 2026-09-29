# Admin Access Control Policy

1. Least privilege applies by default.
2. Production, development and administrative credentials must be kept separate.
3. Shared admin passwords are prohibited.
4. Strong, unique credentials and multi-factor authentication (MFA) must be used where supported.
5. Admin secrets must be stored only in the approved secret manager.
6. Admin APIs must use server-side authorisation, rate limiting and origin controls where appropriate.
7. Phone numbers, exact locations, messages, OTPs, session tokens and meetup PINs must not be exposed in aggregate analytics.
8. Admin access must be reviewed after role changes and periodically.
9. Privileged actions must be logged where technically feasible.
10. Access must be revoked immediately when no longer needed.
11. Secrets must never be committed to GitHub.
12. Authorisation must be tested server-side and must never rely solely on UI restrictions.

## Risk-Reduction Requirements

Use least privilege, unique administrator identities, strong authentication, periodic access reviews and auditable administrative actions. Never share administrator credentials. Remove access promptly when a role ends or no longer requires access.
