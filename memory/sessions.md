## 2026-03-24: Add invitation email via Resend
- Created `supabase/functions/send-invitation-email/index.ts` edge function using Resend API, adapted from genalpaca-admin's staff_invitation template with Finleg branding
- Modified `src/components/intranet/admin/users-tab.tsx` to fire-and-forget call the edge function after successful DB insert
- Edge function needs deploy: `npx supabase functions deploy send-invitation-email --no-verify-jwt --project-ref gjdvzzxsrzuorguwkaih` (requires re-auth to rahchak@gmail.com Supabase account)

## 2026-03-24: Fix Sign In buttons to trigger Google OAuth directly
- Changed home page "Sign in with Google" button and navbar "Sign In" button from `<Link href="/signin">` to `<button onClick={signInWithGoogle}>` so they trigger Google OAuth directly instead of navigating to the `/signin` page first.
- Files modified: `src/app/page.tsx`, `src/components/navbar.tsx`
