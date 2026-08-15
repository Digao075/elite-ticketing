import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { type CatalogMovieDetail, type CatalogMovieSummary, TmdbCatalogService } from './tmdb-catalog.service';

const INVALID_QUERY_MESSAGE = 'query must contain 1 to 100 characters after trimming';
const INVALID_PROVIDER_MOVIE_ID_MESSAGE = 'providerMovieId must be a positive 32-bit integer';

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

  @Get('movies/popular')
  listPopularMovies(): Promise<CatalogMovieSummary[]> {
    return this.tmdbCatalogService.listPopularMovies();
  }

  @Get('movies/:providerMovieId')
  getMovieDetails(@Param('providerMovieId') providerMovieId: string): Promise<CatalogMovieDetail> {
    if (!/^[1-9][0-9]*$/.test(providerMovieId)) {
      throw new BadRequestException(INVALID_PROVIDER_MOVIE_ID_MESSAGE);
    }

    const numericProviderMovieId = Number(providerMovieId);
    if (numericProviderMovieId > 2147483647) {
      throw new BadRequestException(INVALID_PROVIDER_MOVIE_ID_MESSAGE);
    }

    return this.tmdbCatalogService.getMovieDetails(numericProviderMovieId);
  }
}
