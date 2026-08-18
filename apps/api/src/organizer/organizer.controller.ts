import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedRequest } from '../auth/authenticated-principal';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RequireStoredUser } from '../auth/stored-user.decorator';
import { OrganizerService, type OrganizerEventDto } from './organizer.service';

/**
 * Deliberately mounted under `organizer` rather than as `GET /events/mine`.
 * The events controller already owns `GET /events/:eventId`, so a literal
 * sibling segment would depend on route registration order to win — a fragile
 * thing to rely on when a future refactor can reorder module imports.
 */
@Controller('organizer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORGANIZER)
@RequireStoredUser()
export class OrganizerController {
  constructor(private readonly organizer: OrganizerService) {}

  @Get('events')
  listOwnEvents(@Req() request: AuthenticatedRequest): Promise<OrganizerEventDto[]> {
    return this.organizer.listOwnEvents(request.user.id);
  }
}
