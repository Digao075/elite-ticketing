import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { JwtConfig } from '../auth/jwt.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TicketQrService } from './ticket-qr.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [AuthModule],
  controllers: [TicketsController],
  providers: [JwtConfig, JwtAuthGuard, TicketQrService, TicketsService],
  exports: [TicketQrService],
})
export class TicketsModule {}
