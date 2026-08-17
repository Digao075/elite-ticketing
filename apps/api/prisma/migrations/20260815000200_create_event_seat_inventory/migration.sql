ALTER TABLE "Event" ADD COLUMN "priceCents" INTEGER;

CREATE TABLE "EventSeat" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eventId" UUID NOT NULL,
    "seatLabel" TEXT NOT NULL,
    "rowLabel" TEXT NOT NULL,
    "seatNumber" INTEGER NOT NULL,
    CONSTRAINT "EventSeat_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventSeat_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EventSeat_eventId_seatLabel_key" ON "EventSeat"("eventId", "seatLabel");
