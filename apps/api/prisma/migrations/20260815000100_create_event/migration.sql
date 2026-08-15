CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE "Event" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "organizerId" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "movieEndsAt" TIMESTAMPTZ(3) NOT NULL,
    "occupiedUntil" TIMESTAMPTZ(3) NOT NULL,
    "venueName" VARCHAR(120) NOT NULL,
    "auditoriumName" VARCHAR(80) NOT NULL,
    "venueKey" TEXT NOT NULL,
    "auditoriumKey" TEXT NOT NULL,
    "contentProviderMovieId" INTEGER NOT NULL,
    "contentTitle" TEXT NOT NULL,
    "contentReleaseDate" TEXT,
    "contentPosterPath" TEXT,
    "contentBackdropPath" TEXT,
    "contentOverview" TEXT NOT NULL,
    "contentRuntimeMinutes" INTEGER NOT NULL,
    "contentGenres" TEXT[] NOT NULL,
    "contentOriginalLanguage" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Event_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Event_organizerId_idempotencyKey_key" ON "Event"("organizerId", "idempotencyKey");
ALTER TABLE "Event" ADD CONSTRAINT "Event_auditorium_occupancy_excl"
  EXCLUDE USING GIST ("venueKey" WITH =, "auditoriumKey" WITH =, tstzrange("startsAt", "occupiedUntil", '[)') WITH &&);
