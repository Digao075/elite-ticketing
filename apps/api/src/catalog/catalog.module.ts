import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { JwtConfig } from '../auth/jwt.config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CatalogController } from './catalog.controller';
import { CONTENT_SELECTION_CLOCK, CONTENT_SELECTION_SECRET, ContentSelectionTokenService } from './content-selection-token.service';
import { TMDB_FETCH, TmdbCatalogService } from './tmdb-catalog.service';

@Module({
  imports: [AuthModule],
  controllers: [CatalogController],
  providers: [
    JwtConfig,
    JwtAuthGuard,
    TmdbCatalogService,
    ContentSelectionTokenService,
    {
      provide: CONTENT_SELECTION_CLOCK,
      useValue: () => new Date(),
    },
    {
      provide: CONTENT_SELECTION_SECRET,
      useFactory: () => {
        const secret = process.env.CONTENT_SELECTION_SECRET;
        if (typeof secret !== 'string' || secret.trim() === '') throw new Error('CONTENT_SELECTION_SECRET is required');
        return secret;
      },
    },
    {
      provide: TMDB_FETCH,
      useValue: globalThis.fetch,
    },
  ],
  exports: [ContentSelectionTokenService],
})
export class CatalogModule {}
