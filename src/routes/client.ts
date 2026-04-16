import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getSession } from "../lib/request-session.js";

/** Family client portal — session required, `role` must be `client`. */
export const clientRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    const session = await getSession(request);
    if (!session?.user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const role = session.user.role ?? "client";
    if (role !== "client") {
      return reply.status(403).send({ error: "Client portal only" });
    }
    request.clientSession = session;
  });

  app.get("/me", async (request) => {
    const { user, session } = request.clientSession!;
    return { user: { id: user.id, email: user.email, name: user.name, role: user.role }, session };
  });

  app.get("/trips", async (request) => {
    const userId = request.clientSession!.user.id;
    const trips = await prisma.trip.findMany({
      where: { clientId: userId },
      orderBy: { updatedAt: "desc" },
    });
    return { trips };
  });

  app.get("/booking-requests", async (request) => {
    const userId = request.clientSession!.user.id;
    const requests = await prisma.bookingRequest.findMany({
      where: { clientId: userId },
      orderBy: { createdAt: "desc" },
    });
    return { bookingRequests: requests };
  });
};
