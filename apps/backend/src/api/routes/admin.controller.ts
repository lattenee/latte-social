import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { ErrorsService } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.service';
import { AdminStatsService } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { DataDeletionService } from '@gitroom/nestjs-libraries/database/prisma/data-deletion/data-deletion.service';
import dayjs from 'dayjs';

const MANUAL_PLAN_TIERS = ['STANDARD', 'TEAM', 'PRO', 'ULTIMATE'] as const;

@ApiTags('Admin')
@Controller('/admin')
export class AdminController {
  constructor(
    private _errorsService: ErrorsService,
    private _adminStatsService: AdminStatsService,
    private _subscriptionService: SubscriptionService,
    private _dataDeletionService: DataDeletionService
  ) {}

  private assertSuperAdmin(user: User) {
    if (!user?.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }
  }

  @Get('/errors')
  async listErrors(
    @GetUserFromRequest() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('platform') platform?: string,
    @Query('email') email?: string,
    @Query('unknownFirst') unknownFirst?: string
  ) {
    this.assertSuperAdmin(user);
    return this._errorsService.listErrors({
      page: page ? parseInt(page, 10) : 0,
      limit: limit ? parseInt(limit, 10) : 20,
      platform: platform || undefined,
      email: email || undefined,
      unknownFirst: unknownFirst === 'true' || unknownFirst === '1',
    });
  }

  @Get('/errors/platforms')
  async listPlatforms(@GetUserFromRequest() user: User) {
    this.assertSuperAdmin(user);
    return this._errorsService.listPlatforms();
  }

  @Get('/stats')
  async getStats(
    @GetUserFromRequest() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('unknownOnly') unknownOnly?: string
  ) {
    this.assertSuperAdmin(user);

    const fromDate = from ? dayjs(from) : dayjs().subtract(30, 'day');
    const toDate = to ? dayjs(to) : dayjs();

    return this._adminStatsService.getStats({
      from: fromDate.startOf('day').toDate(),
      to: toDate.endOf('day').toDate(),
      unknownOnly: unknownOnly === 'true' || unknownOnly === '1',
    });
  }

  // Manual plan activation (no payment rail). Writes through the existing
  // Subscription model with provider 'manual' so every downstream
  // entitlement check (channel limits, tier on /user/self) keeps a single
  // source of truth. The service refuses to overwrite a subscription owned
  // by another provider (stripe etc.) - that returns {} and surfaces as 409
  // here instead of silently clobbering a paying customer's plan.
  @Post('/organizations/:id/plan')
  async activatePlan(
    @GetUserFromRequest() user: User,
    @Param('id') organizationId: string,
    @Body()
    body: {
      tier?: string;
      period?: string;
      totalChannels?: number;
      isLifetime?: boolean;
    }
  ) {
    this.assertSuperAdmin(user);

    const tier = (body?.tier || '').toUpperCase();
    if (
      !MANUAL_PLAN_TIERS.includes(tier as (typeof MANUAL_PLAN_TIERS)[number])
    ) {
      throw new HttpException(
        `tier must be one of ${MANUAL_PLAN_TIERS.join(', ')}`,
        400
      );
    }
    const period = (body?.period || 'YEARLY').toUpperCase();
    if (period !== 'MONTHLY' && period !== 'YEARLY') {
      throw new HttpException('period must be MONTHLY or YEARLY', 400);
    }
    const totalChannels =
      typeof body?.totalChannels === 'number' && body.totalChannels > 0
        ? Math.floor(body.totalChannels)
        : 8;

    const result =
      await this._subscriptionService.createOrUpdateSubscriptionByOrg(
        false,
        organizationId,
        'manual',
        `manual:${user.id}`,
        totalChannels,
        tier as 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
        period as 'MONTHLY' | 'YEARLY',
        null
      );

    if (!result || !('id' in result ? result.id : Object.keys(result).length)) {
      throw new HttpException(
        'The workspace already has a subscription managed by another provider - revoke it first or edit it through that provider',
        409
      );
    }

    return result;
  }

  @Delete('/organizations/:id/plan')
  async revokePlan(
    @GetUserFromRequest() user: User,
    @Param('id') organizationId: string
  ) {
    this.assertSuperAdmin(user);
    // Provider-scoped delete: can only remove 'manual' plans, never a
    // stripe/revenuecat-owned row.
    return this._subscriptionService.deleteSubscriptionByOrgId(
      organizationId,
      'manual'
    );
  }

  @Get('/deletion-requests')
  async listDeletionRequests(
    @GetUserFromRequest() user: User,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    this.assertSuperAdmin(user);
    return this._dataDeletionService.listOpen(
      page ? parseInt(page, 10) : 0,
      limit ? parseInt(limit, 10) : 20
    );
  }

  @Post('/deletion-requests/:id/resolve')
  async resolveDeletionRequest(
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    this.assertSuperAdmin(user);
    return this._dataDeletionService.resolve(id);
  }
}
