import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { DatabaseModule } from './database/database.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { EventsModule } from './events/events.module';
import { GateModule } from './gate/gate.module';
import { OrganizerModule } from './organizer/organizer.module';
import { ReservationsModule } from './reservations/reservations.module';
import { TicketsModule } from './tickets/tickets.module';
import { HealthController } from './health.controller';
import { SeatsModule } from './seats/seats.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    DatabaseModule,
    UsersModule,
    AuthModule,
    CatalogModule,
    EventsModule,
    SeatsModule,
    DiscoveryModule,
    TicketsModule,
    ReservationsModule,
    GateModule,
    OrganizerModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
