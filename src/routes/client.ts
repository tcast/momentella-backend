import type { FastifyPluginAsync } from "fastify";
import { ProposalStatus } from "@prisma/client";
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

  app.get("/trips/:tripId", async (request, reply) => {
    const userId = request.clientSession!.user.id;
    const { tripId } = request.params as { tripId: string };
    const trip = await prisma.trip.findFirst({
      where: { id: tripId, clientId: userId },
      // Internal trip notes are deliberately omitted.
      include: {
        proposals: {
          orderBy: { version: "desc" },
          take: 1,
          select: {
            id: true,
            version: true,
            status: true,
            message: true,
            schema: true,
            publishedByName: true,
            respondedAt: true,
            responderName: true,
            responseNote: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        messages: { orderBy: { createdAt: "asc" } },
        bookings: {
          // Hide draft / cancelled rows — those aren't ready for the family.
          where: { status: { in: ["PENDING", "CONFIRMED"] } },
          orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
          // Note: cost, costNotes, vendorUrl, notes are intentionally omitted.
          select: {
            id: true,
            kind: true,
            status: true,
            title: true,
            vendorName: true,
            bookingRef: true,
            bookedBy: true,
            startDate: true,
            endDate: true,
            description: true,
          },
        },
        documents: {
          where: { visibleToClient: true },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            name: true,
            url: true,
            contentType: true,
            size: true,
            createdAt: true,
            bookingId: true,
          },
        },
      },
    });
    if (!trip) return reply.status(404).send({ error: "Not found" });
    return { trip };
  });

  app.post(
    "/trips/:tripId/proposals/:proposalId/respond",
    async (request, reply) => {
      const userId = request.clientSession!.user.id;
      const { tripId, proposalId } = request.params as {
        tripId: string;
        proposalId: string;
      };
      const body = request.body as { decision?: string; note?: string };
      const map: Record<string, ProposalStatus> = {
        approve: ProposalStatus.APPROVED,
        request_changes: ProposalStatus.CHANGES_REQUESTED,
      };
      if (!body.decision || !(body.decision in map)) {
        return reply.status(400).send({ error: "decision required" });
      }
      const trip = await prisma.trip.findFirst({
        where: { id: tripId, clientId: userId },
        select: { id: true },
      });
      if (!trip) return reply.status(404).send({ error: "Trip not found" });
      const proposal = await prisma.proposal.findFirst({
        where: { id: proposalId, tripId },
      });
      if (!proposal)
        return reply.status(404).send({ error: "Proposal not found" });
      const responder = request.clientSession!.user;
      const responseNote = body.note?.trim() || null;
      const updated = await prisma.$transaction(async (tx) => {
        const p = await tx.proposal.update({
          where: { id: proposalId },
          data: {
            status: map[body.decision!]!,
            respondedAt: new Date(),
            responderId: responder.id,
            responderName: responder.name ?? responder.email,
            responseNote,
          },
        });
        // Drop a system message on the thread so the admin sees it inline.
        const decisionLabel =
          map[body.decision!] === ProposalStatus.APPROVED
            ? `Approved proposal v${proposal.version}`
            : `Requested changes on proposal v${proposal.version}`;
        const messageBody = responseNote
          ? `[${decisionLabel}] ${responseNote}`
          : `[${decisionLabel}]`;
        await tx.tripMessage.create({
          data: {
            tripId,
            authorId: responder.id,
            authorName: responder.name ?? responder.email,
            authorRole: "client",
            body: messageBody,
          },
        });
        return p;
      });
      return { proposal: updated };
    },
  );

  app.get("/trips/:tripId/messages", async (request, reply) => {
    const userId = request.clientSession!.user.id;
    const { tripId } = request.params as { tripId: string };
    const trip = await prisma.trip.findFirst({
      where: { id: tripId, clientId: userId },
      select: { id: true },
    });
    if (!trip) return reply.status(404).send({ error: "Trip not found" });
    const messages = await prisma.tripMessage.findMany({
      where: { tripId },
      orderBy: { createdAt: "asc" },
    });
    return { messages };
  });

  app.post("/trips/:tripId/messages", async (request, reply) => {
    const userId = request.clientSession!.user.id;
    const { tripId } = request.params as { tripId: string };
    const body = request.body as { body?: string };
    const text = (body.body ?? "").trim();
    if (!text)
      return reply.status(400).send({ error: "Message cannot be empty" });
    const trip = await prisma.trip.findFirst({
      where: { id: tripId, clientId: userId },
      select: { id: true },
    });
    if (!trip) return reply.status(404).send({ error: "Trip not found" });
    const author = request.clientSession!.user;
    const message = await prisma.tripMessage.create({
      data: {
        tripId,
        authorId: author.id,
        authorName: author.name ?? author.email,
        authorRole: "client",
        body: text,
      },
    });
    return reply.status(201).send({ message });
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
