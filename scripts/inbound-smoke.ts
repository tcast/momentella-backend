import { createHmac } from "node:crypto";

const TRIP_ID = process.argv[2] ?? "cmoftmz1s0001gjtwr5glit9s";
const secret = process.env.RESEND_WEBHOOK_SECRET;
if (!secret) {
  throw new Error("RESEND_WEBHOOK_SECRET not set");
}

async function main() {
  const payload = {
    type: "email.received",
    data: {
      from: "Tony Castiglione <tcast@att.net>",
      to: [`hello+trip-${TRIP_ID}@booking.momentella.com`],
      subject: "Re: Your Momentella trip is ready to review",
      text:
        "Looks great! Question about the Hay-Adams — can we get a crib for the room?\n\nThanks,\nTony\n\nOn Sat, Apr 26 2026, Momentella <hello@booking.momentella.com> wrote:\n> Your trip designer just published v1...\n> [snip rest of quoted email]",
    },
  };
  const body = JSON.stringify(payload);
  const msgId = `msg_test_${Date.now()}`;
  const ts = Math.floor(Date.now() / 1000).toString();

  // svix signs `${id}.${ts}.${body}` with HMAC-SHA256 using the raw secret bytes.
  // Secret is `whsec_<base64>` — strip the prefix and base64-decode.
  const rawSecret = secret!.startsWith("whsec_")
    ? Buffer.from(secret!.slice("whsec_".length), "base64")
    : Buffer.from(secret!);

  const signed = createHmac("sha256", rawSecret)
    .update(`${msgId}.${ts}.${body}`)
    .digest("base64");

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "svix-id": msgId,
    "svix-timestamp": ts,
    "svix-signature": `v1,${signed}`,
  };

  const res = await fetch(
    "https://api-production-5443.up.railway.app/api/webhooks/resend/inbound",
    { method: "POST", headers, body },
  );
  console.log("status:", res.status);
  console.log("body:", await res.text());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
