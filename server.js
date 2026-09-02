const API_BASE = "https://zernio.com/api/v1";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function pick(obj, paths) {
  for (const path of paths) {
    let cur = obj;
    let ok = true;
    for (const key of path.split(".")) {
      if (cur == null || !(key in cur)) {
        ok = false;
        break;
      }
      cur = cur[key];
    }
    if (ok && cur !== undefined && cur !== null && cur !== "") return cur;
  }
}

function normalizeComment(payload) {
  return {
    eventId: pick(payload, ["id"]) || null,
    event: pick(payload, ["event"]) || null,
    text: String(
      pick(payload, [
        "comment.text",
        "comment.message",
        "data.comment.text",
        "data.comment.message",
      ]) || ""
    ),
    commentId: String(
      pick(payload, [
        "comment.id",
        "comment.commentId",
        "data.comment.id",
        "data.comment.commentId",
      ]) || ""
    ),
    postId: String(
      pick(payload, [
        "post.id",
        "post.postId",
        "comment.postId",
        "data.post.id",
        "data.comment.postId",
      ]) || ""
    ),
    accountId: String(
      pick(payload, [
        "account.accountId",
        "account.id",
        "comment.accountId",
        "data.account.accountId",
        "data.account.id",
      ]) || ""
    ),
  };
}

function matchesKeyword(text, env) {
  const keyword = String(env.KEYWORD || "Ai").trim().toLowerCase();
  return String(text).trim().toLowerCase() === keyword;
}

function publicReplies(env) {
  return String(
    env.PUBLIC_REPLIES ||
      "تابعني حتى اكدر ارسلك لان حسابك خاص💫|دزلي متابعه حتى اكدر ادزلك مجاني💙|تابعني حتى اكدر ارسلك♥️"
  )
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function randomPublicReply(env) {
  const replies = publicReplies(env);
  if (!replies.length) return "تابعني حتى اكدر ارسلك♥️";
  return replies[Math.floor(Math.random() * replies.length)];
}

function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function verifySignature(rawBody, signature, secret) {
  if (!secret) return true;
  if (!signature) return false;

  const cleanSignature = String(signature).replace(/^sha256=/i, "").trim();
  const supplied = hexToBytes(cleanSignature);
  if (!supplied) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))
  );
  return constantTimeEqual(expected, supplied);
}

async function zernioPost(path, body, env) {
  if (!env.ZERNIO_API_KEY) throw new Error("Missing ZERNIO_API_KEY");

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.ZERNIO_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(`Zernio ${res.status}: ${text}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function processComment(payload, env) {
  const c = normalizeComment(payload);

  if (c.event !== "comment.received") return { skipped: "not_comment_received" };
  if (!matchesKeyword(c.text, env)) return { skipped: "keyword_no_match" };

  if (!c.commentId || !c.postId || !c.accountId) {
    console.error("Missing required IDs in webhook payload", c, payload);
    return { skipped: "missing_ids" };
  }

  const publicMessage = randomPublicReply(env);
  const publicResult = await zernioPost(
    `/inbox/comments/${encodeURIComponent(c.postId)}`,
    {
      accountId: c.accountId,
      message: publicMessage,
      commentId: c.commentId,
    },
    env
  );

  let privateResult = null;
  let privateError = null;

  try {
    privateResult = await zernioPost(
      `/inbox/comments/${encodeURIComponent(c.postId)}/${encodeURIComponent(c.commentId)}/private-reply`,
      {
        accountId: c.accountId,
        message: env.DM_MESSAGE || "هلا 💙 هذا هو الشي المجاني اللي طلبته.",
      },
      env
    );
  } catch (err) {
    privateError = {
      message: err.message,
      status: err.status || null,
      data: err.data || null,
    };
    console.error("Private reply failed:", privateError);
  }

  return {
    ok: true,
    publicReply: publicMessage,
    publicResult,
    privateResult,
    privateError,
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: "zernio-webhook",
        runtime: "cloudflare-worker",
      });
    }

    if (request.method !== "POST" || url.pathname !== "/webhooks/zernio") {
      return json({ error: "Not found" }, 404);
    }

    const rawBody = await request.text();
    const signature =
      request.headers.get("x-zernio-signature") ||
      request.headers.get("x-late-signature");

    const valid = await verifySignature(
      rawBody,
      signature,
      env.ZERNIO_WEBHOOK_SECRET || ""
    );

    if (!valid) return json({ error: "Invalid webhook signature" }, 401);

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    ctx.waitUntil(
      processComment(payload, env)
        .then((result) => console.log("Webhook result:", result))
        .catch((err) => console.error("Webhook processing failed:", err))
    );

    return json({ accepted: true }, 202);
  },
};
