import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { Roles } from './roles.decorator';
import { RolesGuard } from './roles.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // FIX: Tight rate limit on login
  @Throttle({ auth: { ttl: 300_000, limit: 10 } })
  @Post('login')
  login(@Body() body: any) {
    return this.authService.login(body);
  }

  // Public signup — no auth required
  // Rate limited: 5 signups per IP per hour
  @Throttle({ auth: { ttl: 3_600_000, limit: 5 } })
  @Post('signup')
  signup(@Body() body: any) {
    return this.authService.register({
      username: body.username || body.phone || body.email,
      email: body.email,
      phone: body.phone,
      password: body.password,
      name: body.name || body.username || body.phone,
      role: 'client',
      pageIds: [],
      isActive: true,
      forcePasswordChange: false,
      referralCode: body.referralCode,
    });
  }

  // ── OTP: Send signup verification OTP ─────────────────────────────────────
  @Throttle({ auth: { ttl: 60_000, limit: 3 } })
  @Post('otp/send-signup')
  sendSignupOtp(@Body('email') email: string) {
    return this.authService.sendSignupOtp(email);
  }

  // ── OTP: Verify signup OTP + create account ────────────────────────────────
  @Throttle({ auth: { ttl: 60_000, limit: 5 } })
  @Post('otp/verify-signup')
  verifySignupOtp(@Body() body: any) {
    return this.authService.verifySignupOtp({
      email: body.email,
      code: body.code,
      name: body.name,
      password: body.password,
      referralCode: body.referralCode,
    });
  }

  // ── OTP: Send forgot-password OTP ─────────────────────────────────────────
  @Throttle({ auth: { ttl: 60_000, limit: 3 } })
  @Post('otp/send-reset')
  sendResetOtp(@Body('email') email: string) {
    return this.authService.sendResetOtp(email);
  }

  // ── OTP: Reset password via OTP ────────────────────────────────────────────
  @Throttle({ auth: { ttl: 60_000, limit: 5 } })
  @Post('otp/reset-password')
  resetPasswordByOtp(@Body() body: any) {
    return this.authService.resetPasswordByOtp({
      email: body.email,
      code: body.code,
      newPassword: body.newPassword,
    });
  }

  // ── Google OAuth login ──────────────────────────────────────────────────────
  @Get('google/url')
  getGoogleOAuthUrl() {
    return { url: this.authService.getGoogleOAuthUrl() };
  }

  // Called by Google after consent — public, no session exists yet
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const { resultId } = await this.authService.handleGoogleCallback(
      code,
      state,
    );
    const redirectBase = this.authService.getFrontendBaseUrl();
    return res.redirect(
      `${redirectBase}/?mode=login&googleAuth=${encodeURIComponent(resultId)}`,
    );
  }

  // Frontend exchanges the opaque result id for the real session token — one-time use
  @Throttle({ auth: { ttl: 60_000, limit: 10 } })
  @Get('google/result/:id')
  googleResult(@Param('id') id: string) {
    return this.authService.consumeGoogleLoginResult(id);
  }

  // Authenticated routes — skip the auth throttler (only login/signup need it)
  @SkipThrottle({ auth: true })
  @UseGuards(AuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return this.authService.me(req.headers['authorization']?.slice(7) || '');
  }

  @SkipThrottle({ auth: true })
  @UseGuards(AuthGuard)
  @Post('logout')
  logout(@Req() req: any) {
    const token = req.headers['authorization']?.slice(7) || '';
    return this.authService.logout(token);
  }

  @SkipThrottle({ auth: true })
  @UseGuards(AuthGuard)
  @Patch('change-password')
  changePassword(@Req() req: any, @Body() body: any) {
    return this.authService.changePassword(req.authUser.id, body);
  }

  // ── Admin routes ──────────────────────────────────────────────────────────
  @SkipThrottle({ auth: true })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  @Get('users')
  listUsers() {
    return this.authService.adminListUsers();
  }

  @SkipThrottle({ auth: true })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  @Post('admin/create-client')
  createClient(@Body() body: any) {
    return this.authService.register({ ...body, role: 'client' });
  }

  @SkipThrottle({ auth: true })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  @Patch('admin/users/:id')
  updateUser(@Param('id') id: string, @Body() body: any) {
    return this.authService.adminUpdateUser(id, body);
  }

  @SkipThrottle({ auth: true })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  @Post('admin/users/:id/reset-password')
  resetPassword(@Param('id') id: string, @Body('password') password: string) {
    return this.authService.adminResetPassword(id, password);
  }

  @SkipThrottle({ auth: true })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  @Delete('admin/users/:id')
  deleteUser(@Param('id') id: string) {
    return this.authService.adminDeleteUser(id);
  }

  // V12: Migration endpoint — import users from old JSON file
  @SkipThrottle({ auth: true })
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  @Post('admin/migrate-from-json')
  migrateFromJson(@Body('filePath') filePath: string) {
    const path = require('path');
    const base = path.basename(filePath || 'users.json').replace(/[^a-zA-Z0-9._-]/g, '');
    const safePath = path.join(process.cwd(), 'storage', 'auth', base || 'users.json');
    return this.authService.migrateFromJsonFile(safePath);
  }
}
