import { Controller, Get, Param } from '@nestjs/common';

import { DiscoveryService, type EventDetailDto, type EventListEntryDto } from './discovery.service';

/** Public browsing. Deliberately unauthenticated: customers compare events before signing in. */
@Controller('events')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Get()
  list(): Promise<EventListEntryDto[]> {
    return this.discovery.list();
  }

  @Get(':eventId/public')
  findPublished(@Param('eventId') eventId: string): Promise<EventDetailDto> {
    return this.discovery.findPublished(eventId);
  }
}
