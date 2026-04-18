/**
 * Bootstrap or promote an admin user (email + password credential).
 *
 * Run (random password):
 *   railway run -s api npx tsx scripts/create-admin.ts [email] [displayName]
 *
 * Run (explicit password, avoid shell history leaks):
 *   ADMIN_PASSWORD='S3cret!' railway run -s api \
 *     npx tsx scripts/create-admin.ts [email] [displayName]
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { auth } from "../src/lib/auth.js";
import { prisma } from "../src/lib/prisma.js";

const email = (process.argv[2] ?? "tcast@att.net").toLowerCase();
const name = process.argv[3] ?? "Momentella Admin";
const explicitPassword = process.env.ADMIN_PASSWORD?.trim() || null;

function randomPassword(): string {
  return `${randomBytes(14).toString("base64url")}Aa1!`;
}

function pickPassword(): string {
  return explicitPassword ?? randomPassword();
}

async function main() {
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    const password = pickPassword();
    const hashed = await hashPassword(password);

    await prisma.user.update({
      where: { email },
      data: {
        role: "admin",
        emailVerified: true,
        banned: false,
        banReason: null,
        banExpires: null,
        name,
      },
    });

    const credential = await prisma.account.findFirst({
      where: { userId: existing.id, providerId: "credential" },
    });

    if (!credential) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            action: "promoted_existing_to_admin_no_credential_account",
            email,
            note: "User has no email/password account (credential). Use magic link or add a password in the DB.",
          },
          null,
          2,
        ),
      );
      return;
    }

    await prisma.account.update({
      where: { id: credential.id },
      data: { password: hashed },
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          action: "reset_password_and_promoted_admin",
          email,
          password,
          note: "New password set. Store it securely; it is not saved anywhere else.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const password = pickPassword();

  const res = await auth.api.signUpEmail({
    body: { email, name, password },
  });

  if (!res || typeof res !== "object") {
    console.error("Unexpected sign-up response:", res);
    process.exit(1);
  }

  if ("error" in res && res.error) {
    console.error(JSON.stringify(res.error, null, 2));
    process.exit(1);
  }

  await prisma.user.update({
    where: { email },
    data: { role: "admin", emailVerified: true },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        action: "created_admin",
        email,
        password,
        note: "Store this password securely; it is not saved anywhere else.",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
