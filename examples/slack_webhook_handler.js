/**
 * Express handler that verifies an Extracto webhook delivery and posts
 * a formatted message to a Slack incoming webhook.
 *
 * Setup:
 *   npm install express
 *   export EXTRACTO_WEBHOOK_SECRET=whsec_...     # from POST /api/v1/webhooks
 *   export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../...
 *   node slack_webhook_handler.js
 *
 * Then register https://your-host/extracto-webhook with Extracto.
 */
const crypto = require("node:crypto");
const express = require("express");

const app = express();
app.use(express.raw({ type: "application/json" }));

const SECRET = process.env.EXTRACTO_WEBHOOK_SECRET;
const SLACK = process.env.SLACK_WEBHOOK_URL;

if (!SECRET || !SLACK) {
  console.error("EXTRACTO_WEBHOOK_SECRET and SLACK_WEBHOOK_URL are required.");
  process.exit(1);
}

function verifySignature(headerValue, rawBody) {
  if (!headerValue) return false;
  const expected = crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
  const presented = Buffer.from(String(headerValue), "utf8");
  const computed = Buffer.from(expected, "utf8");
  return presented.length === computed.length && crypto.timingSafeEqual(presented, computed);
}

app.post("/extracto-webhook", async (req, res) => {
  const raw = req.body;
  if (!verifySignature(req.headers["x-extracto-signature"], raw)) {
    return res.status(401).send("bad signature");
  }

  const event = JSON.parse(raw.toString("utf8"));
  const job = event.job ?? {};
  const ok = event.event === "job.completed";
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${ok ? "OCR done" : "OCR failed"}: ${job.fileName ?? "(unknown)"}`,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Status*: ${job.status ?? "?"}` },
        { type: "mrkdwn", text: `*Model*: ${job.model ?? "?"}` },
        { type: "mrkdwn", text: `*Job id*: ${job.id ?? "?"}` },
        { type: "mrkdwn", text: `*Time*: ${job.processingMs ?? 0}ms` },
      ],
    },
  ];
  if (!ok && job.errorMessage) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `\`\`\`${job.errorMessage}\`\`\`` } });
  }

  await fetch(SLACK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
  });

  res.status(204).end();
});

const port = process.env.PORT || 4444;
app.listen(port, () => console.log(`Extracto -> Slack handler listening on :${port}`));
