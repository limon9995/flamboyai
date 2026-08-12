import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { IncomingSmsDto } from './dto/incoming-sms.dto';
import { SmsGatewayService } from './sms-gateway.service';

@Controller('sms-gateway')
export class SmsGatewayController {
  constructor(private readonly svc: SmsGatewayService) {}

  // ── Android SMS forwarder webhook — no auth, secured by pageToken ─────────
  @SkipThrottle({ global: true, auth: true, chat: true })
  @Post('incoming')
  @HttpCode(200)
  async incoming(
    @Query('pageToken') pageToken: string,
    @Body() dto: IncomingSmsDto,
  ) {
    if (!pageToken) throw new UnauthorizedException('pageToken required');
    // Admin token path (for FlamboyAI billing verification)
    if (this.svc.isAdminToken(pageToken)) {
      await this.svc.handleAdminIncoming(dto.message, dto.from);
      return { ok: true };
    }
    // Merchant page token path
    const pageId = await this.svc.verifyPageToken(pageToken);
    if (!pageId) throw new UnauthorizedException('Invalid or disabled token');
    await this.svc.handleIncoming(pageId, dto.message, dto.from);
    return { ok: true };
  }

  // ── Client routes (authenticated) ─────────────────────────────────────────
  @UseGuards(AuthGuard)
  @SkipThrottle({ global: true, auth: true, chat: true })
  @Get('token')
  async getToken(@Req() req: any) {
    const pageId = Number(req.query.pageId ?? req.authUser?.pageIds?.[0]);
    const token = await this.svc.getOrCreateToken(pageId);
    return { token };
  }

  @UseGuards(AuthGuard)
  @SkipThrottle({ global: true, auth: true, chat: true })
  @Delete('token')
  async regenerateToken(@Req() req: any, @Query('pageId') pageId: string) {
    const token = await this.svc.regenerateToken(Number(pageId));
    return { token };
  }

  @UseGuards(AuthGuard)
  @SkipThrottle({ global: true, auth: true, chat: true })
  @Patch('enabled')
  async setEnabled(
    @Req() req: any,
    @Body() body: { pageId: number; enabled: boolean },
  ) {
    await this.svc.setEnabled(body.pageId, body.enabled);
    return { ok: true };
  }

  @UseGuards(AuthGuard)
  @SkipThrottle({ global: true, auth: true, chat: true })
  @Get('status')
  async getStatus(@Query('pageId') pageId: string) {
    return this.svc.getStatus(Number(pageId));
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  @SkipThrottle({ global: true, auth: true, chat: true })
  @Get('recent')
  async getRecent(@Query('pageId') pageId: string) {
    return this.svc.getRecent(Number(pageId));
  }

  // ── Admin billing SMS gateway setup ───────────────────────────────────────
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  @SkipThrottle({ global: true, auth: true, chat: true })
  @Post('admin-token/regenerate')
  async regenerateAdminToken() {
    const { randomUUID } = await import('crypto');
    const token = randomUUID();
    await this.svc.setAdminToken(token);
    return { token };
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  @SkipThrottle({ global: true, auth: true, chat: true })
  @Get('admin-status')
  async getAdminStatus() {
    return this.svc.getAdminStatus();
  }

  // ── Device connect (called by FlamboyAI PaySync app) — no auth ─────────────
  @SkipThrottle({ global: true, auth: true, chat: true })
  @Post('connect')
  @HttpCode(200)
  async connectDevice(@Body() body: { token: string; deviceName?: string; deviceModel?: string }) {
    const { token, deviceName, deviceModel } = body;
    if (!token) throw new UnauthorizedException('token required');
    const result = await this.svc.connectDevice(token, deviceName || 'Unknown Device', deviceModel);
    if (!result) throw new UnauthorizedException('Invalid token');
    return { ok: true };
  }

  // ── Get connected devices (authenticated) ────────────────────────────────
  @UseGuards(AuthGuard)
  @SkipThrottle({ global: true, auth: true, chat: true })
  @Get('devices')
  async getDevices(@Query('pageId') pageId?: string) {
    return this.svc.getDevices(pageId ? Number(pageId) : null);
  }
}
