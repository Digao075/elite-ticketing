import { Body, Controller, HttpCode, Post } from '@nestjs/common';

import { AuthService, type LoginResponse } from './auth.service';

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
}
