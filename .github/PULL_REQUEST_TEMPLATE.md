#### Description

#### Screenshot (if UI-related)

#### Checklist

**Runs automatically on `git commit`** (via husky pre-commit hook):

- [ ] Formatting (`yarn format`)
- [ ] Linting (`yarn lint`)
- [ ] Type checking (`yarn typecheck`)

> If you bypassed husky (`--no-verify` or `HUSKY=0`), run these manually before submitting.

**Manual checks:**

- [ ] Build succeeds (`yarn build`)
- [ ] Translation keys extracted (`yarn i18n:extract`) - if new user-facing strings added
- [ ] Database migration included - if schema changes required

#### Issues Fixed or Closed

- Fixes #XXXX
