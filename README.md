# Biios Project Manager

The internal project manager of Biios Automation Labs: Finance, Inventory and Tasks, connected end to end.
Stock assigned to a project lands in that project's budget, its expenses, the finance dashboard and the GST and CA
reports without anyone entering it twice. Salaries and bills post themselves on schedule.

Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, shadcn/ui, MongoDB + Mongoose, Better Auth,
React Hook Form + Zod, TanStack Table and Motion, in the Biios Automation Labs brand (brand guide, logo system approved
26 October 2026). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the structure and the conventions a new module
(HR, CRM, Payroll …) should follow, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for running it in production, including step-by-step Vercel deployment.

## Modules

- **Finance**: dashboard, expenses (GST section, receipt OCR), recurring expenses (salaries, rent, bills,
  subscriptions), income, projects (overview, budget with stage-wise spending, expenses, inventory used, team,
  timeline, documents), employees, reports (Finance, Expense, Income, GST, Project, Inventory, CA as PDF, Excel, CSV).
- **Inventory**: dashboard, all inventory with green / yellow / red stock status, categories, purchase stock, assign to
  project, return from project, stock movement history, low stock, reports.
- **Tasks**: dashboard, all / my tasks, status views, table, Kanban and calendar views, comments and attachments.

## How the modules connect

| Action | What updates automatically |
| --- | --- |
| Purchase stock | Available and total quantity, weighted average cost, stock movement, GST input credit (purchase invoice) |
| Assign to project | Available ↓, allocated ↑, project expense (category Inventory, chosen stage), project budget, dashboards, reports, movement history, low-stock alert |
| Return from project | Available ↑, allocated ↓, the project's inventory expense reduced (latest assignment first), movement history |
| Recurring schedule due | An expense posted on its date (exactly once, missed dates caught up), linked to the schedule, and to the employee for salaries |
| Employee added to a project | The project's Team tab and the employee's project list |

Accounting choice: stock purchases are inventory (an asset) and become a project expense when assigned, at weighted
average cost. GST input credit comes from purchase invoices and GST on other expenses, so nothing is counted twice.

## Run it locally

Requirements: Node 20.9+ (24 recommended) and MongoDB 7+ (Atlas or self-hosted; a replica set enables multi-document
transactions, a standalone server works too).

```bash
cp .env.example .env.local      # MONGODB_URI, BETTER_AUTH_SECRET (openssl rand -base64 32), BETTER_AUTH_URL
npm install
npm run db:setup                # creates every collection and index (the server also does this at start)
npm run seed                    # optional demo data; --reset to start over
npm run dev
```

The app opens in the light theme; people can switch to dark from the header or their user menu, where they can also
change their password. Without seed data, open `/sign-up` to create the first account; it becomes the admin. After that, sign-up is closed and
admins add people from **Team members** (user menu), unless `ALLOW_OPEN_SIGNUP=true`.

Demo accounts created by the seed: `erp-bal@biios.in` (admin), and members `aarav@`, `priya@`, `rohan@`,
`sneha@biios.in`, all with the password `ERPbiios#2026` (or `SEED_PASSWORD`). Change these before real use.

## Signing in

Email and password, and optionally **Continue with Google** (set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#google-sign-in)). A Google sign-in links to an existing account with the same
email; people new to the app get an account only with a company email (`GOOGLE_ALLOWED_DOMAINS`, default `biios.in`).
Everything except sign-in, sign-up, the health check and the cron endpoint requires a session. The profile menu in the
top-right corner shows the picture, name and email, and has Team members, Change password and Log out.

## Roles

Admins can do everything. Members work with records day to day but cannot delete expenses, income, projects or
categories, manage recurring schedules, see salaries or add team members. The server enforces this; the interface
hides what a member cannot do.

## Review server

`.claude/devservers.json` declares `db` (MongoDB 8 in Docker, data in a named volume) and `web` (production build in
`.next-review`, so local builds never touch it). With `SEED_DEMO=1` (set in the manifest) the first start loads the
demo data and accounts above; that instance is a demo. For real use, remove `SEED_DEMO`, reset the `db` volume and
create the admin account at `/sign-up`. Start them from the portal's **Dev servers** tab.

## Receipts and OCR

Upload an image (PNG, JPEG, WebP) or a PDF on the expense form. Digital PDFs are read from their text layer; images and
scanned PDFs go through Tesseract (English model bundled, no external calls). The GST parser extracts vendor, address,
GSTIN (check digit validated), invoice number and date, taxable amount, CGST, SGST, IGST, CESS, HSN/SAC, total and
payment method, each with a confidence score. Fields under 75% confidence are highlighted for review. Large phone
photos are shrunk in the browser before upload. Files are stored in Cloudinary (`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, as private assets),
an S3-compatible bucket (`S3_BUCKET`), or on local disk under `STORAGE_DIR` (default `./storage`), and are served only
to signed-in users.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | development server |
| `npm run build` / `npm start` | production build and server |
| `npm run db:setup` | check the MongoDB connection and create all collections and indexes |
| `npm run seed` | demo data through the real ledger and scheduler (`-- --reset` to start over) |
| `npm run typecheck` | TypeScript (run `npx next typegen` first after adding routes) |
| `npm run lint` | ESLint |
