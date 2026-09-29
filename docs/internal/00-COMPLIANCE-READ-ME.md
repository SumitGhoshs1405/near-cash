# Near Cash — Internal Compliance Documentation Pack

Status: PRE-LAUNCH CONTROL DOCUMENTS  
Jurisdiction focus: India  
Version: 1.1  
Owner: Near Cash (individual operator: Sumit Ghosh)  

## Purpose

This pack operationalises the public policies. It is not a legal opinion and must be reviewed against the final entity, product, vendors, data flows and applicable law.

## Core Rule

Near Cash must remain non-custodial unless the business first obtains a fresh legal and regulatory assessment before introducing any feature that holds, routes, settles, converts or otherwise processes participant funds.

## Documents

- 01-data-inventory-and-record-of-processing.md
- 02-data-retention-schedule.md
- 03-incident-response-plan.md
- 04-abuse-and-moderation-sop.md
- 05-lawful-requests-procedure.md
- 06-admin-access-control-policy.md
- 07-vendor-and-processor-due-diligence.md
- 08-business-continuity-and-recovery.md
- 09-legal-compliance-matrix.md
- 10-launch-gate-checklist.md
- 11-policy-change-log.md
- 12-current-operator-profile.md
- 13-legal-sources-and-review-basis.md

## Mandatory Owner Fields Before Launch

The following must be completed before launch: legal entity name; registered address; privacy and grievance contact; security contact; CERT-In point of contact, where required; data-protection role and contact, where required; hosting, SMS, analytics and map vendors; retention periods; applicable age threshold; governing law and jurisdiction; and escalation contacts.

## Prohibited Shortcut

The product must not be described as "legally compliant", "regulator approved", "RBI approved", "AML cleared" or "lawyer approved" unless the relevant fact is actually documented.

## Risk-Reduction Standard

Every control must be implemented, testable, owned and reviewable. A policy statement without a corresponding product or operational control is not treated as a completed control. Near Cash must not be described as legally certified, risk-free, or compliant with every law.

## Mandatory Risk Gates

1. No custody, transfer, settlement or processing of participant funds without a fresh regulatory assessment.
2. No launch with DEV_OTP or test credentials enabled.
3. No analytics payload containing OTPs, session tokens, phone numbers, message bodies or precise coordinates.
4. No public display of precise user coordinates or home addresses.
5. Every report must be attributable to an account and reviewable by an authorised operator.
6. Serious safety, fraud or security events require preservation and escalation in accordance with the incident and lawful-request procedures.
7. Every new vendor must pass the vendor and data-flow review before production use.
8. Every material product change requires a privacy, safety and regulatory-impact review.
