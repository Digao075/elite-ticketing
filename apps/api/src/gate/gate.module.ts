import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { JwtConfig } from '../auth/jwt.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TicketsModule } from '../tickets/tickets.module';
import { GateController } from './gate.controller';
import { GateService } from './gate.service';

@Module({
  imports: [AuthModule, TicketsModule],
  controllers: [GateController],
  providers: [JwtConfig, JwtAuthGuard, GateService],
})
export class GateModule {}
