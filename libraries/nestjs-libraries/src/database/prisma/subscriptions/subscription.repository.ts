import { Injectable } from '@nestjs/common';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import dayjs from 'dayjs';
import { Organization } from '@prisma/client';

@Injectable()
export class SubscriptionRepository {
  constructor(
    private readonly _subscription: PrismaRepository<'subscription'>,
    private readonly _organization: PrismaRepository<'organization'>,
    private readonly _user: PrismaRepository<'user'>,
    private readonly _credits: PrismaRepository<'credits'>,
    private _usedCodes: PrismaRepository<'usedCodes'>
  ) {}

  getUserAccount(userId: string) {
    return this._user.model.user.findFirst({
      where: {
        id: userId,
      },
      select: {
        account: true,
        connectedAccount: true,
      },
    });
  }

  getCode(code: string) {
    return this._usedCodes.model.usedCodes.findFirst({
      where: {
        code,
      },
    });
  }

  updateAccount(userId: string, account: string) {
    return this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        account,
      },
    });
  }

  getSubscriptionByOrganizationId(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  updateConnectedStatus(account: string, accountCharges: boolean) {
    return this._user.model.user.updateMany({
      where: {
        account,
      },
      data: {
        connectedAccount: accountCharges,
      },
    });
  }

  getCustomerIdByOrgId(organizationId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        id: organizationId,
      },
      select: {
        paymentId: true,
      },
    });
  }

  checkSubscription(organizationId: string, subscriptionId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        identifier: subscriptionId,
        deletedAt: null,
      },
    });
  }

  deleteSubscriptionByCustomerId(customerId: string, provider: string) {
    return this._subscription.model.subscription.deleteMany({
      where: {
        provider,
        organization: {
          paymentId: customerId,
        },
      },
    });
  }

  deleteSubscriptionByOrgId(organizationId: string, provider: string) {
    return this._subscription.model.subscription.deleteMany({
      where: {
        organizationId,
        provider,
      },
    });
  }

  updateCustomerId(organizationId: string, customerId: string) {
    return this._organization.model.organization.update({
      where: {
        id: organizationId,
      },
      data: {
        paymentId: customerId,
      },
    });
  }

  updateCancelAt(organizationId: string, cancelAt: number | null) {
    return this._subscription.model.subscription.updateMany({
      where: {
        organizationId,
        deletedAt: null,
      },
      data: {
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
      },
    });
  }

  async getSubscriptionByOrgId(orgId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId: orgId,
      },
    });
  }

  async getSubscriptionByCustomerId(customerId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organization: {
          paymentId: customerId,
        },
      },
    });
  }

  async getOrganizationByCustomerId(customerId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        paymentId: customerId,
      },
    });
  }

  // Provider-scoped upsert that cannot clobber another provider's row.
  // updateMany carries the ownership predicate (provider + not-lifetime)
  // inside the same statement as the write, so the check-and-write is
  // atomic; the create path relies on the organizationId unique constraint,
  // losing that race to a concurrent writer (e.g. a payment webhook) is a
  // 'conflict', never an overwrite. Returns the written row or 'conflict'.
  async upsertSubscriptionByOrgProvider(
    provider: string,
    isTrailing: boolean,
    identifier: string,
    organizationId: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null
  ) {
    const writable = {
      subscriptionTier: billing,
      provider,
      totalChannels,
      period,
      identifier,
      isLifetime: false,
      cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
      deletedAt: null,
    };

    const updated = await this._subscription.model.subscription.updateMany({
      where: {
        organizationId,
        provider,
        isLifetime: false,
      },
      data: writable,
    });

    if (updated.count === 1) {
      await this._organization.model.organization.update({
        where: { id: organizationId },
        data: { isTrailing, allowTrial: false },
      });
      return this._subscription.model.subscription.findUnique({
        where: { organizationId },
      });
    }

    // count 0 means no writable row: either nothing exists yet, or the row
    // is owned by another provider / is lifetime — both are conflicts.
    const existing = await this.getSubscriptionByOrgId(organizationId);
    if (existing) {
      return 'conflict' as const;
    }

    try {
      const created = await this._subscription.model.subscription.create({
        data: { organizationId, ...writable },
      });
      await this._organization.model.organization.update({
        where: { id: organizationId },
        data: { isTrailing, allowTrial: false },
      });
      return created;
    } catch (err) {
      // The unique constraint on organizationId is the last guard: if a
      // concurrent writer (payment webhook, second admin call) created the
      // row between the check above and this create, report a conflict
      // instead of overwriting or exploding.
      const raced = await this.getSubscriptionByOrgId(organizationId);
      if (raced) {
        return 'conflict' as const;
      }
      throw err;
    }
  }

  async createOrUpdateSubscription(
    provider: string,
    isTrailing: boolean,
    identifier: string,
    customerId: string,
    totalChannels: number,
    billing: 'STANDARD' | 'TEAM' | 'PRO' | 'ULTIMATE',
    period: 'MONTHLY' | 'YEARLY',
    cancelAt: number | null,
    code?: string,
    org?: { id: string }
  ) {
    const findOrg =
      org || (await this.getOrganizationByCustomerId(customerId))!;

    if (!findOrg) {
      return;
    }

    const subscription = await this._subscription.model.subscription.upsert({
      where: {
        organizationId: findOrg.id,
        ...(!code && customerId
          ? {
              organization: {
                paymentId: customerId,
              },
            }
          : {}),
      },
      update: {
        subscriptionTier: billing,
        provider,
        totalChannels,
        period,
        identifier,
        isLifetime: !!code,
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
        deletedAt: null,
      },
      create: {
        organizationId: findOrg.id,
        subscriptionTier: billing,
        provider,
        isLifetime: !!code,
        totalChannels,
        period,
        cancelAt: cancelAt ? new Date(cancelAt * 1000) : null,
        identifier,
        deletedAt: null,
      },
    });

    await this._organization.model.organization.update({
      where: {
        id: findOrg.id,
      },
      data: {
        isTrailing,
        allowTrial: false,
      },
    });

    if (code) {
      await this._usedCodes.model.usedCodes.create({
        data: {
          code,
          orgId: findOrg.id,
        },
      });
    }
    return subscription;
  }

  getSubscriptionByIdentifier(identifier: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        identifier,
        deletedAt: null,
      },
      include: {
        organization: true,
      },
    });
  }

  getSubscription(organizationId: string) {
    return this._subscription.model.subscription.findFirst({
      where: {
        organizationId,
        deletedAt: null,
      },
    });
  }

  async getCreditsFrom(
    organizationId: string,
    from: dayjs.Dayjs,
    type = 'ai_images'
  ) {
    const load = await this._credits.model.credits.groupBy({
      by: ['organizationId'],
      where: {
        organizationId,
        type,
        createdAt: {
          gte: from.toDate(),
        },
      },
      _sum: {
        credits: true,
      },
    });

    return load?.[0]?._sum?.credits || 0;
  }

  async useCredit<T>(
    org: Organization,
    type = 'ai_images',
    func: () => Promise<T>
  ) {
    const data = await this._credits.model.credits.create({
      data: {
        organizationId: org.id,
        credits: 1,
        type,
      },
    });

    try {
      return await func();
    } catch (err) {
      await this._credits.model.credits.delete({
        where: {
          id: data.id,
        },
      });
      throw err;
    }
  }

  // The caller picks the id, so charging the same work twice is one row
  chargeCredits(
    id: string,
    organizationId: string,
    type: string,
    credits: number
  ) {
    return this._credits.model.credits.upsert({
      where: {
        id,
      },
      create: {
        id,
        organizationId,
        credits,
        type,
      },
      update: {},
      select: {
        id: true,
      },
    });
  }

  refundCredits(organizationId: string, id: string) {
    return this._credits.model.credits.deleteMany({
      where: {
        id,
        organizationId,
      },
    });
  }

  deleteCreditsFrom(organizationId: string, from: dayjs.Dayjs, type: string) {
    return this._credits.model.credits.deleteMany({
      where: {
        organizationId,
        type,
        createdAt: {
          gte: from.toDate(),
        },
      },
    });
  }

  setCustomerId(orgId: string, customerId: string) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        paymentId: customerId,
      },
    });
  }
}
