import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { resolve } from 'node:path';

// Prisma's config file disables its own .env loading, so the seed reads the
// repository .env itself and a reviewer can run `pnpm db:seed` with no setup.
try {
  process.loadEnvFile(resolve(__dirname, '../../../.env'));
} catch {
  // Falls through to whatever the shell already exported.
}

/**
 * Deterministic demo data so a reviewer can walk the whole journey without
 * building anything first. Every write is an upsert keyed on a fixed id, so
 * running this repeatedly converges on the same state instead of duplicating.
 */
const prisma = new PrismaClient();

const PASSWORD = 'Elite@2026';
const ORGANIZER_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER_ONE_ID = '22222222-2222-4222-8222-222222222222';
const CUSTOMER_TWO_ID = '33333333-3333-4333-8333-333333333333';
const GATE_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const IDEMPOTENCY_KEY = '66666666-6666-4666-8666-666666666666';

const ROWS = [
  { label: 'A', seats: 8 },
  { label: 'B', seats: 8 },
  { label: 'C', seats: 8 },
];

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  const people = [
    { id: ORGANIZER_ID, email: 'organizador@elite.test', role: Role.ORGANIZER },
    { id: CUSTOMER_ONE_ID, email: 'cliente1@elite.test', role: Role.CUSTOMER },
    { id: CUSTOMER_TWO_ID, email: 'cliente2@elite.test', role: Role.CUSTOMER },
    { id: GATE_ID, email: 'portaria@elite.test', role: Role.GATE },
  ];

  for (const person of people) {
    await prisma.user.upsert({
      where: { id: person.id },
      update: { email: person.email, role: person.role, passwordHash },
      create: { ...person, passwordHash },
    });
  }

  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const movieEndsAt = new Date(startsAt.getTime() + 139 * 60_000);
  const content = {
    contentProviderMovieId: 550,
    contentTitle: 'Clube da Luta',
    contentReleaseDate: '1999-10-15',
    contentPosterPath: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
    contentBackdropPath: '/hZkgoQYus5vegHoetLkCJzb17zJ.jpg',
    contentOverview:
      'Um funcionario insone e um vendedor de sabonetes criam um clube de luta clandestino que escapa ao seu controle.',
    contentRuntimeMinutes: 139,
    contentGenres: ['Drama'],
    contentOriginalLanguage: 'en',
  };

  await prisma.event.upsert({
    where: { id: EVENT_ID },
    update: { status: 'PUBLISHED', priceCents: 3500, startsAt, movieEndsAt, occupiedUntil: new Date(movieEndsAt.getTime() + 30 * 60_000), ...content },
    create: {
      id: EVENT_ID,
      organizerId: ORGANIZER_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      status: 'PUBLISHED',
      priceCents: 3500,
      startsAt,
      movieEndsAt,
      occupiedUntil: new Date(movieEndsAt.getTime() + 30 * 60_000),
      venueName: 'Cine Elite Centro',
      auditoriumName: 'Sala 1',
      venueKey: 'cine-elite-centro',
      auditoriumKey: 'sala-1',
      ...content,
    },
  });

  for (const row of ROWS) {
    for (let seatNumber = 1; seatNumber <= row.seats; seatNumber += 1) {
      const seatLabel = `${row.label}${seatNumber}`;
      await prisma.eventSeat.upsert({
        where: { eventId_seatLabel: { eventId: EVENT_ID, seatLabel } },
        update: {},
        create: { eventId: EVENT_ID, seatLabel, rowLabel: row.label, seatNumber },
      });
    }
  }

  const seatCount = await prisma.eventSeat.count({ where: { eventId: EVENT_ID } });
  console.log('Seed complete.');
  console.log(`  organizer  organizador@elite.test / ${PASSWORD}`);
  console.log(`  customers  cliente1@elite.test, cliente2@elite.test / ${PASSWORD}`);
  console.log(`  gate       portaria@elite.test / ${PASSWORD}`);
  console.log(`  event      "Clube da Luta" PUBLISHED with ${seatCount} seats at R$ 35,00`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
