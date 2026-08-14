import { Module } from '@nestjs/common';

import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtConfig } from './jwt.config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordHasherService } from './password-hasher.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, JwtConfig, PasswordHasherService, RolesGuard],
  exports: [RolesGuard],
})
export class AuthModule {}
