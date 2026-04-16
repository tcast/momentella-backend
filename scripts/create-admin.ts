/**
 * Bootstrap or promote an admin user (email + password credential).
 * Run: railway run -s api npx tsx scripts/create-admin.ts [email] [displayName]
 */
import { randomBytes } from "node:crypto";
import { auth } from "../src/lib/auth.js";
import { prisma } from "../src/lib/prisma.js";

const email = (process.argv[2] ?? "tcast@att.net").toLowerCase();
const name = process.argv[3] ?? "Momentella Admin";

function randomPassword(): string {
  return `${randomBytes(14).toString("base64url")}Aa1!`;
}

async function main() {
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: {
        role: "admin",
        emailVerified: true,
        banned: false,
        banReason: null,
        banExpires: null,
      },
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          action: "promoted_existing_to_admin",
          email,
          note: "Password unchanged. Use your existing password, or magic link, or reset flow if needed.",
        },
        null,
        2,
      ),
    );
    return;
  }

  const password = randomPassword();

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
