import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedRequest } from '../auth/authenticated-principal';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RequireStoredUser } from '../auth/stored-user.decorator';
import { TicketsService, type TicketDto } from './tickets.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.CUSTOMER)
  @RequireStoredUser()
  listMine(@Req() request: AuthenticatedRequest): Promise<TicketDto[]> {
    return this.tickets.listMine(request.user.id);
  }

  /**
   * Unauthenticated on purpose. The 32-byte token is the capability, so the
   * recipient of a shared link needs no account to see the ticket.
   */
  @Get('shared/:shareToken')
  findShared(@Param('shareToken') shareToken: string): Promise<TicketDto> {
    return this.tickets.findShared(shareToken);
  }
}
