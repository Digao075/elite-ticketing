import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';

import { AuthService, type LoginResponse } from './auth.service';
import type { AuthenticatedRequest } from './authenticated-principal';
import { JwtAuthGuard } from './jwt-auth.guard';

type LoginRequest = {
  email: string;
  password: string;
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginRequest): Promise<LoginResponse> {
    return this.authService.login(body?.email, body?.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest): AuthenticatedRequest['user'] {
    return request.user;
  }
}
