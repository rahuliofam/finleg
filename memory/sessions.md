## 2026-03-14: FinLeg infrastructure setup
- Set up full AlpacApps infra: GitHub Pages, Supabase (4 tables + RLS), Resend email (edge function deployed), Gemini 2.5 Flash, Cloudflare D1 (session archives), Cloudflare R2 (object storage)
- All credentials stored in local.env + docs/CREDENTIALS.md (both gitignored)
- Pending: R2 S3 API tokens for upload from edge functions
