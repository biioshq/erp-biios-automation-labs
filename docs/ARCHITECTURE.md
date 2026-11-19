# Biios Project Manager architecture

Next.js 16 (App Router, Turbopack, React 19), TypeScript, Tailwind CSS v4, shadcn/ui (Radix base,
`radix-nova`), MongoDB with Mongoose 9, Better Auth, React Hook Form + Zod 4, TanStack Table v8,
Motion (Framer Motion), Recharts via shadcn charts.

## Folder layout

```
src/
  app/
    (auth)/            sign-in, sign-up (public)
    (app)/             everything behind auth; layout = sidebar + header
      finance/...      finance module routes
      inventory/...    inventory module routes
      tasks/...        tasks module routes
      settings/team    team members (admin creates accounts)
    api/
      auth/[...all]    Better Auth
      files            upload (POST) and serve (GET /api/files/[id], ?download=1)
      ocr              receipt upload + OCR (POST)
      reports/[type]   report downloads (?format=pdf|xlsx|csv + filters)
  components/
    ui/                shadcn primitives (generated; don't hand-edit except theme tweaks)
    layout/            sidebar, header, breadcrumbs, command palette, user menu
    shared/            Page, PageHeader, Section, StatCard, StatusBadge (+ stock/project/task badges),
                       StockLevelBar, Money, EmptyState, ErrorState, ConfirmDialog, FormSheet
    forms/fields.tsx   RHF fields: Text, Textarea, Number (currency), Select, Date, Combobox, FormSection
    data-table/        DataTable (server + client modes), column header, filters, skeletons
    brand/             Biios logo + mark
  config/
    navigation.ts      MODULES (sidebar, breadcrumbs, command palette) + QUICK_ACTIONS
    company.ts         company GST state code, GST rates
  features/<module>/<feature>/
    schemas.ts         Zod schemas (client-safe; shared by form and action)
    types.ts           DTOs that cross to Client Components
    queries.ts         server-only reads (import "server-only")
    actions.ts         "use server" mutations via defineAction
    components/        client/server components for the feature
  lib/                 client-safe helpers: constants (enums), format (INR, IST dates), dates (IST day
                       boundaries), stock-status, gst, zod building blocks, list-params, action-result, ocr types
  server/
    db.ts              connectDB(), runAtomic() (transaction or compensating rollback)
    models/            every Mongoose model (import from "@/server/models")
    services/          domain services: inventory-ledger, metrics, numbering, notifications, users, recurring
    env.ts             environment contract, checked at boot
    setup-db.ts        creates every collection and index (boot and npm run db:setup)
    scheduler.ts       posts due recurring expenses every 30 minutes
    rate-limit.ts      per-user limits for uploads and OCR
    auth/              Better Auth instance + session helpers (requireUser / assertUser / assertAdmin)
    action.ts          defineAction(): session + Zod + DB + error mapping + revalidation
    lookups.ts         option lists (projects, vendors, items, categories)
    storage.ts         local file storage (swap for S3/R2 later)
    ocr/               Tesseract + PDF text extraction, GST invoice parser
```

A new module (HR, CRM, Payroll …) is: models in `server/models`, a `features/<module>` folder, routes
under `app/(app)/<module>`, and one entry in `config/navigation.ts`.

## Data rules

- Money is rupees as numbers, rounded to paise on write (`round2`). Display with `Money` / `formatCurrency`
  (`en-IN`, lakh grouping).
- Business dates are IST calendar days. Forms use `"yyyy-mm-dd"` strings; convert with `fromDateInput()` on
  the server and `toDateInput()` for form defaults. Filters use `dateRangeFilter(from, to)`.
- One source of truth: project spend = sum of its expenses; budget remaining = budget − spend; inventory value =
  available × weighted average cost. Use `src/server/services/metrics.ts`; never store these twice.
- Stock levels change only through `src/server/services/inventory-ledger.ts`:
  `purchaseStock`, `assignToProject`, `returnFromProject`, `adjustStock`, `recordOpeningStock`.
  Assignment creates the project expense (category `inventory`, payment `stock`, source
  `inventory_assignment`) and an allocation; returns reduce them (latest first). Generated expenses are read-only
  in Finance.
- Stock status comes from `getStockStatus(available, minStock)` in `lib/stock-status.ts` only.
- GST input credit = GST on expenses + GST on stock purchase invoices (`inventoryMovements.invoice`).
  Assignment expenses carry no GST (it was claimed on the purchase).
- Mongoose 9 filter types are strict: build query filters as `Record<string, unknown>` and cast to
  `QueryFilter<Doc>` (see `features/finance/expenses/queries.ts`).

- Recurring expenses: `recurringExpenses` holds schedules; `src/server/services/recurring.ts` claims each due date
  with a conditional update of `nextRunDate` and posts an expense with the unique `occurrenceKey`
  `<schedule>:<yyyy-mm-dd>`, so a date is posted exactly once and missed dates are caught up. Salaries are schedules
  linked to an employee. Date maths lives in `src/lib/recurrence.ts` (client-safe, used for previews).
- People: `employees` are staff records (optionally linked to a sign-in `user`); `projectMembers` says who works on
  which project (role, allocation, start, end). Salaries are visible to admins only.

## Roles

`admin` and `member`. `defineAction(..., { role: "admin" })` rejects members on the server; Client Components hide
those controls with `useIsAdmin()` from `src/components/current-user.tsx`. Admin-only today: deleting expenses,
income, projects and categories; managing recurring schedules and salaries; adding team members.

## Brand

From the brand guide (logo system approved 26 October 2026, palette Night and day): evening navy #0B1929, slate
#1C3450, lamp white #F4EDE3, plaster #B5ADA3, Biios orange #FF8800. Light mode is lamp white with navy ink; dark mode is
navy with lamp white. The sidebar is navy in both. Orange is never text on lamp white: use `text-brand-ink`
(slate in light, orange in dark) for brand-coloured text and `bg-brand` for fills. Satoshi in 400/500/600. Logos come
from `public/brand` through `src/components/brand/logo.tsx` at or above their minimum sizes, never recoloured, with
nothing attached; "Project Manager" is shown apart from the logo.

## Server / client conventions

- Pages are Server Components: `await searchParams` (a Promise), parse with `parseListParams`, fetch with
  `Promise.all`, render a client "view" component with plain DTOs (ids and dates as strings).
- Every route segment with data has a `loading.tsx` (skeletons from `components/data-table`). `(app)/error.tsx`
  catches errors.
- Mutations are server actions created with `defineAction(schema, handler, { revalidate, message })`. They
  return `ActionResult`; the client shows `toast`, maps `fieldErrors` with `applyFieldErrors`, and calls
  `emitDataChanged()` (refreshes the notification bell). Revalidate the module layout, e.g.
  `[["/finance", "layout"]]`, plus other modules the change touches.
- Create/edit/view panels are `FormSheet` drawers driven by the URL: `?new=1`, `?view=<id>`, `?edit=<id>`.
  The command palette and cross-module links rely on this.
- Lists that grow use `<DataTable mode="server">` with URL state (`q`, `page`, `size`, `sort=id.desc`,
  filter keys, `from`, `to`); column ids must match the server's sort keys.
- Optimistic updates with `useOptimistic` for deletes and status changes.
- Badges: `StatusBadge` tones (`success` green, `warning` yellow, `danger` red, `info`, `brand`, `violet`,
  `neutral`). Inventory health always uses `StockStatusBadge` + `StockLevelBar`.

## Reference implementation

`features/finance/expenses` + `app/(app)/finance/expenses` is the pattern to copy: schemas, queries, actions,
table view with drawers, form with sections, detail view, receipt upload + OCR.

## Auth

- Google: `src/server/auth/google.ts` (enabled flag, allowed domains) and `user.validateUserInfo` in
  `src/server/auth/auth.ts` gate who may get a new account through Google; `account.accountLinking` with Google as a
  trusted provider links Google to existing accounts, which are created verified (admin-created or first admin).
  OAuth failures return to `/sign-in?error=<code>`, shown through `src/lib/auth-errors.ts`.

- Better Auth, email + password, MongoDB adapter. The first account becomes `admin`; after that only an admin
  creates accounts (Team members) unless `ALLOW_OPEN_SIGNUP=true`.
- `src/proxy.ts` redirects requests without a session cookie; every layout, action and route handler validates
  the session on the server (`requireUser`, `assertUser`, `assertAdmin`).

## Files and OCR

- Uploads go to `/api/files` (or `/api/ocr` for receipts) and are stored under `STORAGE_DIR` (default
  `./storage`, gitignored) with metadata in the `files` collection. They are served only to signed-in users.
- OCR: images through Tesseract (bundled English model, one worker per process); PDFs through their text layer,
  or rendered and OCR'd when scanned. `server/ocr/parse-invoice.ts` extracts GST fields with per-field
  confidence; GSTIN check digits and the taxable + tax = total identity raise confidence.
