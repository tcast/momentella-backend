/**
 * Helpers for the Resend inbound webhook.
 *
 * - Plus-addressed routing: each per-trip notification email is sent with
 *   Reply-To `hello+trip-<tripId>@booking.momentella.com`. Clients hit Reply
 *   in their mail client; their response lands at that exact address; we
 *   extract the trip id back out.
 *
 * - Quoted-reply stripping: chops the `On Mon, ..., wrote:` block, lines that
 *   start with `> `, and the obvious signature delimiters. The result is the
 *   actually-typed body, suitable for storing as a TripMessage.
 */

import { prisma } from "./prisma.js";

const TRIP_TAG_RE = /\+trip-([A-Za-z0-9]+)/;

export interface ParsedAddress {
  email: string;
  name: string | null;
}

/** "Tony Castiglione <tcast@att.net>" → { email, name } */
export function parseAddress(input: string | null | undefined): ParsedAddress | null {
  if (!input) return null;
  const trimmed = input.trim();
  const m = /^(.*?)<([^>]+)>$/.exec(trimmed);
  if (m) {
    const name = m[1]!.trim().replace(/^["']|["']$/g, "");
    return { email: m[2]!.trim().toLowerCase(), name: name || null };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { email: trimmed.toLowerCase(), name: null };
  }
  return null;
}

/** From a list of "to" addresses, returns the first trip id we can find. */
export function extractTripId(toAddresses: string[]): string | null {
  for (const raw of toAddresses) {
    const a = parseAddress(raw);
    if (!a) continue;
    const m = TRIP_TAG_RE.exec(a.email);
    if (m) return m[1]!;
  }
  return null;
}

/**
 * Build the Reply-To address for a given trip. Uses RESEND_FROM as the
 * mailbox (e.g. `hello@booking.momentella.com` → `hello+trip-XYZ@…`). Falls
 * back to a sensible default when the env var isn't set.
 */
export function buildTripReplyTo(tripId: string): string | null {
  const from = process.env.RESEND_FROM?.trim();
  if (!from) return null;
  const at = from.lastIndexOf("@");
  if (at < 0) return null;
  const local = from.slice(0, at);
  const domain = from.slice(at + 1);
  // If the local part already has a +, keep only the part before it.
  const baseLocal = local.split("+")[0];
  return `${baseLocal}+trip-${tripId}@${domain}`;
}

/**
 * Strips quoted reply text + signatures from a plain-text email body.
 * Heuristic — preserves more than enough of the user's message without
 * including the entire forwarded thread.
 */
export function stripQuotedReply(body: string): string {
  if (!body) return "";
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    // Common Gmail / Outlook prefixes that mark the start of quoted text.
    if (/^On .+wrote:\s*$/i.test(line)) break;
    if (/^-----\s*Original Message\s*-----/i.test(line)) break;
    if (/^From:\s.+/i.test(line) && out.length > 0) break;
    // Standard signature delimiter "-- " on its own line.
    if (line === "-- ") break;
    // ">" quoted block that runs to the end is usually a reply quote.
    if (line.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Best-effort plain text from an HTML body — used when Resend gives us
 * `html` only.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/?(p|div|br|h[1-6]|li|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface SenderInfo {
  authorId: string | null;
  authorName: string | null;
  authorRole: "admin" | "client";
}

/**
 * Decide who sent this reply. Match strategy:
 *   1. The trip's client (by email) → "client"
 *   2. Any admin user (by email) → "admin"
 *   3. Otherwise null (unknown sender, drop).
 */
export async function resolveSender(
  tripId: string,
  fromEmail: string,
): Promise<SenderInfo | null> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { client: { select: { id: true, email: true, name: true } } },
  });
  if (!trip) return null;
  const lowered = fromEmail.toLowerCase();
  if (trip.client && trip.client.email.toLowerCase() === lowered) {
    return {
      authorId: trip.client.id,
      authorName: trip.client.name || trip.client.email,
      authorRole: "client",
    };
  }
  const admin = await prisma.user.findFirst({
    where: { email: lowered, role: "admin" },
    select: { id: true, email: true, name: true },
  });
  if (admin) {
    return {
      authorId: admin.id,
      authorName: admin.name || admin.email,
      authorRole: "admin",
    };
  }
  return null;
}
