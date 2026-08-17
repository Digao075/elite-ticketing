import { BadRequestException, Body, Controller, Param, Put, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedRequest } from '../auth/authenticated-principal';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RequireStoredUser } from '../auth/stored-user.decorator';
import { type EventSeatingDto, SeatsService } from './seats.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORGANIZER)
@RequireStoredUser()
export class SeatsController {
  constructor(private readonly seatsService: SeatsService) {}

  @Put(':eventId/seats')
  replaceDraftConfiguration(@Req() request: AuthenticatedRequest, @Param('eventId') eventId: string, @Body() body: unknown): Promise<EventSeatingDto> {
    if (!UUID.test(eventId)) throw new BadRequestException('eventId must be a UUID');
    return this.seatsService.replaceDraftConfiguration(request.user.id, eventId, body);
  }
}
