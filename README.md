# Near Cash

Non-custodial cash-matching app on Cloudflare Workers + D1 + Durable Objects. Opens on the home screen with an automatic guest session; users can log in or sign up from **Profile**.

## Deploy
1. `npm install` and `npx wrangler login`
2. `npx wrangler d1 create near-cash-db` → put the ID in `wrangler.jsonc`
3. `npx wrangler d1 execute near-cash-db --remote --file=schema.sql`
4. Set secrets (`npx wrangler secret put <NAME>`): `SMS_WEBHOOK_URL`, `SMS_WEBHOOK_TOKEN` (or `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`), and `ADMIN_ANALYTICS_KEY`
5. `npx wrangler deploy`

## Config
- `REQUIRE_SIGNIN` (`wrangler.jsonc`): `"false"` lets the app start a guest session.
- `DEV_OTP`: if no SMS provider is configured, the sign-in code is shown on screen as "Verification Code" automatically. `DEV_OTP=true` forces it on; `DEV_OTP=false` forces it off. **Configure SMS before real launch** - on-screen codes let anyone sign in as any number.
- Google Maps: paste your key in `public/config.js`.

## Develop & test
`npx wrangler dev` · `npm run check`

Legal and policy documents are in `docs/` and `public/`.
