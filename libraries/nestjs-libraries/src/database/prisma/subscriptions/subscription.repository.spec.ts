import { SubscriptionRepository } from './subscription.repository';
import { SubscriptionService } from './subscription.service';

// The service's import chain reaches ESM-only packages (nostr-tools via
// integration.manager); the specs only need the class shapes, so the
// service modules are replaced rather than loaded.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);

// Mocked PrismaRepository wrappers — the spec asserts which calls the
// guarded write issues and what it returns, no database involved.
function repo(behavior: {
  updateManyCount?: number;
  existing?: any;
  createImpl?: jest.Mock;
}) {
  const subscription = {
    updateMany: jest.fn(async () => ({ count: behavior.updateManyCount ?? 0 })),
    findFirst: jest.fn(async () => behavior.existing ?? null),
    findUnique: jest.fn(async () => behavior.existing ?? null),
    create:
      behavior.createImpl ??
      jest.fn(async () => ({ id: 'sub-new', provider: 'manual' })),
    upsert: jest.fn(),
    deleteMany: jest.fn(async () => ({ count: 0 })),
  };
  const organization = {
    update: jest.fn(async () => ({})),
    findFirst: jest.fn(async () => ({ id: 'org-1' })),
  };
  const r = new SubscriptionRepository(
    { model: { subscription } } as any,
    { model: { organization } } as any,
    { model: { user: {} } } as any,
    { model: { credits: {} } } as any,
    { model: { usedCodes: {} } } as any
  );
  return { r, subscription, organization };
}

const call = (r: SubscriptionRepository) =>
  r.upsertSubscriptionByOrgProvider(
    'manual',
    false,
    'manual:u-1',
    'org-1',
    8,
    'PRO',
    'YEARLY',
    null
  );

describe('SubscriptionRepository.upsertSubscriptionByOrgProvider', () => {
  it('updateMany carries the ownership predicate inside the write', async () => {
    const { r, subscription } = repo({ updateManyCount: 1 });
    await call(r);
    expect(subscription.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        provider: 'manual',
        isLifetime: false,
      },
      data: expect.objectContaining({
        subscriptionTier: 'PRO',
        provider: 'manual',
        totalChannels: 8,
        deletedAt: null,
      }),
    });
  });

  it('updates an existing same-provider row and returns it', async () => {
    const { r, subscription } = repo({
      updateManyCount: 1,
      existing: { id: 'sub-1', provider: 'manual' },
    });
    const out = await call(r);
    expect(out).toEqual({ id: 'sub-1', provider: 'manual' });
    expect(subscription.create).not.toHaveBeenCalled();
  });

  it('a row owned by another provider is a conflict, never an overwrite', async () => {
    const { r, subscription } = repo({
      updateManyCount: 0,
      existing: { id: 'sub-stripe', provider: 'stripe' },
    });
    const out = await call(r);
    expect(out).toBe('conflict');
    expect(subscription.create).not.toHaveBeenCalled();
    // the guard predicate means the stripe row was never touched
    const where = subscription.updateMany.mock.calls[0][0].where;
    expect(where.provider).toBe('manual');
  });

  it('a lifetime row is a conflict too', async () => {
    const { r, subscription } = repo({
      updateManyCount: 0,
      existing: { id: 'sub-life', provider: 'manual', isLifetime: true },
    });
    expect(await call(r)).toBe('conflict');
    expect(subscription.create).not.toHaveBeenCalled();
  });

  it('creates when no row exists', async () => {
    const { r, subscription, organization } = repo({ updateManyCount: 0 });
    const out = await call(r);
    expect(subscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        provider: 'manual',
        subscriptionTier: 'PRO',
      }),
    });
    expect(out).toEqual({ id: 'sub-new', provider: 'manual' });
    expect(organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { isTrailing: false, allowTrial: false },
    });
  });

  it('losing the create race reports conflict instead of throwing', async () => {
    // create() throws a unique violation while a find afterwards sees the
    // row that raced in — simulates a payment webhook winning between the
    // check and the create.
    const { r, subscription } = repo({
      updateManyCount: 0,
      createImpl: jest.fn(async () => {
        throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      }),
    });
    subscription.findFirst
      .mockResolvedValueOnce(null) // first check: nothing there
      .mockResolvedValueOnce({ id: 'sub-raced', provider: 'stripe' });
    const out = await call(r);
    expect(out).toBe('conflict');
    // the racing row is never updated
    expect(subscription.findUnique).not.toHaveBeenCalled();
  });

  it('non-unique create failures still propagate', async () => {
    const { r, subscription } = repo({
      updateManyCount: 0,
      createImpl: jest.fn(async () => {
        throw new Error('connection reset');
      }),
    });
    await expect(call(r)).rejects.toThrow('connection reset');
  });
});

describe('SubscriptionService.createOrUpdateSubscriptionByOrg conflict path', () => {
  function service(repoOut: any, current: any = null) {
    const repository = {
      getSubscriptionByOrgId: jest.fn(async () => current),
      upsertSubscriptionByOrgProvider: jest.fn(async () => repoOut),
      createOrUpdateSubscription: jest.fn(),
    };
    const integrationService = {
      getIntegrationsList: jest.fn(async () => []),
      disableIntegrations: jest.fn(),
      enableAllIntegrations: jest.fn(),
      changeActiveCron: jest.fn(),
    };
    const organizationService = {
      disableOrEnableNonSuperAdminUsers: jest.fn(),
    };
    const s = new SubscriptionService(
      repository as any,
      integrationService as any,
      organizationService as any
    );
    return { s, repository };
  }

  const invoke = (s: SubscriptionService) =>
    s.createOrUpdateSubscriptionByOrg(
      false,
      'org-1',
      'manual',
      'manual:u-1',
      8,
      'PRO',
      'YEARLY',
      null
    );

  it('an existing stripe-owned row short-circuits to {} before any write', async () => {
    const { s, repository } = service(null, {
      id: 'sub-stripe',
      provider: 'stripe',
      isLifetime: false,
    });
    expect(await invoke(s)).toEqual({});
    expect(repository.upsertSubscriptionByOrgProvider).not.toHaveBeenCalled();
  });

  it('a repository conflict maps to {} so the controller can 409', async () => {
    const { s } = service('conflict');
    expect(await invoke(s)).toEqual({});
  });

  it('a written subscription is returned as-is', async () => {
    const { s } = service({ id: 'sub-1', provider: 'manual' });
    expect(await invoke(s)).toEqual({ id: 'sub-1', provider: 'manual' });
  });
});
