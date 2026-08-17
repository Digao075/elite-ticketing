import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';

import type { AuthenticatedRequest } from './authenticated-principal';
import { PrismaService } from '../database/prisma.service';
import { ROLES_METADATA_KEY } from './roles.decorator';
import { STORED_USER_METADATA_KEY } from './stored-user.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Optional() private readonly prisma?: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (allowedRoles === undefined) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const requiresStoredUser = this.reflector.getAllAndOverride<boolean>(STORED_USER_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiresStoredUser === true && this.prisma && !(await this.prisma.user.findUnique({ where: { id: user.id } }))) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (user.role !== undefined && allowedRoles.includes(user.role as Role)) {
      return true;
    }

    throw new ForbiddenException('Insufficient role');
  }
}
