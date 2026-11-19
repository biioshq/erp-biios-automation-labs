# Deploying Biios Project Manager

## What it needs

| Piece | Notes |
| --- | --- |
| Node.js 20.9+ (24 LTS recommended) | Or the Docker image below. |
| MongoDB 7+ | MongoDB Atlas (M10 or larger for production) or a self-hosted replica set. A replica set turns on multi-document transactions for the inventory ledger; a standalone server also works, with compensating rollbacks. |
| File storage | Cloudinary (`CLOUDINARY_URL`, recommended, required on Vercel), an S3-compatible bucket (`S3_BUCKET`), or a persistent disk (`STORAGE_DIR`). Back it up with the database. |
| HTTPS | Put the app behind a TLS-terminating proxy or platform. Set `BETTER_AUTH_URL` to the public `https://` URL; cookies become secure automatically. |

## Deploy to Vercel (step by step)

Vercel runs the app as serverless functions with no permanent disk, so receipts and documents go to Cloudinary and
the recurring expenses are posted by Vercel Cron. Both are already set up in the code (`vercel.json`); you only connect
the accounts.

You need: a GitHub account with access to the company's repositories, a Vercel team on the **Pro** plan (Vercel's
Hobby plan is for personal, non-commercial use), a MongoDB Atlas account, a Cloudinary account, and Node.js 24 plus
git on your computer.

### 1. Put the code on GitHub

1. On GitHub, create a **private** repository, for example `biios-project-manager`, in the company organisation.
2. In the project folder on your computer:
   ```bash
   git add -A
   git commit -m "Biios Project Manager"
   git remote add origin https://github.com/<organisation>/biios-project-manager.git
   git push -u origin main
   ```
   `.env.local`, `storage/` and build folders are ignored, so no secrets or uploaded files are pushed.

### 2. Create the database on MongoDB Atlas

1. In Atlas, create a cluster. For real use pick **M10** or larger (backups included); the free **M0** is fine for a
   trial. Provider **AWS**, region **Mumbai (ap-south-1)**, next to the app's Vercel region (`bom1` in `vercel.json`).
2. **Database Access** > Add New Database User: password authentication, role **Read and write to any database**.
   Save the username and password.
3. **Network Access** > Add IP Address > **Allow access from anywhere** (`0.0.0.0/0`). Vercel functions have no fixed
   IP addresses; the database user's password protects access. (Atlas' Vercel integration can do this step for you.)
4. **Connect** > Drivers: copy the connection string, put in the password, and add the database name `biios_pm` before
   the `?`:
   ```
   mongodb+srv://<user>:<password>@<cluster>.mongodb.net/biios_pm?retryWrites=true&w=majority
   ```
   If the password has symbols such as `@ : / # %`, URL-encode them (for example `#` becomes `%23`).

### 3. Prepare the database (once, from your computer)

```bash
npm ci
# .env.local with: MONGODB_URI=<the Atlas string>, BETTER_AUTH_SECRET=<anything for local use>
npm run db:setup
```

It should print `transactions on` and `Ready: 15 app collections, 59 indexes`. Then choose one:

- **Start empty (real use):** do nothing more. After deploying, open `/sign-up` once; that first account becomes the
  admin and sign-up closes.
- **Demo data:** `npm run seed`. It creates the admin `erp-bal@biios.in` with the password `ERPbiios#2026`, plus demo
  projects, stock, employees, salaries and tasks. Change that password after the first sign-in.

### 4. Set up Cloudinary for receipts and documents

1. Sign in to Cloudinary. Go to **Settings > API Keys** and copy the **API environment variable**; it looks like
   `cloudinary://<api_key>:<api_secret>@<cloud_name>`.
2. Go to **Settings > Security** and turn on **Allow delivery of PDF and ZIP files** (new accounts have it off). PDFs
   still work without it, but they load faster with it on.
3. Nothing else to create: files are uploaded to the folder `biios-pm` as private (authenticated) assets that only the
   app can read, and it shows them only to signed-in people.

### 5. Create the project on Vercel

1. On vercel.com: **Add New > Project**, pick the GitHub repository, **Import**.
2. Framework Preset **Next.js** (detected). Leave Root Directory, Build Command and Output Directory as they are.
   Node.js 24 is picked up from `package.json`.
3. Open **Environment Variables** and add these (tick **Production** and **Preview**):

   | Name | Value |
   | --- | --- |
   | `MONGODB_URI` | the Atlas string from step 2 |
   | `BETTER_AUTH_SECRET` | a new random secret: `openssl rand -base64 32` |
   | `CLOUDINARY_URL` | from step 4 |
   | `CRON_SECRET` | a new random secret: `openssl rand -hex 24` |
   | `ALLOW_OPEN_SIGNUP` | `false` |
   | `NEXT_PUBLIC_COMPANY_STATE_CODE` | `27` (Maharashtra; decides CGST+SGST vs IGST) |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional, for "Continue with Google" (see [Google sign-in](#google-sign-in)) |

   `BETTER_AUTH_URL` can stay empty for now: on Vercel the app uses the project's production address. Set it when you
   add your own domain (step 8).
4. Click **Deploy** and wait for the build (about 2 to 3 minutes).

### 6. Check the deployment

1. Open `https://<your-project>.vercel.app/api/health`. You should see
   `{"status":"ok","db":"up","storage":"cloudinary",...}`.
   - `"db":"down"`: check `MONGODB_URI` and Atlas Network Access.
   - `"storage":"local"`: `CLOUDINARY_URL` is missing.
2. Open the app and sign in (demo: `erp-bal@biios.in` / `ERPbiios#2026`), or go to `/sign-up` to create the admin.
3. Change the admin password: user menu at the bottom of the sidebar > **Change password**.
4. Add an expense with a receipt photo to confirm uploads and OCR.
5. Add the team from user menu > **Team members**.

Changing an environment variable later needs a new deployment: **Deployments > ... > Redeploy**.

### 7. Recurring expenses (Vercel Cron)

`vercel.json` registers a daily job at 00:30 UTC (06:00 IST) that calls `/api/cron/recurring`. Vercel sends
`CRON_SECRET` with it, and the endpoint refuses calls without it. Salaries and bills due that day are posted once.
See it under **Settings > Cron Jobs**, where **Run** triggers it by hand. On Pro you can run it more often by changing
the schedule in `vercel.json`, for example `"0 * * * *"` for hourly.

### 8. Your own domain (optional)

1. **Settings > Domains > Add**, for example `pm.biios.in`.
2. Add the DNS record Vercel shows at your DNS provider (usually a `CNAME` from `pm` to `cname.vercel-dns.com`) and
   wait for **Valid Configuration**.
3. Set `BETTER_AUTH_URL` to `https://pm.biios.in` in Environment Variables and redeploy. Sign in on that address.

### 9. Updates and previews

- Every push to `main` deploys to production. Pushes to other branches create preview deployments, which can sign in
  automatically on their own URLs.
- Give previews their own data so tests never touch real records: in Environment Variables, give the **Preview**
  environment its own `MONGODB_URI` pointing at a second database (for example `.../biios_pm_preview`, prepared with
  `npm run db:setup`) and add `CLOUDINARY_FOLDER=biios-pm-preview`.

### Limits on Vercel

- Uploads: up to 4 MB per file (Vercel caps requests at 4.5 MB). Phone photos are shrunk in the browser before upload,
  so this mostly matters for large PDFs.
- Reading a scanned PDF takes 3 to 6 seconds; functions are allowed up to 60 seconds.
- Upload and OCR rate limits are kept per function instance.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| Sign-in shows "Invalid origin" or nothing happens | `BETTER_AUTH_URL` does not match the address in the browser. Set it to the exact `https://` address and redeploy. For a second domain, add it to `TRUSTED_ORIGINS` (comma-separated). |
| "File storage is not set up on this deployment" | Add `CLOUDINARY_URL` and redeploy. |
| Pages show "The database is not reachable" | Atlas Network Access or `MONGODB_URI` (and URL-encode symbols in the password). |
| Recurring expenses did not post | `CRON_SECRET` missing, or check **Settings > Cron Jobs** and the function logs. |

## Google sign-in

"Continue with Google" appears on the sign-in page once `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.

**Who gets in**

- Someone whose email already has an account (added by an admin from Team members, or the first admin) can use
  Google straight away: Google is linked to their account, which keeps its role, history and password.
- Someone new gets an account (role Member) on their first Google sign-in only if their email is in an allowed
  company domain: `GOOGLE_ALLOWED_DOMAINS`, default `biios.in`. Anyone else sees "Use your company Google account"
  and needs an admin to add them first.
- Google accounts without a verified email are always refused.

**Create the Google OAuth client (once)**

1. Open [Google Cloud Console](https://console.cloud.google.com/), select or create a project (for example
   "Biios Project Manager").
2. **APIs & Services > OAuth consent screen** (Google Auth Platform > Branding): app name "Biios Project Manager",
   support email, logo optional. Audience: **Internal** if everyone uses Google Workspace at `biios.in` (only your
   organisation can sign in, and no Google review is needed); otherwise **External**, then **Publish app**.
   Scopes: `openid`, `email`, `profile` (the defaults).
3. **APIs & Services > Credentials > Create credentials > OAuth client ID**, type **Web application**.
4. **Authorized redirect URIs**: add one line for every address people sign in on:
   - `https://<your-project>.vercel.app/api/auth/callback/google`
   - `https://pm.biios.in/api/auth/callback/google` (your own domain, if any)
   - `http://localhost:3000/api/auth/callback/google` (local development)
   - the review server's public address plus `/api/auth/callback/google`
   **Authorized JavaScript origins** can stay empty.
5. Create, then copy the **Client ID** and **Client secret**.

**Turn it on**

- Vercel: Settings > Environment Variables: add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and, if your company
  domain is not `biios.in`, `GOOGLE_ALLOWED_DOMAINS`. Redeploy.
- Local or review server: put the same variables in `.env.local` (never commit it) and restart.

If Google shows **redirect_uri_mismatch**, the address in the browser is not in the list from step 4, or
`BETTER_AUTH_URL` does not match it. Preview deployments get new addresses each time, so sign in to previews with
email and password, or add a fixed branch domain to the list.

## Environment

Copy `.env.example`. Required: `MONGODB_URI`, `BETTER_AUTH_SECRET` (32+ characters, `openssl rand -base64 32`),
`BETTER_AUTH_URL`. The server checks these at start and refuses to boot with a clear message when one is missing or
malformed (`src/server/env.ts`).

## The database

1. Create a database user with `readWrite` on one database, for example `biios_pm`, and put its connection string in
   `MONGODB_URI` (for Atlas: `mongodb+srv://user:pass@cluster.mongodb.net/biios_pm?retryWrites=true&w=majority`).
2. Run `npm run db:setup`. It checks the connection, reports whether transactions are available, and creates all
   collections and indexes:
   `projects, expenses, income, inventory, inventoryCategories, inventoryMovements, inventoryAllocations, tasks,
   employees, projectMembers, recurringExpenses, files, notifications, reports, counters`, plus Better Auth's
   `user, session, account`. It never drops anything and is safe to run again. The server runs the same step at
   every start.
3. Open `/sign-up` once to create the first account, which becomes the admin. Sign-up then closes.

Backups: use Atlas continuous backup, or `mongodump --uri "$MONGODB_URI" --archive=biios-$(date +%F).gz --gzip`
nightly, together with a copy of `STORAGE_DIR`.

## Run with Docker (instead of Vercel)

```bash
docker build -t biios-pm .
docker run -d --name biios-pm -p 3000:3000 \
  --env-file .env.production \
  -v biios-pm-storage:/data/storage \
  biios-pm
```

The image is a standalone Next.js server running as a non-root user, with a health check on `/api/health`.

## Run on a Node host

```bash
npm ci
npm run build
npm run db:setup
NODE_ENV=production npm start -- -p 3000
```

## Recurring expenses

The server posts due salaries and bills every 30 minutes. Each schedule date is posted exactly once (a unique
occurrence key on the expense), even with several instances running. To drive it from an external scheduler instead
(for example a platform cron), set `RECURRING_SCHEDULER=off` and `CRON_SECRET`, then call:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://pm.example.com/api/cron/recurring
```

## Security in place

- Sessions: Better Auth, httpOnly cookies, 14-day sessions refreshed daily; sign-in limited to 6 attempts a minute and
  sign-up to 3 per IP in production. Changing a password signs out other devices.
- Google sign-in: new accounts only for allowed company domains, verified Google emails only, linking only to
  accounts that admins created.
- Accounts: first account is admin; after that only admins add people (unless `ALLOW_OPEN_SIGNUP=true`).
- Roles: deletes of financial records, recurring schedules, salaries and team management are admin-only, checked on the
  server in every action.
- Every page, action and route handler validates the session on the server; `src/proxy.ts` adds a fast redirect.
- Uploads: type allow-list with content sniffing, 15 MB cap, random storage names, served only to signed-in users
  through `/api/files/<id>`; uploads and OCR are rate limited per user.
- Headers: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
  a framing/object/base/form CSP, and HSTS in production. `X-Powered-By` is off.
- Health: `GET /api/health` returns `{status, db}` with 200 or 503.
