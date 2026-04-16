import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getSession } from "../lib/request-session.js";

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
    const [users, trips, bookingRequests] = await Promise.all([
      prisma.user.count(),
      prisma.trip.count(),
      prisma.bookingRequest.count(),
    ]);
    return { users, trips, bookingRequests };
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
};
