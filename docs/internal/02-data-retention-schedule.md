# Data Retention Schedule

This schedule is a control baseline and not a substitute for legal advice. Exact periods must be finalised after counsel has reviewed the applicable statutory obligations and the final architecture.

| Record | Baseline | Disposal trigger |
|---|---|---|
| Expired or open listings | Delete or de-identify promptly after operational need ceases | Expiry plus an operational grace period |
| Sessions | Expire automatically | Session expiry |
| OTP records | Short-lived | OTP expiry or failed-attempt lock |
| Messages | Only as necessary for service, safety and disputes | End of purpose plus approved retention |
| Reports and abuse cases | Retain while needed for safety, investigation and legal claims | Case closure plus approved retention |
| Security and operational logs | Maintain in accordance with applicable CERT-In and legal requirements | After the required period |
| Backups | Rolling and access-controlled | Backup lifecycle |
| Account deletion records | Minimal completion evidence | Approved retention |
| Legal holds | Preserve | Written release of hold |

## Rules

- A legal hold overrides ordinary deletion.
- Security incident evidence must not be deleted during an active investigation.
- Deletion must be logged without retaining unnecessary personal data.
- Retention must be reviewed at least annually, and whenever law or architecture changes.

## Risk-Reduction Requirements

Retention must have a documented purpose. The shortest practical period should be preferred, subject to security, fraud, dispute, legal-hold and applicable statutory requirements. Deletion jobs and manual deletion requests must be testable. Location history must not be retained merely because it is technically convenient.
