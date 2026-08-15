import { BadRequestException, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ContentSelectionTokenService, type SelectionResponse } from './content-selection-token.service';
import { type CatalogMovieDetail, type CatalogMovieSummary, TmdbCatalogService } from './tmdb-catalog.service';

const INVALID_QUERY_MESSAGE = 'query must contain 1 to 100 characters after trimming';
const INVALID_PROVIDER_MOVIE_ID_MESSAGE = 'providerMovieId must be a positive 32-bit integer';

@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ORGANIZER)
export class CatalogController {
  constructor(
    private readonly tmdbCatalogService: TmdbCatalogService,
    private readonly contentSelectionTokenService: ContentSelectionTokenService,
  ) {}

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
    return this.tmdbCatalogService.getMovieDetails(this.parseProviderMovieId(providerMovieId));
  }

  @Post('movies/:providerMovieId/selection')
  @HttpCode(HttpStatus.OK)
  async issueMovieSelection(@Param('providerMovieId') providerMovieId: string): Promise<SelectionResponse> {
    const content = await this.tmdbCatalogService.getMovieSelectionDetails(this.parseProviderMovieId(providerMovieId));
    return { selectionToken: this.contentSelectionTokenService.issue(content), expiresIn: 1800 };
  }

  private parseProviderMovieId(providerMovieId: string): number {
    if (!/^[1-9][0-9]*$/.test(providerMovieId)) throw new BadRequestException(INVALID_PROVIDER_MOVIE_ID_MESSAGE);
    const numericProviderMovieId = Number(providerMovieId);
    if (numericProviderMovieId > 2147483647) throw new BadRequestException(INVALID_PROVIDER_MOVIE_ID_MESSAGE);
    return numericProviderMovieId;
  }
}
