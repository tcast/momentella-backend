import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { twoFactor } from "better-auth/plugins/two-factor";
import { prisma } from "./prisma.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

const trustedOrigins = [
  process.env.CLIENT_APP_ORIGIN,
  process.env.ADMIN_APP_ORIGIN,
  process.env.BETTER_AUTH_URL,
  "http://localhost:3000",
  "http://localhost:3015",
].filter((o): o is string => Boolean(o));

export const auth = betterAuth({
  secret: requireEnv("BETTER_AUTH_SECRET"),
  baseURL: requireEnv("BETTER_AUTH_URL"),
  basePath: "/api/auth",
  trustedOrigins: trustedOrigins.length ? trustedOrigins : ["http://localhost:4000"],
  advanced: {
    defaultCookieAttributes: {
      sameSite: "lax",
    },
  },
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        if (process.env.NODE_ENV === "production" && !process.env.RESEND_API_KEY) {
          console.error(
            "[magic-link] Set RESEND_API_KEY (or wire sendMagicLink) before relying on magic links in production.",
          );
        }
        console.info(`[magic-link] to=${email}\n${url}`);
      },
      expiresIn: 60 * 15,
    }),
    twoFactor({ issuer: "Momentella" }),
    admin({
      defaultRole: "client",
      adminRoles: ["admin"],
    }),
  ],
});
