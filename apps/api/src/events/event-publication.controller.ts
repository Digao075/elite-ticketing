import { BadRequestException, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedRequest } from '../auth/authenticated-principal';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RequireStoredUser } from '../auth/stored-user.decorator';
import { EventPublicationService, type PublishedEventDto } from './event-publication.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORGANIZER)
@RequireStoredUser()
export class EventPublicationController {
  constructor(private readonly publication: EventPublicationService) {}

  @Post(':eventId/publish')
  publish(@Req() request: AuthenticatedRequest, @Param('eventId') eventId: string): Promise<PublishedEventDto> {
    if (!UUID.test(eventId)) throw new BadRequestException('eventId must be a UUID');
    return this.publication.publish(request.user.id, eventId);
  }
}
