import type { auth } from "../lib/auth.js";

export type AppSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

declare module "fastify" {
  interface FastifyRequest {
    clientSession?: AppSession;
    adminSession?: AppSession;
  }
}
