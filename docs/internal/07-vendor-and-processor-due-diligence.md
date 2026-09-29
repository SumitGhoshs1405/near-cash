# Vendor & Processor Due Diligence

Before enabling any vendor that receives personal data, the following must be recorded:

- legal name and service;
- categories of data shared;
- processing purpose;
- hosting and data locations;
- security controls;
- breach-notification commitments;
- subcontractors and sub-processors;
- retention and deletion controls;
- access controls;
- contract and data processing agreement (DPA) terms, where appropriate;
- cross-border transfer implications; and
- exit and deletion procedure.

## Current Deployment Categories

The following categories were identified from the code and configuration: Cloudflare Workers, D1 and infrastructure, together with other Cloudflare services; Near Cash administrative analytics; and a conditional Twilio SMS and OTP integration, which applies when the relevant production secrets are configured. No advertising provider is intentionally used. The integrations actually enabled in production must be verified, and the applicable contractual and privacy terms recorded, before launch.

## Risk-Reduction Requirements

Before enabling a provider, document what data leaves Near Cash, why it leaves, where it is processed, the security controls, the contractual terms, the retention and deletion options, and the incident-notification arrangements. The service must not be described as having "no third-party processors" where a production provider technically processes personal data.
