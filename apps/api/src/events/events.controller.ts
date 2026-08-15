import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedRequest } from '../auth/authenticated-principal';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { type CreateEventBody, type EventDto, EventsService } from './events.service';

@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORGANIZER)
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  @Post()
  createDraft(@Req() request: AuthenticatedRequest, @Headers('idempotency-key') idempotencyKey: unknown, @Body() body: unknown): Promise<EventDto> {
    return this.eventsService.createDraft({ organizerId: request.user.id, idempotencyKey, body: body as CreateEventBody });
  }
}
