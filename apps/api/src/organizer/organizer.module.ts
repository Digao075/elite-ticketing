import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { JwtConfig } from '../auth/jwt.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrganizerController } from './organizer.controller';
import { OrganizerService } from './organizer.service';

@Module({
  imports: [AuthModule],
  controllers: [OrganizerController],
  providers: [JwtConfig, JwtAuthGuard, OrganizerService],
})
export class OrganizerModule {}
