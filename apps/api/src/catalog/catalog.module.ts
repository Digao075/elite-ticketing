import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { JwtConfig } from '../auth/jwt.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CatalogController } from './catalog.controller';
import { TMDB_FETCH, TmdbCatalogService } from './tmdb-catalog.service';

@Module({
  imports: [AuthModule],
  controllers: [CatalogController],
  providers: [
    JwtConfig,
    JwtAuthGuard,
    TmdbCatalogService,
    {
      provide: TMDB_FETCH,
      useValue: globalThis.fetch,
    },
  ],
})
export class CatalogModule {}
