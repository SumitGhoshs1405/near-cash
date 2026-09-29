# Near Cash — Compliance Launch Gate

The product must not be marked READY until every applicable item has an owner and evidence.

## Entity & Governance

- [ ] Legal entity and operator name finalised
- [ ] Registered or business address finalised
- [ ] Official privacy, grievance and security contacts live
- [ ] Age and eligibility rule finalised
- [ ] Counsel review completed and documented

## Public Documentation

- [ ] Privacy Policy matches actual data flows
- [ ] Terms match the actual non-custodial architecture
- [ ] Acceptable Use Policy published
- [ ] Safety and Meetup Policy published
- [ ] Community Guidelines published
- [ ] Report and abuse process live
- [ ] Grievance process live
- [ ] Cookie and Analytics Notice matches actual trackers
- [ ] Account deletion process works
- [ ] Security disclosure channel works
- [ ] security.txt updated with real contact

## Technical Controls

- [ ] No plaintext OTP, PIN or password storage
- [ ] Admin secrets are held as secrets, not in source code
- [ ] Server-side authorisation tested
- [ ] Rate limits tested
- [ ] Location precision and minimisation tested
- [ ] Logs do not unnecessarily expose sensitive data
- [ ] Backups and recovery tested
- [ ] Abuse, report and block flows tested
- [ ] Production security headers tested
- [ ] Dependency and security scan completed

## Regulatory Operations

- [ ] CERT-In point of contact assessed or designated where required
- [ ] Incident reporting process tested
- [ ] Retention schedule approved
- [ ] Vendor and processor inventory completed
- [ ] Lawful-request process assigned to an owner
- [ ] Data-subject request process tested
- [ ] Consumer and e-commerce applicability assessed
- [ ] Financial-regulatory boundary assessed and documented

## Product Boundary

- [ ] Near Cash does not custody funds
- [ ] Near Cash does not settle or transfer participant funds
- [ ] No claims of RBI approval or financial licence
- [ ] Any new money-handling feature triggers legal re-review

## Additional Hard Launch Gates

- [ ] Production authentication cannot operate in development or test OTP mode.
- [ ] Exact location is never rendered to another user.
- [ ] Location deletion works and is tested.
- [ ] Reports, blocks and enforcement actions are operational.
- [ ] Privacy, Terms, Acceptable Use and Safety pages are reachable from the app.
- [ ] Vendor inventory matches actual production providers.
- [ ] Incident-response contact and evidence process are tested.
- [ ] No claim of legal certification or compliance is used in marketing.
- [ ] Any material legal uncertainty is escalated for Indian counsel review before launch.
