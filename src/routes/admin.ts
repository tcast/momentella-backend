import type { FastifyPluginAsync } from "fastify";
import { DestinationType, IntakeSubmissionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getSession } from "../lib/request-session.js";
import {
  defaultFamilyTripSchema,
  FORM_SCHEMA_VERSION,
  parseIntakeFormSchema,
} from "../lib/intake-schema.js";
import { buildListPreview } from "../lib/intake-summary.js";
import {
  PAGE_SCHEMA_VERSION,
  parsePageSchema,
} from "../lib/page-schema.js";
import {
  ObjectStorageNotConfigured,
  deleteObject,
  isObjectStorageConfigured,
  putObject,
} from "../lib/object-storage.js";
import { convertIntakeToTrip } from "../lib/intake-to-trip.js";
import { submitIndexNowAsync } from "../lib/indexnow.js";
import { parseItinerarySchema } from "../lib/itinerary-schema.js";
import {
  PROPOSAL_SCHEMA_VERSION,
  type ProposalSchema,
} from "../lib/proposal-schema.js";
import {
  notifyNewMessage,
  notifyProposalPublished,
} from "../lib/trip-notifications.js";
import { getStripe, isStripeConfigured, syncProductToStripe } from "../lib/stripe.js";
import { resendGiftRecipientEmail } from "../lib/commerce.js";
import {
  defaultSiteNavConfig,
  parseSiteNavConfig,
} from "../lib/site-nav-schema.js";
import {
  BookingKind,
  BookingStatus,
  ProposalStatus,
  TripKind,
  TripStatus,
} from "@prisma/client";

const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Pull only the booking fields a client may set, with mild type coercion. */
function parseBookingBody(
  body: Record<string, unknown>,
  _ctx: { title?: string; kind?: string; status?: string },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof body.title === "string") out.title = body.title.trim();
  if (body.vendorName !== undefined)
    out.vendorName =
      typeof body.vendorName === "string" && body.vendorName.trim()
        ? body.vendorName.trim()
        : null;
  if (body.vendorUrl !== undefined)
    out.vendorUrl =
      typeof body.vendorUrl === "string" && body.vendorUrl.trim()
        ? body.vendorUrl.trim()
        : null;
  if (body.bookingRef !== undefined)
    out.bookingRef =
      typeof body.bookingRef === "string" && body.bookingRef.trim()
        ? body.bookingRef.trim()
        : null;
  if (body.bookedBy !== undefined) {
    const v = String(body.bookedBy);
    out.bookedBy = v === "us" || v === "them" ? v : null;
  }
  if (body.startDate !== undefined)
    out.startDate =
      typeof body.startDate === "string" && body.startDate
        ? new Date(body.startDate)
        : null;
  if (body.endDate !== undefined)
    out.endDate =
      typeof body.endDate === "string" && body.endDate
        ? new Date(body.endDate)
        : null;
  if (body.cost !== undefined) {
    if (body.cost === null || body.cost === "") out.cost = null;
    else {
      const n = typeof body.cost === "number" ? body.cost : Number(body.cost);
      out.cost = Number.isFinite(n) ? n : null;
    }
  }
  if (body.costNotes !== undefined)
    out.costNotes =
      typeof body.costNotes === "string" && body.costNotes.trim()
        ? body.costNotes.trim()
        : null;
  if (body.description !== undefined)
    out.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
  if (body.notes !== undefined)
    out.notes =
      typeof body.notes === "string" && body.notes.trim()
        ? body.notes.trim()
        : null;
  return out;
}

/** Internal admin API — session required, `role` must be `admin`. */
export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    const session = await getSession(request);
    if (!session?.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    if (session.user.role !== "admin") {
      return reply.status(403).send({ error: "Admin only" });
    }
    request.adminSession = session;
  });

  app.get("/overview", async () => {
    const [users, trips, bookingRequests, intakeSubmissions] = await Promise.all([
      prisma.user.count(),
      prisma.trip.count(),
      prisma.bookingRequest.count(),
      prisma.intakeSubmission.count(),
    ]);
    return { users, trips, bookingRequests, intakeSubmissions };
  });

  app.get("/booking-requests", async () => {
    const rows = await prisma.bookingRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return { bookingRequests: rows };
  });

  app.get("/trips", async (request) => {
    const q = request.query as {
      status?: string;
      kind?: string;
      clientId?: string;
      take?: string;
    };
    const take = Math.min(200, Math.max(1, Number(q.take) || 100));
    const where: Record<string, unknown> = {};
    if (
      q.status &&
      (Object.values(TripStatus) as string[]).includes(q.status)
    ) {
      where.status = q.status as TripStatus;
    }
    if (q.kind && (Object.values(TripKind) as string[]).includes(q.kind)) {
      where.kind = q.kind as TripKind;
    }
    if (q.clientId) where.clientId = q.clientId;
    const trips = await prisma.trip.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take,
      include: {
        client: { select: { id: true, name: true, email: true } },
        _count: { select: { notes: true } },
      },
    });
    return { trips };
  });

  app.get("/trips/:tripId", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        client: { select: { id: true, name: true, email: true } },
        originIntakeSubmission: {
          select: { id: true, formId: true, createdAt: true, email: true },
        },
        notes: { orderBy: { createdAt: "desc" } },
        proposals: {
          orderBy: { version: "desc" },
          select: {
            id: true,
            version: true,
            status: true,
            message: true,
            publishedByName: true,
            respondedAt: true,
            responderName: true,
            responseNote: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        messages: { orderBy: { createdAt: "asc" } },
        bookings: { orderBy: [{ startDate: "asc" }, { createdAt: "asc" }] },
        documents: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!trip) return reply.status(404).send({ error: "Not found" });
    return { trip };
  });

  app.post("/trips", async (request, reply) => {
    const body = request.body as {
      clientId?: string;
      title?: string;
      kind?: string;
      destination?: string;
    };
    if (!body.clientId || !body.title?.trim()) {
      return reply.status(400).send({ error: "clientId and title required" });
    }
    const client = await prisma.user.findUnique({
      where: { id: body.clientId },
    });
    if (!client) return reply.status(400).send({ error: "Client not found" });
    const kind =
      body.kind && (Object.values(TripKind) as string[]).includes(body.kind)
        ? (body.kind as TripKind)
        : TripKind.FULL_SERVICE;
    const trip = await prisma.trip.create({
      data: {
        clientId: client.id,
        title: body.title.trim(),
        destination: body.destination?.trim() || null,
        kind,
        status: TripStatus.LEAD,
      },
    });
    return reply.status(201).send({ trip });
  });

  app.patch("/trips/:tripId", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const body = request.body as {
      title?: string;
      destination?: string | null;
      summary?: string | null;
      kind?: string;
      status?: string;
      startsOn?: string | null;
      endsOn?: string | null;
      homeAirportIata?: string | null;
      partyAdults?: number | null;
      partyChildren?: number | null;
      partyChildAges?: number[] | null;
      budgetTier?: string | null;
      destinations?: unknown[] | null;
    };
    const data: Record<string, unknown> = {};
    if (body.title !== undefined) {
      const t = body.title.trim();
      if (!t) return reply.status(400).send({ error: "title required" });
      data.title = t;
    }
    if (body.destination !== undefined) data.destination = body.destination ?? null;
    if (body.summary !== undefined) data.summary = body.summary ?? null;
    if (body.kind !== undefined) {
      if (!(Object.values(TripKind) as string[]).includes(body.kind)) {
        return reply.status(400).send({ error: "invalid kind" });
      }
      data.kind = body.kind as TripKind;
    }
    if (body.status !== undefined) {
      if (!(Object.values(TripStatus) as string[]).includes(body.status)) {
        return reply.status(400).send({ error: "invalid status" });
      }
      data.status = body.status as TripStatus;
    }
    if (body.startsOn !== undefined)
      data.startsOn = body.startsOn ? new Date(body.startsOn) : null;
    if (body.endsOn !== undefined)
      data.endsOn = body.endsOn ? new Date(body.endsOn) : null;
    if (body.homeAirportIata !== undefined)
      data.homeAirportIata = body.homeAirportIata ?? null;
    if (body.partyAdults !== undefined) data.partyAdults = body.partyAdults;
    if (body.partyChildren !== undefined) data.partyChildren = body.partyChildren;
    if (body.partyChildAges !== undefined)
      data.partyChildAges = body.partyChildAges ?? null;
    if (body.budgetTier !== undefined) data.budgetTier = body.budgetTier ?? null;
    if (body.destinations !== undefined)
      data.destinations = body.destinations ?? null;

    try {
      const trip = await prisma.trip.update({ where: { id: tripId }, data });
      return { trip };
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  app.delete("/trips/:tripId", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    try {
      await prisma.trip.delete({ where: { id: tripId } });
      return { ok: true };
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  // Threaded internal notes on a trip (mirrors intake-submission notes).
  app.post("/trips/:tripId/notes", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const body = request.body as { body?: string };
    const text = (body.body ?? "").trim();
    if (!text) return reply.status(400).send({ error: "Note cannot be empty" });
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true },
    });
    if (!trip) return reply.status(404).send({ error: "Trip not found" });
    const author = request.adminSession!.user;
    const note = await prisma.tripNote.create({
      data: {
        tripId,
        authorId: author.id,
        authorName: author.name ?? author.email,
        body: text,
      },
    });
    return reply.status(201).send({ note });
  });

  app.patch("/trips/:tripId/notes/:noteId", async (request, reply) => {
    const { tripId, noteId } = request.params as {
      tripId: string;
      noteId: string;
    };
    const body = request.body as { body?: string };
    const text = (body.body ?? "").trim();
    if (!text) return reply.status(400).send({ error: "Note cannot be empty" });
    const existing = await prisma.tripNote.findFirst({
      where: { id: noteId, tripId },
    });
    if (!existing) return reply.status(404).send({ error: "Not found" });
    const note = await prisma.tripNote.update({
      where: { id: noteId },
      data: { body: text },
    });
    return { note };
  });

  app.delete("/trips/:tripId/notes/:noteId", async (request, reply) => {
    const { tripId, noteId } = request.params as {
      tripId: string;
      noteId: string;
    };
    const existing = await prisma.tripNote.findFirst({
      where: { id: noteId, tripId },
    });
    if (!existing) return reply.status(404).send({ error: "Not found" });
    await prisma.tripNote.delete({ where: { id: noteId } });
    return { ok: true };
  });

  // Itinerary: a single JSON document per trip (one current draft).
  app.put("/trips/:tripId/itinerary", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const body = request.body as { schema?: unknown };
    const parsed = parseItinerarySchema(body.schema);
    if (!parsed) {
      return reply.status(400).send({ error: "Invalid itinerary schema" });
    }
    const exists = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true },
    });
    if (!exists) return reply.status(404).send({ error: "Trip not found" });
    const trip = await prisma.trip.update({
      where: { id: tripId },
      data: { itinerarySchema: parsed as object },
      select: {
        id: true,
        itinerarySchema: true,
        updatedAt: true,
      },
    });
    return { trip };
  });

  // ── Proposals ─────────────────────────────────────────────────────────
  app.get("/trips/:tripId/proposals/:proposalId", async (request, reply) => {
    const { tripId, proposalId } = request.params as {
      tripId: string;
      proposalId: string;
    };
    const proposal = await prisma.proposal.findFirst({
      where: { id: proposalId, tripId },
    });
    if (!proposal) return reply.status(404).send({ error: "Not found" });
    return { proposal };
  });

  app.post("/trips/:tripId/proposals", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const body = request.body as { message?: string };
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) return reply.status(404).send({ error: "Trip not found" });
    const itinerary = parseItinerarySchema(trip.itinerarySchema);
    if (!itinerary) {
      return reply.status(400).send({
        error:
          "Build an itinerary first — there's nothing to publish yet.",
      });
    }

    const max = await prisma.proposal.aggregate({
      where: { tripId },
      _max: { version: true },
    });
    const nextVersion = (max._max.version ?? 0) + 1;

    const author = request.adminSession!.user;
    const snapshot: ProposalSchema = {
      version: PROPOSAL_SCHEMA_VERSION,
      trip: {
        title: trip.title,
        kind: trip.kind,
        status: trip.status,
        destination: trip.destination,
        destinations: (trip.destinations as unknown[]) ?? null,
        startsOn: trip.startsOn ? trip.startsOn.toISOString() : null,
        endsOn: trip.endsOn ? trip.endsOn.toISOString() : null,
        homeAirportIata: trip.homeAirportIata,
        partyAdults: trip.partyAdults,
        partyChildren: trip.partyChildren,
        partyChildAges: (trip.partyChildAges as number[] | null) ?? null,
        budgetTier: trip.budgetTier,
        summary: trip.summary,
      },
      itinerary,
    };

    const messageText = body.message?.trim() || null;

    const proposal = await prisma.$transaction(async (tx) => {
      const p = await tx.proposal.create({
        data: {
          tripId,
          version: nextVersion,
          schema: snapshot as unknown as object,
          status: ProposalStatus.SENT,
          message: messageText,
          publishedById: author.id,
          publishedByName: author.name ?? author.email,
        },
      });
      // Move the trip into PROPOSED if it's still in early stages.
      const advance =
        trip.status === TripStatus.LEAD ||
        trip.status === TripStatus.PLANNING ||
        trip.status === TripStatus.DRAFT;
      if (advance) {
        await tx.trip.update({
          where: { id: tripId },
          data: { status: TripStatus.PROPOSED },
        });
      }
      // If the admin's publish message is non-empty, store it as a system
      // message on the thread so the client sees it.
      if (messageText) {
        await tx.tripMessage.create({
          data: {
            tripId,
            authorId: author.id,
            authorName: author.name ?? author.email,
            authorRole: "admin",
            body: `[v${nextVersion} published] ${messageText}`,
          },
        });
      }
      return p;
    });
    void notifyProposalPublished(proposal.id);
    return reply.status(201).send({ proposal });
  });

  app.patch("/trips/:tripId/proposals/:proposalId", async (request, reply) => {
    const { tripId, proposalId } = request.params as {
      tripId: string;
      proposalId: string;
    };
    const body = request.body as { status?: string };
    if (
      body.status === undefined ||
      !(Object.values(ProposalStatus) as string[]).includes(body.status)
    ) {
      return reply.status(400).send({ error: "invalid status" });
    }
    const existing = await prisma.proposal.findFirst({
      where: { id: proposalId, tripId },
    });
    if (!existing) return reply.status(404).send({ error: "Not found" });
    const proposal = await prisma.proposal.update({
      where: { id: proposalId },
      data: { status: body.status as ProposalStatus },
    });
    return { proposal };
  });

  // ── Trip messages ─────────────────────────────────────────────────────
  app.get("/trips/:tripId/messages", async (request) => {
    const { tripId } = request.params as { tripId: string };
    const messages = await prisma.tripMessage.findMany({
      where: { tripId },
      orderBy: { createdAt: "asc" },
    });
    return { messages };
  });

  app.post("/trips/:tripId/messages", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const body = request.body as { body?: string };
    const text = (body.body ?? "").trim();
    if (!text)
      return reply.status(400).send({ error: "Message cannot be empty" });
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true },
    });
    if (!trip) return reply.status(404).send({ error: "Trip not found" });
    const author = request.adminSession!.user;
    const message = await prisma.tripMessage.create({
      data: {
        tripId,
        authorId: author.id,
        authorName: author.name ?? author.email,
        authorRole: "admin",
        body: text,
      },
    });
    void notifyNewMessage(message.id);
    return reply.status(201).send({ message });
  });

  // ── Bookings ──────────────────────────────────────────────────────────
  app.post("/trips/:tripId/bookings", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const body = request.body as Record<string, unknown>;
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true },
    });
    if (!trip) return reply.status(404).send({ error: "Trip not found" });
    const kind = String(body.kind ?? "");
    if (!(Object.values(BookingKind) as string[]).includes(kind)) {
      return reply.status(400).send({ error: "kind required" });
    }
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return reply.status(400).send({ error: "title required" });
    }
    const status = String(body.status ?? "DRAFT");
    if (!(Object.values(BookingStatus) as string[]).includes(status)) {
      return reply.status(400).send({ error: "invalid status" });
    }
    const data = parseBookingBody(body, { title, kind, status });
    const booking = await prisma.booking.create({
      data: {
        tripId,
        title,
        kind: kind as BookingKind,
        status: status as BookingStatus,
        ...data,
      },
    });
    return reply.status(201).send({ booking });
  });

  app.patch("/trips/:tripId/bookings/:bookingId", async (request, reply) => {
    const { tripId, bookingId } = request.params as {
      tripId: string;
      bookingId: string;
    };
    const body = request.body as Record<string, unknown>;
    const existing = await prisma.booking.findFirst({
      where: { id: bookingId, tripId },
    });
    if (!existing) return reply.status(404).send({ error: "Not found" });
    const data: Record<string, unknown> = {};
    if (body.kind !== undefined) {
      if (!(Object.values(BookingKind) as string[]).includes(String(body.kind))) {
        return reply.status(400).send({ error: "invalid kind" });
      }
      data.kind = body.kind as BookingKind;
    }
    if (body.status !== undefined) {
      if (
        !(Object.values(BookingStatus) as string[]).includes(String(body.status))
      ) {
        return reply.status(400).send({ error: "invalid status" });
      }
      data.status = body.status as BookingStatus;
    }
    Object.assign(data, parseBookingBody(body, {}));
    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: "Nothing to update" });
    }
    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data,
    });
    return { booking };
  });

  app.delete("/trips/:tripId/bookings/:bookingId", async (request, reply) => {
    const { tripId, bookingId } = request.params as {
      tripId: string;
      bookingId: string;
    };
    const existing = await prisma.booking.findFirst({
      where: { id: bookingId, tripId },
    });
    if (!existing) return reply.status(404).send({ error: "Not found" });
    await prisma.booking.delete({ where: { id: bookingId } });
    return { ok: true };
  });

  // ── Documents ─────────────────────────────────────────────────────────
  const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
  const ALLOWED_DOCUMENT_TYPES = new Set([
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "text/csv",
  ]);

  app.post("/trips/:tripId/documents", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { id: true },
    });
    if (!trip) return reply.status(404).send({ error: "Trip not found" });
    if (!isObjectStorageConfigured()) {
      return reply.status(503).send({
        error:
          "Storage isn't configured. Ask your developer to set up the S3 / R2 env vars.",
      });
    }
    let part;
    try {
      part = await request.file();
    } catch (err) {
      app.log.warn({ err }, "multipart parse failed");
      return reply.status(400).send({ error: "Invalid upload" });
    }
    if (!part) return reply.status(400).send({ error: "No file in request" });
    const contentType = part.mimetype;
    if (!ALLOWED_DOCUMENT_TYPES.has(contentType)) {
      return reply.status(415).send({
        error: `Unsupported file type (${contentType || "unknown"}).`,
      });
    }
    const buf = await part.toBuffer();
    if (buf.length === 0) {
      return reply.status(400).send({ error: "Empty file" });
    }
    if (buf.length > MAX_DOCUMENT_BYTES) {
      return reply.status(413).send({
        error: `File is too large (${(buf.length / 1024 / 1024).toFixed(1)} MB). Max 25 MB.`,
      });
    }
    const fields = part.fields as
      | Record<string, { value?: unknown }>
      | undefined;
    const customName =
      fields?.name && typeof fields.name.value === "string"
        ? fields.name.value.trim()
        : "";
    const bookingId =
      fields?.bookingId && typeof fields.bookingId.value === "string"
        ? fields.bookingId.value.trim() || null
        : null;
    if (bookingId) {
      const linked = await prisma.booking.findFirst({
        where: { id: bookingId, tripId },
        select: { id: true },
      });
      if (!linked) {
        return reply.status(400).send({ error: "Linked booking not found" });
      }
    }
    try {
      const stored = await putObject({
        body: buf,
        contentType,
        filename: part.filename || "document",
        prefix: `trips/${tripId}/documents`,
      });
      const author = request.adminSession!.user;
      const doc = await prisma.tripDocument.create({
        data: {
          tripId,
          bookingId,
          name: customName || part.filename || "Document",
          storageKey: stored.key,
          url: stored.url,
          contentType: stored.contentType,
          size: stored.bytes,
          visibleToClient: true,
          uploadedById: author.id,
          uploadedByName: author.name ?? author.email,
        },
      });
      // Auto-post a system message into the trip thread so the client
      // gets emailed (regular new-message dedup applies). Admin can opt
      // out by toggling visibility off after the fact.
      try {
        const threadMsg = await prisma.tripMessage.create({
          data: {
            tripId,
            authorId: author.id,
            authorName: author.name ?? author.email,
            authorRole: "admin",
            body: `📎 Shared a new document: ${doc.name}`,
          },
        });
        void notifyNewMessage(threadMsg.id);
      } catch (err) {
        app.log.warn({ err }, "[upload] failed to post thread message");
      }
      return reply.status(201).send({ document: doc });
    } catch (err) {
      if (err instanceof ObjectStorageNotConfigured) {
        return reply.status(503).send({ error: err.message });
      }
      app.log.error({ err }, "document upload failed");
      return reply.status(500).send({ error: "Upload failed" });
    }
  });

  app.patch("/trips/:tripId/documents/:documentId", async (request, reply) => {
    const { tripId, documentId } = request.params as {
      tripId: string;
      documentId: string;
    };
    const body = request.body as {
      name?: string;
      visibleToClient?: boolean;
      bookingId?: string | null;
    };
    const existing = await prisma.tripDocument.findFirst({
      where: { id: documentId, tripId },
    });
    if (!existing) return reply.status(404).send({ error: "Not found" });
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const n = body.name.trim();
      if (!n) return reply.status(400).send({ error: "Name cannot be empty" });
      data.name = n;
    }
    if (body.visibleToClient !== undefined) {
      data.visibleToClient = !!body.visibleToClient;
    }
    if (body.bookingId !== undefined) {
      if (body.bookingId === null) {
        data.bookingId = null;
      } else {
        const linked = await prisma.booking.findFirst({
          where: { id: body.bookingId, tripId },
          select: { id: true },
        });
        if (!linked)
          return reply.status(400).send({ error: "Linked booking not found" });
        data.bookingId = body.bookingId;
      }
    }
    const document = await prisma.tripDocument.update({
      where: { id: documentId },
      data,
    });
    return { document };
  });

  app.delete("/trips/:tripId/documents/:documentId", async (request, reply) => {
    const { tripId, documentId } = request.params as {
      tripId: string;
      documentId: string;
    };
    const existing = await prisma.tripDocument.findFirst({
      where: { id: documentId, tripId },
    });
    if (!existing) return reply.status(404).send({ error: "Not found" });
    await prisma.tripDocument.delete({ where: { id: documentId } });
    if (isObjectStorageConfigured()) {
      void deleteObject(existing.storageKey);
    }
    return { ok: true };
  });

  // Convert an intake submission into a trip (idempotent).
  app.post(
    "/intake-submissions/:submissionId/convert-to-trip",
    async (request, reply) => {
      const { submissionId } = request.params as { submissionId: string };
      try {
        const result = await convertIntakeToTrip(submissionId);
        return reply.status(result.alreadyConverted ? 200 : 201).send(result);
      } catch (err) {
        app.log.error({ err }, "intake → trip conversion failed");
        return reply.status(500).send({ error: "Conversion failed" });
      }
    },
  );

  app.get("/users/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        banned: true,
        banReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) return reply.status(404).send({ error: "User not found" });

    const trips = await prisma.trip.findMany({
      where: { clientId: userId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        kind: true,
        destination: true,
        destinations: true,
        startsOn: true,
        endsOn: true,
        partyAdults: true,
        partyChildren: true,
        partyChildAges: true,
        homeAirportIata: true,
        updatedAt: true,
        createdAt: true,
        _count: { select: { proposals: true, bookings: true } },
      },
    });

    const submissions = await prisma.intakeSubmission.findMany({
      where: { OR: [{ clientId: userId }, { email: user.email }] },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: {
        id: true,
        status: true,
        createdAt: true,
        form: { select: { id: true, name: true, slug: true } },
        formVersion: { select: { version: true } },
        convertedTrip: { select: { id: true, title: true } },
      },
    });

    return { user, trips, submissions };
  });

  app.get("/users", async () => {
    const rows = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        banned: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return { users: rows };
  });

  app.patch("/users/:userId", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const body = request.body as { name?: string; email?: string };
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return reply.status(404).send({ error: "User not found" });
    }
    const data: { name?: string; email?: string } = {};
    if (body.name !== undefined) {
      const n = body.name.trim();
      if (!n) {
        return reply.status(400).send({ error: "Name cannot be empty" });
      }
      data.name = n;
    }
    if (body.email !== undefined) {
      const e = body.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
        return reply.status(400).send({ error: "Invalid email" });
      }
      data.email = e;
    }
    if (Object.keys(data).length === 0) {
      return reply.status(400).send({ error: "Nothing to update" });
    }
    try {
      const user = await prisma.user.update({ where: { id: userId }, data });
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        },
      };
    } catch {
      return reply.status(409).send({ error: "Email already in use" });
    }
  });

  app.patch("/users/:userId/role", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const body = request.body as { role?: string };
    const role = body.role;
    if (role !== "admin" && role !== "client") {
      return reply.status(400).send({ error: "role must be admin or client" });
    }
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return reply.status(404).send({ error: "User not found" });
    }
    await prisma.user.update({ where: { id: userId }, data: { role } });
    return { ok: true };
  });

  app.post("/users/:userId/ban", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const body = request.body as { banReason?: string };
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return reply.status(404).send({ error: "User not found" });
    }
    await prisma.user.update({
      where: { id: userId },
      data: {
        banned: true,
        banReason: body.banReason ?? "Suspended by admin",
      },
    });
    return { ok: true };
  });

  app.post("/users/:userId/unban", async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return reply.status(404).send({ error: "User not found" });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { banned: false, banReason: null, banExpires: null },
    });
    return { ok: true };
  });

  app.get("/intake-forms", async () => {
    const intakeForms = await prisma.intakeForm.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        versions: {
          orderBy: { version: "desc" },
        },
      },
    });
    return { intakeForms };
  });

  app.get("/intake-forms/:formId", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const form = await prisma.intakeForm.findUnique({
      where: { id: formId },
      include: {
        versions: { orderBy: { version: "desc" } },
      },
    });
    if (!form) {
      return reply.status(404).send({ error: "Not found" });
    }
    return { form };
  });

  app.post("/intake-forms", async (request, reply) => {
    const body = request.body as {
      slug?: string;
      name?: string;
      description?: string;
      startWithTemplate?: boolean;
    };
    if (!body.slug?.trim() || !body.name?.trim()) {
      return reply.status(400).send({ error: "slug and name are required" });
    }
    if (!slugRe.test(body.slug)) {
      return reply.status(400).send({ error: "slug: lowercase letters, numbers, hyphens only" });
    }
    const schema =
      body.startWithTemplate !== false
        ? defaultFamilyTripSchema()
        : { version: FORM_SCHEMA_VERSION, fields: [] };
    try {
      const form = await prisma.$transaction(async (tx) => {
        const f = await tx.intakeForm.create({
          data: {
            slug: body.slug!.trim(),
            name: body.name!.trim(),
            description: body.description?.trim() ?? null,
            archived: false,
          },
        });
        await tx.intakeFormVersion.create({
          data: {
            formId: f.id,
            version: 1,
            label: "v1",
            schema: schema as object,
            published: true,
          },
        });
        return f;
      });
      return reply.status(201).send({ form });
    } catch {
      return reply.status(409).send({ error: "Could not create form (duplicate slug?)" });
    }
  });

  app.post("/intake-forms/:formId/duplicate", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const body = request.body as {
      slug?: string;
      name?: string;
      description?: string;
    };
    if (!body.slug?.trim() || !body.name?.trim()) {
      return reply.status(400).send({ error: "slug and name are required" });
    }
    if (!slugRe.test(body.slug)) {
      return reply.status(400).send({ error: "invalid slug" });
    }
    const src = await prisma.intakeForm.findUnique({
      where: { id: formId },
      include: { versions: { orderBy: { version: "asc" } } },
    });
    if (!src) {
      return reply.status(404).send({ error: "Not found" });
    }
    const publishedVer = src.versions.find((v) => v.published);
    try {
      const newForm = await prisma.$transaction(async (tx) => {
        const nf = await tx.intakeForm.create({
          data: {
            slug: body.slug!.trim(),
            name: body.name!.trim(),
            description: body.description?.trim() ?? null,
            archived: false,
          },
        });
        for (const ver of src.versions) {
          await tx.intakeFormVersion.create({
            data: {
              formId: nf.id,
              version: ver.version,
              label: ver.label,
              schema: ver.schema as object,
              published:
                !!publishedVer && ver.version === publishedVer.version,
            },
          });
        }
        return nf;
      });
      return reply.status(201).send({ form: newForm });
    } catch {
      return reply.status(409).send({ error: "Could not duplicate (slug taken?)" });
    }
  });

  app.patch("/intake-forms/:formId", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const body = request.body as {
      name?: string;
      description?: string | null;
      slug?: string;
      archived?: boolean;
    };
    if (body.slug !== undefined && body.slug !== null && !slugRe.test(body.slug)) {
      return reply.status(400).send({ error: "invalid slug" });
    }
    try {
      const form = await prisma.intakeForm.update({
        where: { id: formId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.archived !== undefined ? { archived: body.archived } : {}),
        },
      });
      return { form };
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  app.delete("/intake-forms/:formId", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    try {
      await prisma.intakeForm.delete({ where: { id: formId } });
      return { ok: true };
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  app.post("/intake-forms/:formId/versions", async (request, reply) => {
    const { formId } = request.params as { formId: string };
    const body = request.body as { label?: string; copyFromVersionId?: string };
    const form = await prisma.intakeForm.findUnique({ where: { id: formId } });
    if (!form) {
      return reply.status(404).send({ error: "Form not found" });
    }
    const max = await prisma.intakeFormVersion.aggregate({
      where: { formId },
      _max: { version: true },
    });
    const nextV = (max._max.version ?? 0) + 1;
    let schema: object;
    if (body.copyFromVersionId) {
      const src = await prisma.intakeFormVersion.findFirst({
        where: { id: body.copyFromVersionId, formId },
      });
      if (!src) {
        return reply.status(400).send({ error: "Source version not found" });
      }
      schema = src.schema as object;
    } else {
      schema = { version: FORM_SCHEMA_VERSION, fields: [] } as object;
    }
    const version = await prisma.intakeFormVersion.create({
      data: {
        formId,
        version: nextV,
        label: body.label?.trim() ?? `v${nextV}`,
        schema,
        published: false,
      },
    });
    return reply.status(201).send({ version });
  });

  app.patch("/intake-forms/:formId/versions/:versionId", async (request, reply) => {
    const { formId, versionId } = request.params as {
      formId: string;
      versionId: string;
    };
    const body = request.body as { schema?: unknown; label?: string | null };
    const existing = await prisma.intakeFormVersion.findFirst({
      where: { id: versionId, formId },
    });
    if (!existing) {
      return reply.status(404).send({ error: "Not found" });
    }
    if (body.schema !== undefined) {
      const parsed = parseIntakeFormSchema(body.schema);
      if (!parsed) {
        return reply.status(400).send({ error: "Invalid schema" });
      }
      await prisma.intakeFormVersion.update({
        where: { id: versionId },
        data: { schema: parsed as object },
      });
    }
    if (body.label !== undefined) {
      await prisma.intakeFormVersion.update({
        where: { id: versionId },
        data: { label: body.label },
      });
    }
    const version = await prisma.intakeFormVersion.findUnique({
      where: { id: versionId },
    });
    return { version };
  });

  app.post("/intake-forms/:formId/versions/:versionId/publish", async (request, reply) => {
    const { formId, versionId } = request.params as {
      formId: string;
      versionId: string;
    };
    const v = await prisma.intakeFormVersion.findFirst({
      where: { id: versionId, formId },
    });
    if (!v) {
      return reply.status(404).send({ error: "Not found" });
    }
    await prisma.$transaction([
      prisma.intakeFormVersion.updateMany({
        where: { formId },
        data: { published: false },
      }),
      prisma.intakeFormVersion.update({
        where: { id: versionId },
        data: { published: true },
      }),
    ]);
    return { ok: true };
  });

  app.get("/intake-submissions", async (request) => {
    const q = request.query as { formId?: string; take?: string };
    const take = Math.min(200, Math.max(1, Number(q.take) || 80));
    const rows = await prisma.intakeSubmission.findMany({
      where: q.formId ? { formId: q.formId } : undefined,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        form: { select: { name: true, slug: true } },
        formVersion: {
          select: { version: true, label: true, schema: true },
        },
      },
    });
    const submissions = rows.map((r) => {
      const schema = parseIntakeFormSchema(r.formVersion.schema);
      const responses = (r.responses ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        email: r.email,
        status: r.status,
        notes: r.notes,
        createdAt: r.createdAt,
        form: r.form,
        formVersion: {
          version: r.formVersion.version,
          label: r.formVersion.label,
        },
        preview: buildListPreview(schema, responses),
      };
    });
    return { submissions };
  });

  app.get("/intake-submissions/:submissionId", async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string };
    const row = await prisma.intakeSubmission.findUnique({
      where: { id: submissionId },
      include: {
        form: { select: { id: true, name: true, slug: true } },
        formVersion: true,
        client: { select: { id: true, email: true, name: true } },
        notesThread: {
          orderBy: { createdAt: "desc" },
        },
        convertedTrip: {
          select: { id: true, title: true, status: true },
        },
      },
    });
    if (!row) {
      return reply.status(404).send({ error: "Not found" });
    }
    const schema = parseIntakeFormSchema(row.formVersion.schema);
    return {
      submission: row,
      schema,
    };
  });

  // --- Notes thread ------------------------------------------------------

  app.post("/intake-submissions/:submissionId/notes", async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string };
    const body = request.body as { body?: string };
    const text = (body.body ?? "").trim();
    if (!text) return reply.status(400).send({ error: "Note cannot be empty" });
    const sub = await prisma.intakeSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true },
    });
    if (!sub) return reply.status(404).send({ error: "Submission not found" });
    // preHandler guarantees adminSession is set for this route group.
    const author = request.adminSession!.user;
    const note = await prisma.intakeSubmissionNote.create({
      data: {
        submissionId,
        authorId: author.id,
        authorName: author.name ?? author.email,
        body: text,
      },
    });
    return reply.status(201).send({ note });
  });

  app.patch(
    "/intake-submissions/:submissionId/notes/:noteId",
    async (request, reply) => {
      const { submissionId, noteId } = request.params as {
        submissionId: string;
        noteId: string;
      };
      const body = request.body as { body?: string };
      const text = (body.body ?? "").trim();
      if (!text) return reply.status(400).send({ error: "Note cannot be empty" });
      const existing = await prisma.intakeSubmissionNote.findFirst({
        where: { id: noteId, submissionId },
      });
      if (!existing) return reply.status(404).send({ error: "Not found" });
      const note = await prisma.intakeSubmissionNote.update({
        where: { id: noteId },
        data: { body: text },
      });
      return { note };
    },
  );

  app.delete(
    "/intake-submissions/:submissionId/notes/:noteId",
    async (request, reply) => {
      const { submissionId, noteId } = request.params as {
        submissionId: string;
        noteId: string;
      };
      const existing = await prisma.intakeSubmissionNote.findFirst({
        where: { id: noteId, submissionId },
      });
      if (!existing) return reply.status(404).send({ error: "Not found" });
      await prisma.intakeSubmissionNote.delete({ where: { id: noteId } });
      return { ok: true };
    },
  );

  app.patch("/intake-submissions/:submissionId", async (request, reply) => {
    const { submissionId } = request.params as { submissionId: string };
    const body = request.body as { status?: string; notes?: string | null };
    const allowed = new Set<string>(Object.values(IntakeSubmissionStatus));
    if (body.status !== undefined && !allowed.has(body.status)) {
      return reply.status(400).send({ error: "Invalid status" });
    }
    try {
      await prisma.intakeSubmission.update({
        where: { id: submissionId },
        data: {
          ...(body.status
            ? { status: body.status as IntakeSubmissionStatus }
            : {}),
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
        },
      });
      return { ok: true };
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  // -------------------------------------------------------------
  // Airports — manage the catalog used by the `airport` intake field.
  // -------------------------------------------------------------
  app.get("/airports", async (request) => {
    const { q, includeInactive } =
      (request.query as { q?: string; includeInactive?: string }) ?? {};
    const term = (q ?? "").trim();
    const wantAll = includeInactive === "1" || includeInactive === "true";
    const rows = await prisma.airport.findMany({
      where: {
        ...(wantAll ? {} : { active: true }),
        ...(term
          ? {
              OR: [
                { iata: { contains: term, mode: "insensitive" } },
                { icao: { contains: term, mode: "insensitive" } },
                { name: { contains: term, mode: "insensitive" } },
                { city: { contains: term, mode: "insensitive" } },
                { region: { contains: term, mode: "insensitive" } },
                { country: { contains: term, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ country: "asc" }, { city: "asc" }, { iata: "asc" }],
      take: 500,
    });
    return { airports: rows };
  });

  app.post("/airports", async (request, reply) => {
    const body = request.body as {
      iata?: string;
      icao?: string | null;
      name?: string;
      city?: string;
      region?: string | null;
      country?: string;
      countryCode?: string;
    };
    const iata = body.iata?.trim().toUpperCase();
    const name = body.name?.trim();
    const city = body.city?.trim();
    const country = body.country?.trim();
    const countryCode = body.countryCode?.trim().toUpperCase();
    if (!iata || !/^[A-Z]{3}$/.test(iata)) {
      return reply.status(400).send({ error: "IATA must be 3 letters" });
    }
    if (!name || !city || !country || !countryCode || countryCode.length !== 2) {
      return reply.status(400).send({ error: "name, city, country, countryCode (2-letter) required" });
    }
    try {
      const airport = await prisma.airport.create({
        data: {
          iata,
          icao: body.icao?.trim() || null,
          name,
          city,
          region: body.region?.trim() || null,
          country,
          countryCode,
          active: true,
        },
      });
      return reply.status(201).send({ airport });
    } catch {
      return reply.status(409).send({ error: "IATA already exists" });
    }
  });

  app.patch("/airports/:airportId", async (request, reply) => {
    const { airportId } = request.params as { airportId: string };
    const body = request.body as {
      iata?: string;
      icao?: string | null;
      name?: string;
      city?: string;
      region?: string | null;
      country?: string;
      countryCode?: string;
      active?: boolean;
    };
    const data: Record<string, unknown> = {};
    if (body.iata !== undefined) {
      const iata = body.iata.trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(iata)) {
        return reply.status(400).send({ error: "IATA must be 3 letters" });
      }
      data.iata = iata;
    }
    if (body.icao !== undefined) data.icao = body.icao?.trim() || null;
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.city !== undefined) data.city = body.city.trim();
    if (body.region !== undefined) data.region = body.region?.trim() || null;
    if (body.country !== undefined) data.country = body.country.trim();
    if (body.countryCode !== undefined) {
      const cc = body.countryCode.trim().toUpperCase();
      if (cc.length !== 2) {
        return reply.status(400).send({ error: "countryCode must be 2 letters" });
      }
      data.countryCode = cc;
    }
    if (body.active !== undefined) data.active = body.active;
    try {
      const airport = await prisma.airport.update({ where: { id: airportId }, data });
      return { airport };
    } catch {
      return reply.status(404).send({ error: "Not found (or IATA conflict)" });
    }
  });

  app.delete("/airports/:airportId", async (request, reply) => {
    const { airportId } = request.params as { airportId: string };
    try {
      await prisma.airport.delete({ where: { id: airportId } });
      return { ok: true };
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  // -------------------------------------------------------------
  // Destinations — manage the catalog used by the `destination` field.
  // -------------------------------------------------------------
  app.get("/destinations", async (request) => {
    const { q, type, includeInactive } =
      (request.query as { q?: string; type?: string; includeInactive?: string }) ??
      {};
    const term = (q ?? "").trim();
    const wantAll = includeInactive === "1" || includeInactive === "true";
    const typeFilter: { type?: DestinationType } = {};
    if (type && Object.values(DestinationType).includes(type as DestinationType)) {
      typeFilter.type = type as DestinationType;
    }
    const rows = await prisma.destination.findMany({
      where: {
        ...(wantAll ? {} : { active: true }),
        ...typeFilter,
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: "insensitive" } },
                { slug: { contains: term, mode: "insensitive" } },
                { country: { contains: term, mode: "insensitive" } },
                { region: { contains: term, mode: "insensitive" } },
                { aliases: { contains: term, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      take: 500,
    });
    return { destinations: rows };
  });

  app.post("/destinations", async (request, reply) => {
    const body = request.body as {
      slug?: string;
      name?: string;
      type?: string;
      country?: string | null;
      region?: string | null;
      aliases?: string | null;
    };
    const slug = body.slug?.trim().toLowerCase();
    const name = body.name?.trim();
    const type = body.type?.trim().toUpperCase();
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return reply.status(400).send({ error: "slug must be lowercase letters/numbers/hyphens" });
    }
    if (!name) return reply.status(400).send({ error: "name is required" });
    if (!type || !Object.values(DestinationType).includes(type as DestinationType)) {
      return reply.status(400).send({
        error: `type must be one of ${Object.values(DestinationType).join(", ")}`,
      });
    }
    try {
      const destination = await prisma.destination.create({
        data: {
          slug,
          name,
          type: type as DestinationType,
          country: body.country?.trim() || null,
          region: body.region?.trim() || null,
          aliases: body.aliases?.trim() || null,
          active: true,
        },
      });
      return reply.status(201).send({ destination });
    } catch {
      return reply.status(409).send({ error: "slug already exists" });
    }
  });

  app.patch("/destinations/:destinationId", async (request, reply) => {
    const { destinationId } = request.params as { destinationId: string };
    const body = request.body as {
      slug?: string;
      name?: string;
      type?: string;
      country?: string | null;
      region?: string | null;
      aliases?: string | null;
      active?: boolean;
    };
    const data: Record<string, unknown> = {};
    if (body.slug !== undefined) {
      const s = body.slug.trim().toLowerCase();
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) {
        return reply.status(400).send({ error: "invalid slug" });
      }
      data.slug = s;
    }
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.type !== undefined) {
      const t = body.type.trim().toUpperCase();
      if (!Object.values(DestinationType).includes(t as DestinationType)) {
        return reply.status(400).send({ error: "invalid type" });
      }
      data.type = t;
    }
    if (body.country !== undefined) data.country = body.country?.trim() || null;
    if (body.region !== undefined) data.region = body.region?.trim() || null;
    if (body.aliases !== undefined) data.aliases = body.aliases?.trim() || null;
    if (body.active !== undefined) data.active = body.active;
    try {
      const destination = await prisma.destination.update({
        where: { id: destinationId },
        data,
      });
      return { destination };
    } catch {
      return reply.status(404).send({ error: "Not found (or slug conflict)" });
    }
  });

  app.delete("/destinations/:destinationId", async (request, reply) => {
    const { destinationId } = request.params as { destinationId: string };
    try {
      await prisma.destination.delete({ where: { id: destinationId } });
      return { ok: true };
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  // ── Commerce: Products ───────────────────────────────────────────────
  app.get("/products", async () => {
    const products = await prisma.product.findMany({
      orderBy: [{ sortOrder: "asc" }, { priceCents: "asc" }],
    });
    return { products };
  });

  app.post("/products", async (request, reply) => {
    const body = request.body as {
      slug?: string;
      kind?: string;
      name?: string;
      description?: string;
      itineraryDays?: number;
      priceCents?: number;
      sortOrder?: number;
    };
    const slug = body.slug?.trim().toLowerCase();
    const name = body.name?.trim();
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return reply.status(400).send({ error: "Invalid slug" });
    }
    if (!name) return reply.status(400).send({ error: "Name required" });
    const priceCents = Number(body.priceCents);
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      return reply.status(400).send({ error: "priceCents required" });
    }
    try {
      const product = await prisma.product.create({
        data: {
          slug,
          kind: "ITINERARY_PLANNING",
          name,
          description: body.description?.trim() || null,
          itineraryDays: body.itineraryDays ?? null,
          priceCents,
          sortOrder: body.sortOrder ?? 0,
        },
      });
      return reply.status(201).send({ product });
    } catch {
      return reply.status(409).send({ error: "Slug already exists" });
    }
  });

  app.patch("/products/:productId", async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const body = request.body as {
      name?: string;
      description?: string | null;
      itineraryDays?: number | null;
      priceCents?: number;
      active?: boolean;
      sortOrder?: number;
    };
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.description !== undefined)
      data.description = body.description?.trim() || null;
    if (body.itineraryDays !== undefined)
      data.itineraryDays = body.itineraryDays;
    if (body.priceCents !== undefined) {
      const n = Number(body.priceCents);
      if (!Number.isInteger(n) || n < 0)
        return reply.status(400).send({ error: "Invalid priceCents" });
      data.priceCents = n;
      // Price changed → Stripe Price needs to be regenerated. Clear our
      // cached id so the next sync produces a fresh one.
      data.stripePriceId = null;
    }
    if (body.active !== undefined) data.active = body.active;
    if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
    try {
      const product = await prisma.product.update({
        where: { id: productId },
        data,
      });
      // Auto-sync to Stripe in the background (don't block the save).
      if (isStripeConfigured()) {
        void (async () => {
          try {
            const synced = await syncProductToStripe(product);
            await prisma.product.update({
              where: { id: product.id },
              data: { stripePriceId: synced.stripePriceId },
            });
          } catch (err) {
            app.log.error({ err }, "stripe product sync failed");
          }
        })();
      }
      return { product };
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  app.post("/products/:productId/sync-stripe", async (request, reply) => {
    if (!isStripeConfigured()) {
      return reply.status(503).send({ error: "Stripe not configured" });
    }
    const { productId } = request.params as { productId: string };
    const product = await prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) return reply.status(404).send({ error: "Not found" });
    try {
      const synced = await syncProductToStripe(product);
      const updated = await prisma.product.update({
        where: { id: product.id },
        data: { stripePriceId: synced.stripePriceId },
      });
      return { product: updated };
    } catch (err) {
      app.log.error({ err }, "stripe sync failed");
      return reply.status(500).send({ error: "Sync failed" });
    }
  });

  app.delete("/products/:productId", async (request, reply) => {
    const { productId } = request.params as { productId: string };
    try {
      await prisma.product.delete({ where: { id: productId } });
      return { ok: true };
    } catch {
      return reply
        .status(409)
        .send({ error: "Can't delete — orders reference this product. Mark it inactive instead." });
    }
  });

  // ── Commerce: Orders ─────────────────────────────────────────────────
  app.get("/orders", async (request) => {
    const q = request.query as {
      status?: string;
      isGift?: string;
      take?: string;
    };
    const take = Math.min(200, Math.max(1, Number(q.take) || 100));
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.isGift === "1" || q.isGift === "true") where.isGift = true;
    if (q.isGift === "0" || q.isGift === "false") where.isGift = false;
    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        product: { select: { name: true, slug: true } },
        buyer: { select: { id: true, name: true, email: true } },
        giftCertificate: {
          select: {
            id: true,
            code: true,
            recipientEmail: true,
            recipientName: true,
            redeemedAt: true,
          },
        },
        trips: { select: { id: true, title: true } },
      },
    });
    return { orders };
  });

  app.get("/orders/:orderId", async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        product: true,
        buyer: { select: { id: true, name: true, email: true } },
        giftCertificate: true,
        trips: {
          select: { id: true, title: true, status: true, clientId: true },
        },
      },
    });
    if (!order) return reply.status(404).send({ error: "Not found" });
    return { order };
  });

  app.post("/orders/:orderId/refund", async (request, reply) => {
    if (!isStripeConfigured()) {
      return reply.status(503).send({ error: "Stripe not configured" });
    }
    const { orderId } = request.params as { orderId: string };
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return reply.status(404).send({ error: "Not found" });
    if (!order.stripePaymentIntentId) {
      return reply.status(400).send({
        error: "No Stripe payment intent on this order — can't refund automatically.",
      });
    }
    if (order.status === "REFUNDED") {
      return reply.status(400).send({ error: "Already refunded" });
    }
    const stripe = getStripe();
    try {
      await stripe.refunds.create({
        payment_intent: order.stripePaymentIntentId,
      });
      // The refund webhook will update status; mirror it here for immediate UI.
      const updated = await prisma.order.update({
        where: { id: order.id },
        data: { status: "REFUNDED", refundedAt: new Date() },
      });
      return { order: updated };
    } catch (err) {
      app.log.error({ err }, "refund failed");
      return reply.status(500).send({ error: "Refund failed" });
    }
  });

  // ── Commerce: Gift certificates ──────────────────────────────────────
  app.get("/gift-certificates", async () => {
    const certs = await prisma.giftCertificate.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        order: {
          include: {
            product: { select: { name: true, slug: true } },
            buyer: { select: { id: true, name: true, email: true } },
          },
        },
        redeemedBy: { select: { id: true, name: true, email: true } },
        redeemedTrip: { select: { id: true, title: true } },
      },
    });
    return { giftCertificates: certs };
  });

  // ── Site navigation ──────────────────────────────────────────────────
  app.get("/site-nav", async () => {
    const row = await prisma.siteNavConfig.findUnique({
      where: { id: "default" },
    });
    const parsed = row ? parseSiteNavConfig(row.config) : null;
    return { config: parsed ?? defaultSiteNavConfig() };
  });

  app.put("/site-nav", async (request, reply) => {
    const parsed = parseSiteNavConfig(request.body);
    if (!parsed) {
      return reply.status(400).send({ error: "Invalid nav config" });
    }
    const row = await prisma.siteNavConfig.upsert({
      where: { id: "default" },
      update: { config: parsed as object },
      create: { id: "default", config: parsed as object },
    });
    return { config: parsed, updatedAt: row.updatedAt };
  });

  app.post("/site-nav/reset", async () => {
    const cfg = defaultSiteNavConfig();
    await prisma.siteNavConfig.upsert({
      where: { id: "default" },
      update: { config: cfg as object },
      create: { id: "default", config: cfg as object },
    });
    return { config: cfg };
  });

  /**
   * Resend the original gift recipient email. Use this if the recipient
   * lost the email or it landed in spam. Refuses to resend if already
   * redeemed (no point — they have a portal).
   */
  app.post("/gift-certificates/:id/resend", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await resendGiftRecipientEmail(id);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not resend";
      return reply.status(400).send({ error: msg });
    }
  });

  // -------------------------------------------------------------
  // File uploads (images for the page builder, etc.).
  // -------------------------------------------------------------
  const ALLOWED_IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/svg+xml",
  ]);
  const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB after multipart limit (10 MB)

  app.get("/uploads/status", async () => ({
    configured: isObjectStorageConfigured(),
  }));

  app.post("/uploads/image", async (request, reply) => {
    if (!isObjectStorageConfigured()) {
      return reply.status(503).send({
        error:
          "Image uploads aren't set up yet. Ask your developer to configure object storage (S3 / R2).",
      });
    }
    let part;
    try {
      part = await request.file();
    } catch (err) {
      app.log.warn({ err }, "multipart parse failed");
      return reply.status(400).send({ error: "Invalid upload" });
    }
    if (!part) {
      return reply.status(400).send({ error: "No file in request" });
    }
    const contentType = part.mimetype;
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return reply.status(415).send({
        error: `Unsupported file type (${contentType || "unknown"}). Allowed: JPG, PNG, WebP, GIF, SVG.`,
      });
    }
    const buf = await part.toBuffer();
    if (buf.length === 0) {
      return reply.status(400).send({ error: "Empty file" });
    }
    if (buf.length > MAX_IMAGE_BYTES) {
      return reply.status(413).send({
        error: `File is too large (${(buf.length / 1024 / 1024).toFixed(1)} MB). Max 8 MB.`,
      });
    }
    try {
      const result = await putObject({
        body: buf,
        contentType,
        filename: part.filename || "upload",
        prefix: "pages",
      });
      return reply.status(201).send({
        url: result.url,
        key: result.key,
        bytes: result.bytes,
        contentType: result.contentType,
      });
    } catch (err) {
      if (err instanceof ObjectStorageNotConfigured) {
        return reply.status(503).send({ error: err.message });
      }
      app.log.error({ err }, "upload failed");
      return reply.status(500).send({ error: "Upload failed" });
    }
  });

  // -------------------------------------------------------------
  // Marketing pages (homepage + any other marketing page).
  // -------------------------------------------------------------
  app.get("/pages", async () => {
    const pages = await prisma.marketingPage.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        versions: {
          orderBy: { version: "desc" },
          select: {
            id: true,
            version: true,
            label: true,
            published: true,
            updatedAt: true,
          },
        },
      },
    });
    return { pages };
  });

  app.get("/pages/:pageId", async (request, reply) => {
    const { pageId } = request.params as { pageId: string };
    const page = await prisma.marketingPage.findUnique({
      where: { id: pageId },
      include: { versions: { orderBy: { version: "desc" } } },
    });
    if (!page) return reply.status(404).send({ error: "Not found" });
    return { page };
  });

  app.post("/pages", async (request, reply) => {
    const body = request.body as {
      slug?: string;
      name?: string;
      description?: string;
    };
    if (!body.slug?.trim() || !body.name?.trim()) {
      return reply.status(400).send({ error: "slug and name are required" });
    }
    if (!slugRe.test(body.slug)) {
      return reply
        .status(400)
        .send({ error: "slug: lowercase letters, numbers, hyphens only" });
    }
    try {
      const page = await prisma.$transaction(async (tx) => {
        const p = await tx.marketingPage.create({
          data: {
            slug: body.slug!.trim(),
            name: body.name!.trim(),
            description: body.description?.trim() ?? null,
          },
        });
        await tx.marketingPageVersion.create({
          data: {
            pageId: p.id,
            version: 1,
            label: "v1",
            schema: { version: PAGE_SCHEMA_VERSION, blocks: [] } as object,
            published: true,
          },
        });
        return p;
      });
      return reply.status(201).send({ page });
    } catch {
      return reply.status(409).send({ error: "slug already exists" });
    }
  });

  app.patch("/pages/:pageId", async (request, reply) => {
    const { pageId } = request.params as { pageId: string };
    const body = request.body as {
      name?: string;
      description?: string | null;
      slug?: string;
      archived?: boolean;
    };
    if (body.slug !== undefined && !slugRe.test(body.slug)) {
      return reply.status(400).send({ error: "invalid slug" });
    }
    try {
      const page = await prisma.marketingPage.update({
        where: { id: pageId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.archived !== undefined ? { archived: body.archived } : {}),
        },
      });
      return { page };
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  app.delete("/pages/:pageId", async (request, reply) => {
    const { pageId } = request.params as { pageId: string };
    try {
      await prisma.marketingPage.delete({ where: { id: pageId } });
      return { ok: true };
    } catch {
      return reply.status(404).send({ error: "Not found" });
    }
  });

  app.post("/pages/:pageId/versions", async (request, reply) => {
    const { pageId } = request.params as { pageId: string };
    const body = request.body as { label?: string; copyFromVersionId?: string };
    const page = await prisma.marketingPage.findUnique({ where: { id: pageId } });
    if (!page) return reply.status(404).send({ error: "Page not found" });
    const max = await prisma.marketingPageVersion.aggregate({
      where: { pageId },
      _max: { version: true },
    });
    const nextV = (max._max.version ?? 0) + 1;
    let schema: object;
    if (body.copyFromVersionId) {
      const src = await prisma.marketingPageVersion.findFirst({
        where: { id: body.copyFromVersionId, pageId },
      });
      if (!src) return reply.status(400).send({ error: "Source version not found" });
      schema = src.schema as object;
    } else {
      schema = { version: PAGE_SCHEMA_VERSION, blocks: [] } as object;
    }
    const version = await prisma.marketingPageVersion.create({
      data: {
        pageId,
        version: nextV,
        label: body.label?.trim() ?? `v${nextV}`,
        schema,
        published: false,
      },
    });
    return reply.status(201).send({ version });
  });

  app.patch("/pages/:pageId/versions/:versionId", async (request, reply) => {
    const { pageId, versionId } = request.params as {
      pageId: string;
      versionId: string;
    };
    const body = request.body as { schema?: unknown; label?: string | null };
    const existing = await prisma.marketingPageVersion.findFirst({
      where: { id: versionId, pageId },
    });
    if (!existing) return reply.status(404).send({ error: "Not found" });
    if (body.schema !== undefined) {
      const parsed = parsePageSchema(body.schema);
      if (!parsed) return reply.status(400).send({ error: "Invalid schema" });
      await prisma.marketingPageVersion.update({
        where: { id: versionId },
        data: { schema: parsed as object },
      });
    }
    if (body.label !== undefined) {
      await prisma.marketingPageVersion.update({
        where: { id: versionId },
        data: { label: body.label },
      });
    }
    const version = await prisma.marketingPageVersion.findUnique({
      where: { id: versionId },
    });
    return { version };
  });

  app.post(
    "/pages/:pageId/versions/:versionId/publish",
    async (request, reply) => {
      const { pageId, versionId } = request.params as {
        pageId: string;
        versionId: string;
      };
      const v = await prisma.marketingPageVersion.findFirst({
        where: { id: versionId, pageId },
        include: { page: { select: { slug: true } } },
      });
      if (!v) return reply.status(404).send({ error: "Not found" });
      await prisma.$transaction([
        prisma.marketingPageVersion.updateMany({
          where: { pageId },
          data: { published: false },
        }),
        prisma.marketingPageVersion.update({
          where: { id: versionId },
          data: { published: true },
        }),
      ]);

      // Ping IndexNow so Bing / Yandex / Copilot / ChatGPT-search pick
      // up the new page content within hours instead of weeks. Fire-and-
      // forget; never blocks the response.
      const slug = v.page.slug;
      const origin =
        process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ??
        process.env.CLIENT_APP_ORIGIN?.replace(/\/$/, "") ??
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
        "https://momentella.com";
      // For pages that have a canonical clean URL (e.g. "/honeymoons"
      // rather than "/p/honeymoons") we should ping the canonical.
      // Otherwise fall back to /p/<slug>. We list both for safety.
      const urls = [
        `${origin}/${slug}`,
        `${origin}/p/${slug}`,
        `${origin}/sitemap.xml`,
      ];
      submitIndexNowAsync(urls, "auto");

      return { ok: true };
    },
  );
};
