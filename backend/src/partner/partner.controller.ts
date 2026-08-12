import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PartnerService } from './partner.service';

// Self-service portal for the "agent" (reseller) role — everything here is
// scoped to the logged-in agent's own referred clients. Admin-side agent
// management (create/edit/payout) lives in AdminController/AdminService,
// which calls into PartnerService's admin-facing helpers directly.
@Controller('partner')
@UseGuards(AuthGuard, RolesGuard)
@Roles('agent')
export class PartnerController {
  constructor(private readonly partner: PartnerService) {}

  private agentId(req: any): string {
    return (req.user || req.authUser).id;
  }

  @Get('me')
  async me(@Req() req: any) {
    const profile = await this.partner.getSelfProfile(this.agentId(req));
    const base = process.env.PARTNER_SIGNUP_BASE_URL || 'https://app.flamboyai.com/signup';
    return {
      ...profile,
      referralLink: profile.referralCode ? `${base}?ref=${profile.referralCode}` : null,
    };
  }

  @Get('clients')
  getClients(@Req() req: any) {
    return this.partner.getReferredClients(this.agentId(req));
  }

  @Get('earnings')
  getEarnings(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.partner.getEarnings(
      this.agentId(req),
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 30,
    );
  }

  @Get('payouts')
  getPayouts(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.partner.getPayouts(
      this.agentId(req),
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 30,
    );
  }
}
