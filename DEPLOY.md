# Getting a URL for the app

## Recommended — Render (free) + Supabase (free)
The data (database and uploaded files) lives in Supabase, so the free Render plan keeps everything across restarts.
Step-by-step guide (Arabic + English): **[docs/SUPABASE.md](docs/SUPABASE.md)**.

1. Create a Supabase project and copy three values: `DATABASE_URL` (Connect → *Session pooler*), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
2. On Render choose **New + → Blueprint**, select this repository (`render.yaml`), enter those three values and `ADMIN_PASSWORD`, and deploy.
3. Log in as admin, create the supervisor accounts under **Users**, then add your students' University IDs under **Approved IDs** (choose their courses).
   Students register themselves with their ID, you approve them under **Registrations**, and their first password is their University ID (they must change it at first login).

## Other hosts
The repo includes a `Dockerfile`; any host that runs Docker/Node works (Railway, Fly.io...). Environment variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase (or any PostgreSQL) connection string |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase Storage for uploaded files |
| `NODE_ENV` | `production` (already set in the Dockerfile) — no demo accounts |
| `ADMIN_PASSWORD` | your admin password (8+ chars) — **required on first start** |
| `ADMIN_EMAIL` | optional, default `admin@example.com` |
| `TRUST_PROXY` | `1` (already set in the Dockerfile) |

Without `DATABASE_URL` / `SUPABASE_URL` the app stores everything under `/data` (embedded database + files), which then needs a persistent disk.
The login rate limit is per process, so run a single instance.

## Temporary URL for a demo (from your own computer)
The app runs on your computer; a tunnel gives it a public https link that works only while both are running.

```bash
npm start                                   # terminal 1
npx cloudflared tunnel --url http://localhost:3000   # terminal 2 -> prints https://something.trycloudflare.com
```
(or `ngrok http 3000`). Without a `.env` file the demo accounts work (`doctor@example.com / doctor123`); stop the tunnel when finished.
