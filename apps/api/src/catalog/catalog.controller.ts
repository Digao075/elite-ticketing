import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { type CatalogMovieSummary, TmdbCatalogService } from './tmdb-catalog.service';

const INVALID_QUERY_MESSAGE = 'query must contain 1 to 100 characters after trimming';

@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORGANIZER)
export class CatalogController {
  constructor(private readonly tmdbCatalogService: TmdbCatalogService) {}

  @Get('movies')
  async searchMovies(@Query('query') query: unknown): Promise<CatalogMovieSummary[]> {
    if (typeof query !== 'string') {
      throw new BadRequestException(INVALID_QUERY_MESSAGE);
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0 || trimmedQuery.length > 100) {
      throw new BadRequestException(INVALID_QUERY_MESSAGE);
    }

    return this.tmdbCatalogService.searchMovies(trimmedQuery);
  }
}
