import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getSession } from "../lib/request-session.js";
import { parseIntakeFormSchema } from "../lib/intake-schema.js";
import {
  sanitizeResponses,
  validateIntakeResponses,
} from "../lib/validate-intake-response.js";

const slugRe = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Public intake — no auth required; optional session links submission to user. */
export const publicIntakeRoutes: FastifyPluginAsync = async (app) => {
  app.get("/intake-forms/:slug", async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    if (!slugRe.test(slug)) {
      return reply.status(400).send({ error: "Invalid slug" });
    }
    const form = await prisma.intakeForm.findUnique({
      where: { slug },
      include: {
        versions: {
          where: { published: true },
          take: 1,
          orderBy: { version: "desc" },
        },
      },
    });
    if (!form || form.versions.length === 0) {
      return reply.status(404).send({ error: "Form not found" });
    }
    const v = form.versions[0]!;
    const schema = parseIntakeFormSchema(v.schema);
    if (!schema) {
      return reply.status(500).send({ error: "Invalid form definition" });
    }
    return {
      form: {
        id: form.id,
        slug: form.slug,
        name: form.name,
        description: form.description,
      },
      version: {
        id: v.id,
        version: v.version,
        label: v.label,
        schema,
      },
    };
  });

  app.post("/intake-forms/:slug/submit", async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    if (!slugRe.test(slug)) {
      return reply.status(400).send({ error: "Invalid slug" });
    }
    const body = request.body as {
      email?: string;
      responses?: Record<string, unknown>;
      website?: string;
    };
    if (body.website) {
      return reply.status(400).send({ error: "Invalid request" });
    }
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply.status(400).send({ error: "Valid email is required" });
    }
    if (!body.responses || typeof body.responses !== "object") {
      return reply.status(400).send({ error: "responses object required" });
    }

    const form = await prisma.intakeForm.findUnique({
      where: { slug },
      include: {
        versions: {
          where: { published: true },
          take: 1,
          orderBy: { version: "desc" },
        },
      },
    });
    if (!form || form.versions.length === 0) {
      return reply.status(404).send({ error: "Form not found" });
    }
    const v = form.versions[0]!;
    const schema = parseIntakeFormSchema(v.schema);
    if (!schema) {
      return reply.status(500).send({ error: "Invalid form definition" });
    }

    const raw = body.responses as Record<string, unknown>;
    const responses = sanitizeResponses(schema, raw);
    const err = validateIntakeResponses(schema, responses);
    if (err) {
      return reply.status(400).send({ error: err });
    }

    const session = await getSession(request);
    const clientId = session?.user?.id ?? null;

    const row = await prisma.intakeSubmission.create({
      data: {
        formId: form.id,
        formVersionId: v.id,
        email,
        responses: responses as object,
        clientId: clientId ?? undefined,
      },
    });

    return reply.status(201).send({
      id: row.id,
      message: "Thank you — we received your trip intake.",
    });
  });
};
