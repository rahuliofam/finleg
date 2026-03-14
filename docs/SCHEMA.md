# Database Schema Reference

> This file is loaded on-demand. Referenced from CLAUDE.md.
> Updated by the setup wizard and as tables are added/modified.

## Core Tables

<!-- The setup wizard populates this section based on your domain -->

```
(tables will be listed here after setup)
```

## Service Config Tables

These are created when optional services are enabled:

```
telnyx_config    - SMS configuration (single row, id=1)
resend_config    - Email configuration
square_config    - Payment processing configuration
signwell_config  - E-signature configuration
```

## Common Patterns

- All tables use UUID primary keys
- All tables have `created_at` and `updated_at` timestamps
- RLS is enabled on all tables
- `is_archived` flag for soft deletes (filter client-side)
