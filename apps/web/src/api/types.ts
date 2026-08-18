export type Role = 'ORGANIZER' | 'CUSTOMER' | 'GATE';

export type EventContent = {
  providerMovieId: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string;
  runtimeMinutes: number;
  genres: string[];
  originalLanguage: string;
};

export type PublicEvent = {
  id: string;
  startsAt: string;
  endsAt: string;
  venueName: string;
  auditoriumName: string;
  priceCents: number;
  content: EventContent;
};

export type EventListEntry = PublicEvent & { capacity: number; remainingSeats: number };
export type PublicSeat = { id: string; seatLabel: string; rowLabel: string; seatNumber: number; available: boolean };
export type EventDetail = EventListEntry & { seats: PublicSeat[] };

export type Reservation = {
  id: string;
  eventId: string;
  status: 'PENDING' | 'PAID' | 'DECLINED';
  expiresAt: string;
  totalCents: number;
  seats: { seatLabel: string; rowLabel: string; seatNumber: number }[];
};

export type Ticket = {
  id: string;
  seatLabel: string;
  usedAt: string | null;
  qrPayload: string;
  shareUrlPath: string;
  event: PublicEvent;
};

export type GateOutcome = 'VALID' | 'INVALID' | 'ALREADY_USED' | 'WRONG_EVENT';
export type GateValidation = { outcome: GateOutcome; seatLabel: string | null; eventTitle: string | null; usedAt: string | null };

export type MovieSummary = {
  providerMovieId: number;
  title: string;
  releaseDate: string | null;
  posterPath: string | null;
  overview: string;
};

export type OrganizerEvent = {
  id: string;
  status: 'DRAFT' | 'PUBLISHED';
  startsAt: string;
  venueName: string;
  auditoriumName: string;
  priceCents: number | null;
  capacity: number;
  ticketsSold: number;
  remainingSeats: number;
  revenueCents: number;
  readyToPublish: boolean;
  content: { title: string; posterPath: string | null; runtimeMinutes: number; genres: string[] };
};
