/**
 * LOCAL / STAGING seed — makes the app realistic to click through:
 *   1. upserts the admin account from ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD
 *   2. gives every published design a 6-photo gallery (keeps any real photos first)
 *   3. ensures a useful menu of plan-change (modification) options exists
 *   4. gives designs without add-ons two sample add-ons
 *
 * Idempotent: safe to run repeatedly. Refuses to run with NODE_ENV=production.
 *
 * Usage: npm run script:seed
 */
import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

const unsplash = (id: string) => `https://images.unsplash.com/${id}?w=1200&q=80&auto=format&fit=crop`;

// Every id below is verified to load (HTTP 200).
const EXTERIORS = [
  'photo-1600607687939-ce8a6c25118c',
  'photo-1600596542815-ffad4c1539a9',
  'photo-1600047509807-ba8f99d2cdde',
  'photo-1523217582562-09d0def993a6',
  'photo-1449844908441-8829872d2607',
  'photo-1576941089067-2de3c901e126',
  'photo-1600585152220-90363fe7e115',
  'photo-1613977257363-707ba9348227',
  'photo-1580587771525-78b9dba3b914',
  'photo-1484154218962-a197022b5858',
].map(unsplash);

const INTERIORS = [
  'photo-1600210492486-724fe5c67fb0',
  'photo-1560448204-e02f11c3d0e2',
  'photo-1600566753190-17f0baa2a6c3',
  'photo-1600210491892-03d54c0aaf87',
  'photo-1518780664697-55e3ad937233',
  'photo-1600566752355-35792bedcfea',
  'photo-1494526585095-c41746248156',
  'photo-1502672260266-1c1ef2d93688',
].map(unsplash);

const GALLERY_SIZE = 6;

const MODIFICATION_OPTIONS = [
  { label: 'Add a room', description: 'An extra bedroom or study added to the plan.', addedCostCents: 50000 },
  { label: 'Resize footprint', description: 'Scale the overall footprint up or down.', addedCostCents: 35000 },
  { label: 'Add a bathroom', description: 'A full or half bath, plumbing-aware.', addedCostCents: 30000 },
  { label: 'Open-plan kitchen', description: 'Remove walls to open kitchen/living space.', addedCostCents: 25000 },
  { label: 'Add a porch or deck', description: 'Covered porch or timber deck.', addedCostCents: 20000 },
  { label: 'Garage / carport', description: 'Attached garage or carport.', addedCostCents: 40000 },
];

const SAMPLE_ADD_ONS = [
  { label: 'Material take-off list', description: 'Itemised quantities for quoting.', addedCostCents: 15000 },
  { label: '3D render pack', description: 'Four photoreal exterior/interior renders.', addedCostCents: 25000 },
];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic, varied mix of exteriors + interiors per design. */
function galleryFor(slug: string, existing: string[], cover: string): string[] {
  const seed = hash(slug);
  const picks: string[] = [];
  for (let i = 0; i < 3; i++) picks.push(EXTERIORS[(seed + i * 3) % EXTERIORS.length]);
  for (let i = 0; i < 4; i++) picks.push(INTERIORS[(seed + i * 2) % INTERIORS.length]);
  const merged = [...existing, ...picks].filter((url, i, all) => url !== cover && all.indexOf(url) === i);
  return merged.slice(0, Math.max(GALLERY_SIZE, existing.length));
}

async function uniqueReferralCode(firstName: string): Promise<string> {
  const base = firstName.replace(/[^a-zA-Z]/g, '').slice(0, 6).toUpperCase() || 'UMER';
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = `${base}-${randomBytes(3).toString('hex').toUpperCase()}`;
    if (!(await prisma.user.findUnique({ where: { referralCode: candidate } }))) return candidate;
  }
  throw new Error('Could not generate a unique referral code.');
}

async function seedAdmin(): Promise<void> {
  const email = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_SEED_PASSWORD;
  if (!email || !password) {
    console.log('• admin: skipped (set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD)');
    return;
  }
  const passwordHash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_SALT_ROUNDS ?? '12', 10));
  const existing = await prisma.user.findFirst({ where: { email } });
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash, role: Role.ADMIN, deletedAt: null },
    });
    console.log(`• admin: updated ${email} (role ADMIN, password reset from env)`);
    return;
  }
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      role: Role.ADMIN,
      referralCode: await uniqueReferralCode('Admin'),
    },
  });
  console.log(`• admin: created ${email}`);
}

async function seedGalleries(): Promise<void> {
  const designs = await prisma.design.findMany({ where: { status: 'PUBLISHED' } });
  let updated = 0;
  for (const d of designs) {
    if (d.galleryUrls.length >= GALLERY_SIZE) continue;
    await prisma.design.update({
      where: { id: d.id },
      data: { galleryUrls: galleryFor(d.slug, d.galleryUrls, d.coverImageUrl) },
    });
    updated++;
  }
  console.log(`• galleries: ${updated} design(s) now have ${GALLERY_SIZE}+ photos`);
}

async function seedModificationOptions(): Promise<void> {
  let created = 0;
  for (const option of MODIFICATION_OPTIONS) {
    const existing = await prisma.modificationOption.findFirst({ where: { label: option.label } });
    if (existing) continue;
    await prisma.modificationOption.create({ data: { ...option, active: true } });
    created++;
  }
  console.log(`• modification options: ${created} added (${MODIFICATION_OPTIONS.length} in the menu)`);
}

async function seedAddOns(): Promise<void> {
  const designs = await prisma.design.findMany({
    where: { status: 'PUBLISHED' },
    include: { _count: { select: { addOns: true } } },
  });
  let seeded = 0;
  for (const d of designs) {
    if (d._count.addOns > 0) continue;
    await prisma.designAddOn.createMany({
      data: SAMPLE_ADD_ONS.map((a) => ({ ...a, designId: d.id, active: true })),
    });
    seeded++;
  }
  console.log(`• add-ons: sample add-ons added to ${seeded} design(s)`);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed with NODE_ENV=production.');
    process.exit(1);
  }
  await seedAdmin();
  await seedGalleries();
  await seedModificationOptions();
  await seedAddOns();
  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
