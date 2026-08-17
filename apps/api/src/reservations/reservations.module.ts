import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { JwtConfig } from '../auth/jwt.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TicketsModule } from '../tickets/tickets.module';
import { ReservationsController } from './reservations.controller';
import { RESERVATIONS_CLOCK, ReservationsService } from './reservations.service';

@Module({
  imports: [AuthModule, TicketsModule],
  controllers: [ReservationsController],
  providers: [JwtConfig, JwtAuthGuard, ReservationsService, { provide: RESERVATIONS_CLOCK, useValue: () => new Date() }],
})
export class ReservationsModule {}
