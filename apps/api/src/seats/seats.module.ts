import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { JwtConfig } from '../auth/jwt.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SeatsController } from './seats.controller';
import { SeatsService } from './seats.service';

@Module({
  imports: [AuthModule],
  controllers: [SeatsController],
  providers: [JwtConfig, JwtAuthGuard, SeatsService],
})
export class SeatsModule {}
