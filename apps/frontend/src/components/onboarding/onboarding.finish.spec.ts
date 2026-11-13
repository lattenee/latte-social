import { persistOnboardingComplete } from './onboarding.finish';

// The finish flow's fetch contract: customFetch resolves with the raw
// Response even for 4xx/5xx, so a rejected save must surface as a rejection
// here - that is what keeps the modal open and leaves Finish clickable for
// a retry (handleFinish only calls onClose after this resolves).
const respond = (init: { ok?: boolean; status?: number }): Response =>
  ({ ok: init.ok ?? true, status: init.status ?? 200 }) as Response;

describe('persistOnboardingComplete', () => {
  it('posts the completion and refreshes the user context on success', async () => {
    const fetch = jest.fn(async () => respond({}));
    const mutate = jest.fn(async () => undefined);

    await expect(persistOnboardingComplete(fetch, mutate)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/user/onboarding/complete', {
      method: 'POST',
    });
    // /user/self is the SWR key feeding UserContext in the app layout - the
    // persisted onboardedAt has to reach that owner, not just any cache key.
    expect(mutate).toHaveBeenCalledWith('/user/self');
  });

  it.each([400, 401, 409, 500])(
    'rejects on a resolved %i response - the save must not count as done',
    async (status) => {
      const fetch = jest.fn(async () => respond({ ok: false, status }));
      const mutate = jest.fn(async () => undefined);

      await expect(persistOnboardingComplete(fetch, mutate)).rejects.toThrow(
        `${status}`
      );
      // a failed save refreshes nothing: onboardedAt stays unpersisted and
      // the context is not told otherwise
      expect(mutate).not.toHaveBeenCalled();
    }
  );

  it('propagates a thrown fetch (network failure) without refreshing', async () => {
    const fetch = jest.fn(async () => {
      throw new Error('connection refused');
    });
    const mutate = jest.fn(async () => undefined);

    await expect(persistOnboardingComplete(fetch, mutate)).rejects.toThrow(
      'connection refused'
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it('a retry after a failed save can still complete', async () => {
    const fetch = jest
      .fn<Promise<Response>, any[]>()
      .mockResolvedValueOnce(respond({ ok: false, status: 500 }))
      .mockResolvedValueOnce(respond({}));
    const mutate = jest.fn(async () => undefined);

    await expect(persistOnboardingComplete(fetch, mutate)).rejects.toThrow();
    await expect(
      persistOnboardingComplete(fetch, mutate)
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
