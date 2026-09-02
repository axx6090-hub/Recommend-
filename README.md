# Zernio Webhook

Webhook service for Instagram comments through Zernio.

## What it does

When Zernio sends a `comment.received` event:

1. Verifies the webhook signature with `X-Zernio-Signature`.
2. Checks whether the comment text exactly matches `Ai` (case-insensitive).
3. Sends a random public reply to that specific comment.
4. Sends the comment author a private reply through Zernio's private-reply API.
5. Deduplicates repeated webhook deliveries by event ID.

## Important Meta/Zernio limit

This project bypasses **Zernio automation-level deduplication** because every new comment is handled by your webhook code.

However, Meta still allows only **one private reply per individual comment**, and the private reply must be sent within the allowed window. A repeat commenter can therefore trigger again when they make a **new comment**, but the same exact comment cannot receive multiple private replies.

## Environment variables

Copy `.env.example` values into your hosting provider:

- `ZERNIO_API_KEY`
- `ZERNIO_WEBHOOK_SECRET`
- `KEYWORD` (default `Ai`)
- `PUBLIC_REPLIES` separated by `|`
- `DM_MESSAGE`

Never commit your real API key.

## Endpoint

After deployment:

`POST https://YOUR-DOMAIN/webhooks/zernio`

Health check:

`GET https://YOUR-DOMAIN/`

## Zernio webhook setup

Create or update a Zernio webhook with:

- Event: `comment.received`
- URL: `https://YOUR-DOMAIN/webhooks/zernio`
- Secret: the same value as `ZERNIO_WEBHOOK_SECRET`

## Deploy on Render

1. Push this project to GitHub.
2. Render → New → Web Service.
3. Connect the repository.
4. Add the environment variables.
5. Deploy.
6. Copy the Render public URL into Zernio Webhooks.
7. Use Zernio's webhook test and then test with a real Instagram comment containing `Ai`.

## API endpoints used

Public reply:

`POST /v1/inbox/comments/{postId}`

Private reply:

`POST /v1/inbox/comments/{postId}/{commentId}/private-reply`
