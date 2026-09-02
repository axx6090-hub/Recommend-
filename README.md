# Zernio Webhook — Cloudflare Worker

Cloudflare Worker for handling Zernio `comment.received` webhooks.

## What it does

When Zernio sends a `comment.received` event:

1. Verifies the webhook signature when `ZERNIO_WEBHOOK_SECRET` is configured.
2. Checks whether the comment exactly matches `KEYWORD` (default: `Ai`, case-insensitive).
3. Sends one random public reply to the comment.
4. Attempts a private reply through Zernio.
5. Returns `202 Accepted` quickly and continues processing with Cloudflare `waitUntil()`.

## Endpoints

Health check:

`GET https://YOUR-WORKER.workers.dev/`

Zernio webhook:

`POST https://YOUR-WORKER.workers.dev/webhooks/zernio`

## Cloudflare deployment

### Option 1 — Cloudflare Dashboard + GitHub

1. Open Cloudflare Dashboard.
2. Go to **Workers & Pages**.
3. Choose **Create** / **Import a repository**.
4. Select `axx6090-hub/Recommend-`.
5. Use the repository root as the project directory.
6. Deploy the Worker.
7. In **Settings → Variables and Secrets**, add these as encrypted secrets:
   - `ZERNIO_API_KEY`
   - `ZERNIO_WEBHOOK_SECRET`
8. `KEYWORD`, `DM_MESSAGE`, and `PUBLIC_REPLIES` already have defaults in `wrangler.toml` and can be changed there or in Cloudflare variables.
9. Copy the resulting `workers.dev` URL and append `/webhooks/zernio` for Zernio.

### Option 2 — Wrangler CLI

```bash
npm install
npx wrangler login
npx wrangler secret put ZERNIO_API_KEY
npx wrangler secret put ZERNIO_WEBHOOK_SECRET
npm run deploy
```

## Zernio webhook setup

Configure Zernio with:

- Event: `comment.received`
- URL: `https://YOUR-WORKER.workers.dev/webhooks/zernio`
- Secret: exactly the same value stored in Cloudflare as `ZERNIO_WEBHOOK_SECRET`

## Local development

Create a `.dev.vars` file locally:

```env
ZERNIO_API_KEY=your_zernio_api_key
ZERNIO_WEBHOOK_SECRET=your_webhook_secret
```

Then run:

```bash
npm install
npm run dev
```

## Important

Never commit the real Zernio API key or webhook secret to GitHub. Keep both as Cloudflare encrypted secrets.

Meta/Zernio may still enforce platform limits on private replies. A new comment can trigger the Worker again, but the same exact comment may not be eligible for repeated private replies.
