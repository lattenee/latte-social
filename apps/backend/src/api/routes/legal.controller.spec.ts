import { LegalController } from './legal.controller';

// Public deletion-request endpoint: validation contract + delegation, with
// the service mocked. Anonymous by design — the controller is registered
// outside the authenticated controller list (see api.module.ts).
function controller() {
  const deletionService = {
    createRequest: jest.fn(async () => ({ id: 'req-1', createdAt: new Date() })),
  };
  return {
    c: new LegalController(deletionService as any),
    deletionService,
  };
}

describe('LegalController.createDataDeletionRequest', () => {
  it.each([
    [undefined, 'missing'],
    [{}, 'empty body'],
    [{ email: 42 }, 'non-string email'],
    [{ email: null }, 'null email'],
    [{ email: '   ' }, 'blank email'],
    [{ email: 'not-an-email' }, 'no @'],
    [{ email: 'a@b' }, 'no domain dot'],
    [{ email: `${'a'.repeat(250)}@b.co` }, 'over 254 chars'],
  ])('rejects %j (%s) with 400 — never throws a TypeError', async (body) => {
    const { c, deletionService } = controller();
    await expect(
      c.createDataDeletionRequest(body as any)
    ).rejects.toMatchObject({ status: 400 });
    expect(deletionService.createRequest).not.toHaveBeenCalled();
  });

  it('accepts a valid request and returns the receipt id', async () => {
    const { c, deletionService } = controller();
    const out = await c.createDataDeletionRequest({
      email: '  Person@Example.COM ',
      note: 'please delete everything',
    });
    expect(out).toEqual({ id: 'req-1', received: true });
    expect(deletionService.createRequest).toHaveBeenCalledWith({
      email: 'Person@Example.COM', // the controller trims before delegating
      note: 'please delete everything',
    });
  });

  it('drops a blank note instead of storing whitespace', async () => {
    const { c, deletionService } = controller();
    await c.createDataDeletionRequest({ email: 'a@b.co', note: '   ' });
    expect(deletionService.createRequest).toHaveBeenCalledWith({
      email: 'a@b.co',
    });
  });

  it('is throttled — the guard metadata is on the handler', () => {
    // The @Throttle decorator + ThrottlerRealIpGuard are what keep the
    // public form from being a free write endpoint; assert the metadata is
    // actually attached so a refactor can't silently strip it.
    const keys = Reflect.getMetadataKeys(
      LegalController.prototype.createDataDeletionRequest
    );
    const throttlerKeys = keys.filter(
      (k) => typeof k === 'string' && k.toLowerCase().includes('throttler')
    );
    expect(throttlerKeys.length).toBeGreaterThan(0);
  });
});
