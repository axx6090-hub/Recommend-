import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 3000);
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY || "";
const ZERNIO_WEBHOOK_SECRET = process.env.ZERNIO_WEBHOOK_SECRET || "";
const KEYWORD = (process.env.KEYWORD || "Ai").trim().toLowerCase();
const DM_MESSAGE =
  process.env.DM_MESSAGE ||
  "هلا 💙 هذا هو الشي المجاني اللي طلبته.";
const PUBLIC_REPLIES = (
  process.env.PUBLIC_REPLIES ||
  "تابعني حتى اكدر ارسلك لان حسابك خاص💫|دزلي متابعه حتى اكدر ادزلك مجاني💙|تابعني حتى اكدر ارسلك♥️"
)
  .split("|")
  .map((s) => s.trim())
  .filter(Boolean);

const API_BASE = "https://zernio.com/api/v1";
const seenEvents = new Map();
const SEEN_TTL_MS = 48 * 60 * 60 * 1000;

function cleanupSeen() {
  const cutoff = Date.now() - SEEN_TTL_MS;
  for (const [id, ts] of seenEvents) {
    if (ts < cutoff) seenEvents.delete(id);
  }
}

function safeEqualHex(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function verifySignature(rawBody, signature) {
  if (!ZERNIO_WEBHOOK_SECRET) return true;
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", ZERNIO_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return safeEqualHex(expected, signature);
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
      pick(payload, ["comment.text", "comment.message", "data.comment.text", "data.comment.message"]) || ""
    ),
    commentId: String(
      pick(payload, ["comment.id", "comment.commentId", "data.comment.id", "data.comment.commentId"]) || ""
    ),
    postId: String(
      pick(payload, ["post.id", "post.postId", "comment.postId", "data.post.id", "data.comment.postId"]) || ""
    ),
    accountId: String(
      pick(payload, ["account.accountId", "account.id", "comment.accountId", "data.account.accountId", "data.account.id"]) || ""
    ),
  };
}

function matchesKeyword(text) {
  return String(text).trim().toLowerCase() === KEYWORD;
}

function randomPublicReply() {
  if (!PUBLIC_REPLIES.length) return "تابعني حتى اكدر ارسلك♥️";
  return PUBLIC_REPLIES[Math.floor(Math.random() * PUBLIC_REPLIES.length)];
}

async function zernioPost(path, body) {
  if (!ZERNIO_API_KEY) throw new Error("Missing ZERNIO_API_KEY");

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ZERNIO_API_KEY}`,
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

async function processComment(payload) {
  const c = normalizeComment(payload);

  if (c.event !== "comment.received") return { skipped: "not_comment_received" };
  if (!matchesKeyword(c.text)) return { skipped: "keyword_no_match" };

  if (!c.commentId || !c.postId || !c.accountId) {
    console.error("Missing required IDs in webhook payload", c, payload);
    return { skipped: "missing_ids" };
  }

  const publicMessage = randomPublicReply();

  const publicResult = await zernioPost(
    `/inbox/comments/${encodeURIComponent(c.postId)}`,
    {
      accountId: c.accountId,
      message: publicMessage,
      commentId: c.commentId,
    }
  );

  let privateResult = null;
  let privateError = null;

  try {
    privateResult = await zernioPost(
      `/inbox/comments/${encodeURIComponent(c.postId)}/${encodeURIComponent(c.commentId)}/private-reply`,
      {
        accountId: c.accountId,
        message: DM_MESSAGE,
      }
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

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "zernio-webhook" }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/webhooks/zernio") {
    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const rawBody = Buffer.concat(chunks);
    const signature =
      req.headers["x-zernio-signature"] ||
      req.headers["x-late-signature"];

    if (!verifySignature(rawBody, signature)) {
      res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Invalid webhook signature" }));
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    cleanupSeen();
    const eventId =
      payload.id ||
      req.headers["x-zernio-event-id"] ||
      req.headers["x-late-event-id"];

    if (eventId && seenEvents.has(eventId)) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, duplicate: true }));
      return;
    }

    if (eventId) seenEvents.set(eventId, Date.now());

    res.writeHead(202, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ accepted: true }));

    processComment(payload)
      .then((result) => console.log("Webhook result:", result))
      .catch((err) => console.error("Webhook processing failed:", err));
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`zernio-webhook listening on port ${PORT}`);
});
