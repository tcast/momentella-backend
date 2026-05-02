import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rawBody from "fastify-raw-body";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "./lib/auth.js";
import { seedMarketingPages } from "./lib/seed-marketing-pages.js";
import { seedPlaces } from "./lib/seed-places.js";
import { seedProducts } from "./lib/seed-products.js";
import { seedSiteNav } from "./lib/seed-site-nav.js";
import { adminRoutes } from "./routes/admin.js";
import { adminAnalyticsRoutes } from "./routes/admin-analytics.js";
import { clientRoutes } from "./routes/client.js";
import { publicCommerceRoutes } from "./routes/public-commerce.js";
import { publicIntakeRoutes } from "./routes/public-intake.js";
import { webhookRoutes } from "./routes/webhooks.js";

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // 30 MB ceiling at the parser; per-route logic enforces tighter caps for images vs. docs.

function buildWebRequest(request: FastifyRequestLike): Request {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const headers = fromNodeHeaders(request.headers);
  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (typeof request.body === "string") {
      body = request.body;
    } else if (request.body !== undefined && request.body !== null) {
      body = JSON.stringify(request.body);
    }
  }
  return new Request(url.toString(), {
    method: request.method,
    headers,
    body,
  });
}

type FastifyRequestLike = {
  url: string;
  method: string;
  headers: import("http").IncomingHttpHeaders;
  body?: unknown;
};

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1,
      fields: 4,
    },
  });

  // Capture raw body on routes that opt in (e.g. signed webhooks).
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: "utf8",
    runFirst: true,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      const extra = (process.env.TRUSTED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const allowed = [
        process.env.CLIENT_APP_ORIGIN,
        process.env.ADMIN_APP_ORIGIN,
        process.env.BETTER_AUTH_URL,
        ...extra,
      ].filter(Boolean) as string[];
      if (!origin || allowed.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"],
  });

  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(request, reply) {
      try {
        const req = buildWebRequest(request);
        const response = await auth.handler(req);
        reply.status(response.status);
        response.headers.forEach((value, key) => {
          reply.header(key, value);
        });
        reply.send(response.body ? await response.text() : null);
      } catch (err) {
        app.log.error({ err }, "auth handler");
        reply.status(500).send({ error: "Authentication error" });
      }
    },
  });

  await app.register(clientRoutes, { prefix: "/api/client" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(adminAnalyticsRoutes, { prefix: "/api/admin/analytics" });
  await app.register(publicIntakeRoutes, { prefix: "/api/public" });
  await app.register(publicCommerceRoutes, { prefix: "/api/public" });
  await app.register(webhookRoutes, { prefix: "/api/webhooks" });

  app.get("/health", async () => ({ ok: true, service: "momentella-api" }));

  return app;
}

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const app = await buildApp();
await app.listen({ port, host });
app.log.info(`Listening on http://${host}:${port}`);

void seedPlaces()
  .then((stats) => {
    app.log.info({ stats }, "seeded airports + destinations");
  })
  .catch((err) => {
    app.log.error({ err }, "place seed failed — continuing anyway");
  });

void seedSiteNav()
  .then((stats) => {
    app.log.info({ stats }, "seeded site nav");
  })
  .catch((err) => {
    app.log.warn({ err }, "site nav seed failed");
  });

void seedMarketingPages()
  .then((stats) => {
    app.log.info({ stats }, "seeded marketing pages");
  })
  .catch((err) => {
    app.log.error({ err }, "marketing page seed failed — continuing anyway");
  });

void seedProducts()
  .then((stats) => {
    app.log.info({ stats }, "seeded products");
  })
  .catch((err) => {
    app.log.error({ err }, "product seed failed — continuing anyway");
  });
