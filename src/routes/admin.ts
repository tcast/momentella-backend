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
  isObjectStorageConfigured,
  putObject,
} from "../lib/object-storage.js";
import { convertIntakeToTrip } from "../lib/intake-to-trip.js";
import { parseItinerarySchema } from "../lib/itinerary-schema.js";
import { TripKind, TripStatus } from "@prisma/client";

const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
      return { ok: true };
    },
  );
};
