import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';

import type { AuthenticatedRequest } from './authenticated-principal';
import { PrismaService } from '../database/prisma.service';
import { ROLES_METADATA_KEY } from './roles.decorator';

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
    if (this.prisma && Reflect.getMetadata(PATH_METADATA, context.getClass()) === 'events' && Reflect.getMetadata(PATH_METADATA, context.getHandler()) === ':eventId' && !await this.prisma.user.findUnique({ where: { id: user.id } })) {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    if (user.role !== undefined && allowedRoles.includes(user.role as Role)) {
      return true;
    }

    throw new ForbiddenException('Insufficient role');
  }
}
