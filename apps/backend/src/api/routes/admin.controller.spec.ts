import { AdminController } from './admin.controller';

// The subscription service's import chain reaches ESM-only packages
// (nostr-tools via integration.manager); the specs only need the class
// shapes, so the service modules are replaced rather than loaded.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);

// Controller-level unit tests: services are mocked, so these assert only
// the input validation and authorization contract — no Nest bootstrap, no
// HTTP, no database.
function controller() {
  const errorsService = { listErrors: jest.fn(), listPlatforms: jest.fn() };
  const statsService = { getStats: jest.fn() };
  const subscriptionService = {
    createOrUpdateSubscriptionByOrg: jest.fn(async () => ({ id: 'sub-1' })),
    deleteSubscriptionByOrgId: jest.fn(async () => ({ count: 1 })),
  };
  const deletionService = {
    listOpen: jest.fn(),
    resolve: jest.fn(),
  };
  const c = new AdminController(
    errorsService as any,
    statsService as any,
    subscriptionService as any,
    deletionService as any
  );
  return {
    c,
    errorsService,
    deletionService,
    raw: subscriptionService,
  };
}

const ADMIN: any = { id: 'u-admin', isSuperAdmin: true };
const NOT_ADMIN: any = { id: 'u-1', isSuperAdmin: false };

describe('AdminController authorization', () => {
  it.each([
    ['listErrors', (c: AdminController) => c.listErrors(NOT_ADMIN)],
    ['getStats', (c: AdminController) => c.getStats(NOT_ADMIN)],
    [
      'activatePlan',
      (c: AdminController) => c.activatePlan(NOT_ADMIN, 'org-1', { tier: 'PRO' }),
    ],
    ['revokePlan', (c: AdminController) => c.revokePlan(NOT_ADMIN, 'org-1')],
    [
      'listDeletionRequests',
      (c: AdminController) => c.listDeletionRequests(NOT_ADMIN),
    ],
    [
      'resolveDeletionRequest',
      (c: AdminController) => c.resolveDeletionRequest(NOT_ADMIN, 'r-1'),
    ],
  ])('%s denies non-super-admin with 403', async (_name, call) => {
    const { c } = controller();
    await expect(call(c)).rejects.toMatchObject({ status: 403 });
  });
});

describe('AdminController pagination validation', () => {
  it.each(['abc', '-1', '1.5', '1e3', 'NaN', 'Infinity'])(
    'rejects page=%s with 400',
    async (page) => {
      const { c } = controller();
      await expect(c.listErrors(ADMIN, page)).rejects.toMatchObject({
        status: 400,
      });
    }
  );

  it.each(['abc', '-1', '0', '1.5', '201', 'NaN'])(
    'rejects limit=%s with 400',
    async (limit) => {
      const { c } = controller();
      await expect(c.listErrors(ADMIN, '0', limit)).rejects.toMatchObject({
        status: 400,
      });
    }
  );

  it('passes parsed pagination to the service', async () => {
    const { c, errorsService } = controller();
    await c.listErrors(ADMIN, '2', '50');
    expect(errorsService.listErrors).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 50 })
    );
  });

  it('validates deletion-request pagination too', async () => {
    const { c } = controller();
    await expect(
      c.listDeletionRequests(ADMIN, '-3')
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      c.listDeletionRequests(ADMIN, '0', '999')
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('AdminController.activatePlan validation', () => {
  it.each([
    [{}, 'missing tier'],
    [{ tier: 123 }, 'numeric tier'],
    [{ tier: null }, 'null tier'],
    [{ tier: { t: 'PRO' } }, 'object tier'],
    [{ tier: 'ENTERPRISE' }, 'unknown tier'],
  ])('rejects %s (%s) with 400, no throw', async (body: any) => {
    const { c } = controller();
    await expect(
      c.activatePlan(ADMIN, 'org-1', body)
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [{ tier: 'PRO', period: 42 }, 'numeric period'],
    [{ tier: 'PRO', period: 'WEEKLY' }, 'unknown period'],
  ])('rejects %s (%s) with 400, no throw', async (body: any) => {
    const { c } = controller();
    await expect(
      c.activatePlan(ADMIN, 'org-1', body)
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [0, 'zero'],
    [-5, 'negative'],
    [1.5, 'fractional'],
    [NaN, 'NaN'],
    [Infinity, 'infinite'],
    [101, 'above cap'],
    ['8', 'string'],
  ])('rejects totalChannels=%p (%s) with 400', async (totalChannels: any) => {
    const { c } = controller();
    await expect(
      c.activatePlan(ADMIN, 'org-1', { tier: 'PRO', totalChannels })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('accepts a valid body and forwards normalized values', async () => {
    const { c, raw } = controller();
    await c.activatePlan(ADMIN, 'org-1', {
      tier: 'pro',
      period: 'monthly',
      totalChannels: 12,
    });
    expect(raw.createOrUpdateSubscriptionByOrg).toHaveBeenCalledWith(
      false,
      'org-1',
      'manual',
      'manual:u-admin',
      12,
      'PRO',
      'MONTHLY',
      null
    );
  });

  it('defaults period to YEARLY and totalChannels to 8', async () => {
    const { c, raw } = controller();
    await c.activatePlan(ADMIN, 'org-1', { tier: 'TEAM' });
    expect(raw.createOrUpdateSubscriptionByOrg).toHaveBeenCalledWith(
      false,
      'org-1',
      'manual',
      'manual:u-admin',
      8,
      'TEAM',
      'YEARLY',
      null
    );
  });

  it('returns 409 when the service reports a provider conflict', async () => {
    const { c } = controller();
    (c as any)._subscriptionService.createOrUpdateSubscriptionByOrg = jest
      .fn()
      .mockResolvedValue({});
    await expect(
      c.activatePlan(ADMIN, 'org-1', { tier: 'PRO' })
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe('AdminController.revokePlan', () => {
  it('scopes the revoke to the manual provider only', async () => {
    const { c, raw } = controller();
    await c.revokePlan(ADMIN, 'org-1');
    expect(raw.deleteSubscriptionByOrgId).toHaveBeenCalledWith(
      'org-1',
      'manual'
    );
  });
});
