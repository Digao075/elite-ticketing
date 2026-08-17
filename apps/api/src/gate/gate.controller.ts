import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RequireStoredUser } from '../auth/stored-user.decorator';
import { GateService, type GateValidationDto } from './gate.service';

@Controller('gate')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.GATE)
@RequireStoredUser()
export class GateController {
  constructor(private readonly gate: GateService) {}

  /**
   * Always 200. Every outcome here is a normal answer for the door staff, so
   * the result belongs in the body rather than in the status code.
   */
  @Post('validations')
  @HttpCode(200)
  validate(@Body() body: unknown): Promise<GateValidationDto> {
    return this.gate.validate(body);
  }
}
