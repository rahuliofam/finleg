# Forms & Validation

> This file is loaded on-demand. Referenced from CLAUDE.md.

Finleg ships a small, dependency-free form stack instead of pulling in Formik /
react-hook-form / zod. Three files, ~350 lines total:

- `src/lib/validation.ts` — validators + `validate()` runner
- `src/lib/use-form.ts` — `useForm()` React hook
- `src/components/error-boundary.tsx` — class-based `<ErrorBoundary>` (wraps the intranet layout)

## When to use it

Use the hook for any form that:

- Submits data to Supabase or a Supabase edge function
- Has more than one validated field
- Needs to show inline error messages next to fields

For filter bars, toggles, and "click to save" UIs, plain `useState` is still fine.

## Adding a form

1. **Define a typed schema** alongside the component:

   ```ts
   import {
     email as emailRule,
     maxLength,
     required,
     type ValidationSchema,
   } from "@/lib/validation";

   interface ContactValues extends Record<string, unknown> {
     name: string;
     email: string;
     message: string;
   }

   const schema: ValidationSchema<ContactValues> = {
     name: [required("Please enter your name"), maxLength(120)],
     email: [required(), emailRule()],
     message: [required(), maxLength(5000)],
   };
   ```

2. **Wire the hook** with `initialValues`, the `schema`, and the `onSubmit` body
   (this is where Supabase calls live — the hook only validates):

   ```ts
   const form = useForm<ContactValues>({
     initialValues: { name: "", email: "", message: "" },
     schema,
     onSubmit: async (values) => {
       const { error } = await supabase.from("...").insert(values);
       if (error) {
         // Map server errors back to the field most likely at fault.
         form.setFieldError("email", error.message);
         return;
       }
       form.reset();
     },
   });
   ```

3. **Bind inputs** with `name=`, `value=`, `onChange`, and `onBlur`. Rendering
   errors only after a field is touched avoids "yelling at the user" before they
   type:

   ```tsx
   <input
     name="email"
     type="email"
     value={form.values.email}
     onChange={form.handleChange}
     onBlur={form.handleBlur}
     aria-invalid={form.touched.email && form.errors.email ? true : undefined}
     className={`rounded-lg border px-3 py-2 ${
       form.touched.email && form.errors.email ? "border-red-400" : "border-slate-300"
     }`}
   />
   {form.touched.email && form.errors.email && (
     <p className="mt-1 text-xs text-red-600">{form.errors.email}</p>
   )}
   ```

4. **Submit + disable during submission:**

   ```tsx
   <form onSubmit={form.handleSubmit} noValidate>
     …
     <button type="submit" disabled={form.submitting}>
       {form.submitting ? "Sending…" : "Send"}
     </button>
   </form>
   ```

## Built-in validators

| Validator | Signature | Notes |
|---|---|---|
| `required(msg?)` | `(value) => string \| null` | Rejects `null`/`undefined`/empty strings/empty arrays. |
| `email(msg?)` | same | RFC-ish regex. |
| `minLength(n, msg?)` / `maxLength(n, msg?)` | same | Strings. Skips check if value is empty (pair with `required`). |
| `pattern(regex, msg?)` | same | Custom regex. |
| `number(msg?)` | same | Accepts ints + decimals, positive or negative. |
| `currency(msg?)` | same | Accepts `$1,234.56`, `-10`, etc. |
| `date(msg?)` | same | Accepts anything `new Date()` can parse. |
| `url(msg?)` | same | Requires `http:`/`https:`. |

All validators skip empty values so `required()` stays the single source of truth
for "is this field mandatory?" — just list it first in the rules array.

## Custom validators

A validator is simply `(value: unknown, allValues?: Record<string, unknown>) => string | null`.
The second argument gives you cross-field access (e.g. "confirm password"):

```ts
const matchesPassword = (msg = "Passwords must match"): Validator =>
  (value, all) => (value === (all?.password ?? "") ? null : msg);

const schema: ValidationSchema<Values> = {
  password: [required(), minLength(8)],
  confirm: [required(), matchesPassword()],
};
```

## Server-side errors

Treat Supabase errors like validation errors — map them back to a field with
`setFieldError`, or call `setErrors({ ... })` for multiple at once. Never use
`alert()`; keep inline error text or the project's toast helper consistent with
the rest of the admin UI (see `CLAUDE.md`).

## Error boundary

`<ErrorBoundary>` wraps the intranet layout and shows a red fallback card with
"Try again" + "Reload page" actions. Add it around any other route that can
throw during render:

```tsx
<ErrorBoundary label="Reports">
  <ReportsTab />
</ErrorBoundary>
```

Pass `fallback={(error, reset) => …}` for a fully custom fallback.

## Reference implementations

- `src/app/contact/page.tsx` — static public form, all three validators used.
- `src/app/signin/page.tsx` — conditional form (toggle), server error handling.
- `src/components/intranet/admin/users-tab.tsx` — admin invite form using
  `setFieldError` to surface Supabase errors inline.
