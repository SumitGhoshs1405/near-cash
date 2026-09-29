# Business Continuity & Recovery

## Critical Services

Authentication; matching and listings; messaging; reports and blocks; admin controls; and database availability.

## Controls

- Maintain tested database backups where supported.
- Document restoration steps.
- Keep deployment configuration and infrastructure versioned.
- Maintain emergency contacts.
- Test restore procedures periodically.
- Maintain a rollback path for defective releases.
- Keep incident evidence separate from ordinary deletion.
- Review recovery arrangements after major architecture changes.

## Recovery Priority

1. User safety and account security.
2. Containment of abuse or compromise.
3. Restoration of authentication and core matching.
4. Restoration of non-critical analytics.
5. Completion of the incident review.

## Risk-Reduction Requirements

Recovery plans must protect user data from accidental exposure as well as from downtime. Test backups, restore procedures, credential rotation and the emergency disablement of risky features. Maintain a rollback path for releases affecting authentication, location, reporting or matching.
