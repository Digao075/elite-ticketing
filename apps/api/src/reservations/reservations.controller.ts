import { BadRequestException, Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { AuthenticatedRequest } from '../auth/authenticated-principal';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RequireStoredUser } from '../auth/stored-user.decorator';
import { ReservationsService, type ReservationDto } from './reservations.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('reservations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CUSTOMER)
@RequireStoredUser()
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  create(@Req() request: AuthenticatedRequest, @Body() body: unknown): Promise<ReservationDto> {
    return this.reservations.create(request.user.id, body);
  }

  @Post(':reservationId/payment')
  pay(@Req() request: AuthenticatedRequest, @Param('reservationId') reservationId: string, @Body() body: unknown): Promise<ReservationDto> {
    if (!UUID.test(reservationId)) throw new BadRequestException('reservationId must be a UUID');
    return this.reservations.pay(request.user.id, reservationId, body);
  }
}
