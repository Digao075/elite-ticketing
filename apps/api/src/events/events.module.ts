import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { JwtConfig } from '../auth/jwt.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CatalogModule } from '../catalog/catalog.module';
import { EventPublicationController } from './event-publication.controller';
import { EventPublicationService } from './event-publication.service';
import { EventsController } from './events.controller';
import { EVENTS_CLOCK, EventsService } from './events.service';

@Module({
  imports: [AuthModule, CatalogModule],
  controllers: [EventsController, EventPublicationController],
  providers: [JwtConfig, JwtAuthGuard, EventsService, EventPublicationService, { provide: EVENTS_CLOCK, useValue: () => new Date() }],
})
export class EventsModule {}
