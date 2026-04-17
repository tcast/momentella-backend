import type { FastifyPluginAsync } from "fastify";
import { DestinationType, IntakeSubmissionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getSession } from "../lib/request-session.js";
import {
  defaultFamilyTripSchema,
  FORM_SCHEMA_VERSION,
  parseIntakeFormSchema,
} from "../lib/intake-schema.js";

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

  app.get("/trips", async () => {
    const rows = await prisma.trip.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return { trips: rows };
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
    const submissions = await prisma.intakeSubmission.findMany({
      where: q.formId ? { formId: q.formId } : undefined,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        form: { select: { name: true, slug: true } },
        formVersion: { select: { version: true, label: true } },
      },
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
};
