CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'PAID', 'DECLINED');

CREATE TABLE "Reservation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eventId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Reservation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Reservation_customerId_idx" ON "Reservation"("customerId");
CREATE INDEX "Reservation_eventId_idx" ON "Reservation"("eventId");

CREATE TABLE "SeatAllocation" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "eventSeatId" UUID NOT NULL,
    "reservationId" UUID NOT NULL,
    "releasedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeatAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SeatAllocation_eventSeatId_fkey" FOREIGN KEY ("eventSeatId") REFERENCES "EventSeat"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeatAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SeatAllocation_reservationId_idx" ON "SeatAllocation"("reservationId");
CREATE INDEX "SeatAllocation_eventSeatId_idx" ON "SeatAllocation"("eventSeatId");

-- The single-sale invariant. Only one unreleased allocation may exist per seat,
-- so a double booking is refused by PostgreSQL rather than by application code.
CREATE UNIQUE INDEX "SeatAllocation_eventSeatId_live_key"
    ON "SeatAllocation"("eventSeatId") WHERE "releasedAt" IS NULL;

CREATE TABLE "Ticket" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservationId" UUID NOT NULL,
    "eventSeatId" UUID NOT NULL,
    "shareToken" TEXT NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Ticket_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Ticket_eventSeatId_fkey" FOREIGN KEY ("eventSeatId") REFERENCES "EventSeat"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Ticket_eventSeatId_key" ON "Ticket"("eventSeatId");
CREATE UNIQUE INDEX "Ticket_shareToken_key" ON "Ticket"("shareToken");
CREATE INDEX "Ticket_reservationId_idx" ON "Ticket"("reservationId");
