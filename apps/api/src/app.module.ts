import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { DatabaseModule } from './database/database.module';
import { EventsModule } from './events/events.module';
import { HealthController } from './health.controller';
import { UsersModule } from './users/users.module';

@Module({
  imports: [DatabaseModule, UsersModule, AuthModule, CatalogModule, EventsModule],
  controllers: [HealthController],
})
export class AppModule {}
