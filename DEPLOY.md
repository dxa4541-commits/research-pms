# Getting a URL for the app

## Option A — temporary URL for a demo (free, 2 minutes, from your own computer)
The app runs on your computer; a tunnel gives it a public https link. The link works only while your computer
and the app are running, and it changes each time.

```bash
npm start                                   # terminal 1
npx cloudflared tunnel --url http://localhost:3000   # terminal 2 -> prints https://something.trycloudflare.com
```
(or `ngrok http 3000`). Send that link to the doctor. Demo accounts work, so give the doctor `doctor@example.com / doctor123`.
Stop the tunnel when finished: anyone with the link can log in with the demo passwords.

## Option B — permanent URL (hosting)
The repo includes a `Dockerfile`; any host that runs Docker/Node works (Render, Railway, Fly.io...).
Requirements:
1. **A persistent disk/volume mounted at `/data`** — the database and uploaded files live there. Without it,
   everything is erased on every restart/redeploy (free tiers without a disk are for demos only).
2. Environment variables (production mode removes the demo accounts):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` (already set in the Dockerfile) |
| `ADMIN_PASSWORD` | your admin password (8+ chars) — **required on first start** |
| `ADMIN_EMAIL` | optional, default `admin@example.com` |
| `TRUST_PROXY` | `1` (already set in the Dockerfile) |

3. After first login as admin: create the supervisor and student accounts from the **Users** tab.

Run a single instance (the SQLite database and login rate limit are per-process).
