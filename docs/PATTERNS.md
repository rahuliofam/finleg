# Common Patterns & Conventions

> This file is loaded on-demand. Referenced from CLAUDE.md.

## Tailwind CSS Design Tokens

Use design tokens defined in `styles/tailwind.css` `@theme` block. Run `npm run css:build` after adding new classes.

Tailwind v4 uses CSS-first config — no `tailwind.config.js`. Tokens are defined in `@theme`:

```css
@theme {
  --color-brand-primary: #your-color;
  --color-brand-secondary: #your-color;
  /* add project-specific tokens here */
}
```

## Auth System (`shared/auth.js`)

Provides login/profile functionality on all pages:

- **Profile button**: Auto-inserts into nav bar. Shows person icon when logged out, initials avatar when logged in.
- **Login modal**: Email/password via `supabase.auth.signInWithPassword()`.
- **Dropdown menu**: When logged in, clicking avatar shows "Admin" link and "Sign Out".
- **Page guard**: Admin pages call `requireAuth(callback)` — redirects to `../index.html` if not authenticated.
- **Supabase client**: Exposed as `window.adminSupabase` for admin page data access.

**Script loading order on every page:**
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="shared/supabase.js"></script>
<script src="shared/auth.js"></script>
```

## Admin Pages (`admin/`)

- All admin pages are in `admin/` directory with `<meta name="robots" content="noindex, nofollow">`
- Each page loads `shared/admin.css` and calls `requireAuth()`:
```javascript
requireAuth(function(user, supabase) {
    // Page is authenticated — load data using supabase client
});
```
- CRUD pattern: `admin-table` for listing, `admin-modal` for add/edit forms
- CSS classes are themeable via CSS custom properties

## Conventions

1. Use toast notifications, not `alert()`
2. Filter archived items client-side: `.filter(s => !s.is_archived)`
3. Don't expose personal info in public views
4. Client-side image compression for files > 500KB
5. `openLightbox(url)` for image viewing
