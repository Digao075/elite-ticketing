import type { Request } from 'express';

export type AuthenticatedPrincipal = {
  id: string;
  role?: 'ORGANIZER' | 'CUSTOMER' | 'GATE';
};

export type AuthenticatedRequest = Request & {
  user: AuthenticatedPrincipal;
};
