# External Services & Integrations

> This file is loaded on-demand. Referenced from CLAUDE.md.
> Each section is added by the setup wizard when a service is configured.

## API Cost Accounting (REQUIRED)

**Every feature that makes external API calls MUST log usage for cost tracking.**

When building or modifying any feature that calls a paid API, instrument it to log each API call with its cost data.

## Configured Services

<!-- Services are added below by the setup wizard -->

### Email (Resend)
- API key stored as Supabase secret: `RESEND_API_KEY`
- Free tier: 3,000 emails/month

### SMS (Telnyx)
- Config in `telnyx_config` table
- Edge functions: `send-sms`, `telnyx-webhook` (deploy with `--no-verify-jwt`)
- Cost: ~$0.004/message

### Payments (Square)
- Config in `square_config` table
- Edge function: `process-square-payment`
- Cost: 2.9% + 30c

### Payments + ACH (Stripe)
- Config in `stripe_config` table
- ACH: 0.8% capped at $5; Cards: 2.9% + 30c

### E-Signatures (SignWell)
- Config in `signwell_config` table
- Edge function: `signwell-webhook` (deploy with `--no-verify-jwt`)
- Free tier: 3-25 docs/month

### AI Features (Google Gemini)
- Free tier: 1,000 requests/day, 15 RPM

### Object Storage (Cloudflare R2)
- Free tier: 10 GB storage, 10M reads/mo, 1M writes/mo, zero egress

<!-- Only the services you selected during setup will be active -->
