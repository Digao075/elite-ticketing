import { SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

export const ROLES_METADATA_KEY = 'allowed_roles';

export function Roles(...roles: Role[]): MethodDecorator & ClassDecorator {
  return SetMetadata(ROLES_METADATA_KEY, roles);
}
