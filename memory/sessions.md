## 2026-03-24: Fix Sign In buttons to trigger Google OAuth directly
- Changed home page "Sign in with Google" button and navbar "Sign In" button from `<Link href="/signin">` to `<button onClick={signInWithGoogle}>` so they trigger Google OAuth directly instead of navigating to the `/signin` page first.
- Files modified: `src/app/page.tsx`, `src/components/navbar.tsx`
