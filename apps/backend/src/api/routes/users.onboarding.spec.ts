import { UsersController } from './users.controller';

// The controller's service import chain reaches ESM-only packages
// (nostr-tools via integration.manager); specs only need the class shapes.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);

// Onboarding completion is workspace-scoped: the endpoint marks the org
// from the authenticated request, never an org id supplied by the client.
function controller() {
  const orgService = {
    markOnboarded: jest.fn(async () => ({
      id: 'org-1',
      onboardedAt: new Date('2026-11-13T00:00:00Z'),
    })),
  };
  const c = new UsersController(
    undefined as any,
    undefined as any,
    undefined as any,
    orgService as any,
    undefined as any,
    undefined as any
  );
  return { c, orgService };
}

describe('UsersController.completeOnboarding', () => {
  it('marks the request-scoped organization onboarded', async () => {
    const { c, orgService } = controller();
    const out = await c.completeOnboarding({ id: 'org-1' } as any);
    expect(orgService.markOnboarded).toHaveBeenCalledWith('org-1');
    expect(out.onboardedAt).toBeTruthy();
  });

  it('cannot mark another workspace — the org comes from the request', async () => {
    const { c, orgService } = controller();
    await c.completeOnboarding({ id: 'org-B' } as any);
    expect(orgService.markOnboarded).toHaveBeenCalledWith('org-B');
    expect(orgService.markOnboarded).toHaveBeenCalledTimes(1);
  });

  it('rejects a request with no organization context', () => {
    const { c } = controller();
    expect(() => c.completeOnboarding(undefined as any)).toThrow();
  });
});

describe('UsersController.getSelf onboarding state', () => {
  it('surfaces onboardedAt from the organization', async () => {
    const userService = {
      getPersonal: jest.fn(),
    };
    const c = new UsersController(
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      userService as any,
      undefined as any
    );
    const org = {
      id: 'org-1',
      onboardedAt: new Date('2026-11-01T00:00:00Z'),
      users: [{ role: 'USER' }],
    };
    const out = await c.getSelf(
      { id: 'u-1' } as any,
      org as any,
      { cookies: {}, headers: {} } as any
    );
    expect(out.onboardedAt).toEqual(new Date('2026-11-01T00:00:00Z'));
  });

  it('reports null onboardedAt for a workspace that never onboarded', async () => {
    const c = new UsersController(
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      { getPersonal: jest.fn() } as any,
      undefined as any
    );
    const out = await c.getSelf(
      { id: 'u-1' } as any,
      { id: 'org-1', users: [{ role: 'USER' }] } as any,
      { cookies: {}, headers: {} } as any
    );
    expect(out.onboardedAt).toBeNull();
  });
});
