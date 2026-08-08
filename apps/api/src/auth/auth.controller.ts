import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { Public, PublicRoute } from './public-route.decorator';
import { readSessionCookie, SESSION_COOKIE, SESSION_TTL_MS, SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly sessions: SessionService) {}

  @Post('signup') @Public(PublicRoute.SIGNUP) @HttpCode(202)
  async signup(@Body() body: { username?: unknown; password?: unknown }, @Req() request: Request) {
    await this.auth.signup(body.username, body.password, request.ip ?? 'unknown');
    return { status: 'request_received' };
  }

  @Post('login') @Public(PublicRoute.LOGIN) @HttpCode(200)
  async login(@Body() body: { username?: unknown; password?: unknown }, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const session = await this.auth.login(body.username, body.password, request.ip ?? 'unknown');
    response.cookie(SESSION_COOKIE, session.token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS });
    return { status: 'authenticated' };
  }

  @Post('logout') @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    const token = readSessionCookie(request.headers.cookie);
    if (token) await this.sessions.revoke(token);
    response.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
  }
}
