import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedRequest } from '../auth/authenticated-principal';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RequireStoredUser } from '../auth/stored-user.decorator';
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

  @Get(':eventId')
  @RequireStoredUser()
  findOwnedById(@Req() request: AuthenticatedRequest, @Param('eventId') eventId: string): Promise<EventDto> {
    if (!UUID.test(eventId)) throw new BadRequestException('eventId must be a UUID');
    return this.eventsService.findOwnedById(request.user.id, eventId);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
