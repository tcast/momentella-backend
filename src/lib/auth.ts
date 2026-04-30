import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { twoFactor } from "better-auth/plugins/two-factor";
import {
  brandedEmailHtml,
  isMailerConfigured,
  plainTextLines,
  sendEmail,
} from "./mailer.js";
import { prisma } from "./prisma.js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

/** Comma-separated extra origins for custom domains / fallbacks. */
const extraTrusted = (process.env.TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const trustedOrigins = [
  process.env.CLIENT_APP_ORIGIN,
  process.env.ADMIN_APP_ORIGIN,
  process.env.BETTER_AUTH_URL,
  ...extraTrusted,
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
        if (!isMailerConfigured()) {
          console.error(
            "[magic-link] Mailer not configured — set RESEND_API_KEY + RESEND_FROM. Magic link still printed to logs as a fallback.",
          );
          console.info(`[magic-link] to=${email}\n${url}`);
          return;
        }
        const html = brandedEmailHtml({
          eyebrow: "Sign in to Momentella",
          heading: "Your one-tap sign-in link",
          intro:
            "Click the button below to sign in. The link is good for 15 minutes; if you didn't ask for it, you can safely ignore this email.",
          cta: { label: "Sign in to Momentella", href: url },
          footerNote: `Or paste this URL into your browser: ${url}`,
        });
        const text = plainTextLines([
          "Hi,",
          "",
          "Tap to sign in to Momentella:",
          url,
          "",
          "The link is good for 15 minutes.",
        ]);
        try {
          await sendEmail({
            to: email,
            subject: "Sign in to Momentella",
            html,
            text,
          });
        } catch (err) {
          console.error("[magic-link] send failed:", err);
          // Best-effort log fallback so the user can still get in via support.
          console.info(`[magic-link] to=${email}\n${url}`);
        }
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
