/**
 * Creates or updates a user directly in the database, bypassing the
 * self-registration API (which can never set role=ADMIN). Used to
 * provision the first admin account.
 *
 * Usage:
 *   npm run script:user:upsert -- --email=admin@example.com --password=... --role=ADMIN [--firstName=Admin] [--lastName=User]
 */
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

async function generateUniqueReferralCode(firstName: string): Promise<string> {
  const base =
    firstName
      .replace(/[^a-zA-Z]/g, '')
      .slice(0, 6)
      .toUpperCase() || 'UMER';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = randomBytes(3).toString('hex').toUpperCase();
    const candidate = `${base}-${suffix}`;
    const existing = await prisma.user.findUnique({ where: { referralCode: candidate } });
    if (!existing) return candidate;
  }
  throw new Error('Failed to generate a unique referral code after 10 attempts.');
}

async function main() {
  const args = parseArgs();
  const email = args.email?.toLowerCase();
  const password = args.password;
  const role = (args.role ?? 'ADMIN') as Role;
  const firstName = args.firstName ?? 'Admin';
  const lastName = args.lastName ?? 'User';

  if (!email || !password) {
    console.error(
      'Usage: script:user:upsert -- --email=... --password=... [--role=ADMIN] [--firstName=...] [--lastName=...]',
    );
    process.exit(1);
  }
  if (!Object.values(Role).includes(role)) {
    console.error(`Invalid role "${role}". Expected one of: ${Object.values(Role).join(', ')}`);
    process.exit(1);
  }

  const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10);
  const passwordHash = await bcrypt.hash(password, saltRounds);

  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, role, deletedAt: null },
    });
    console.log(`Updated existing user ${user.email} -> role=${user.role}`);
    return;
  }

  const referralCode = await generateUniqueReferralCode(firstName);
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName, lastName, role, referralCode },
  });
  console.log(`Created user ${user.email} -> role=${user.role}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
