import { ZaloProvider } from './zalo.provider';
import {
  BadBody,
  RefreshToken,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

// Mocked transport: route the provider's `fetch` by URL substring to a
// canned {error, data, ...} body. Every Zalo call in these tests is the
// provider's own request — no network, no credentials.
function mockFetch(provider: ZaloProvider, routes: Record<string, any>) {
  const calls: { url: string; body?: any }[] = [];
  (provider as any).fetch = jest.fn(async (url: string, options?: any) => {
    calls.push({
      url,
      body: options?.body ? JSON.parse(options.body) : undefined,
    });
    const hit = Object.entries(routes).find(([key]) => url.includes(key));
    if (!hit) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    const payload = typeof hit[1] === 'function' ? hit[1](url, options) : hit[1];
    if (payload instanceof Error) {
      throw payload;
    }
    return { json: async () => payload };
  });
  return calls;
}

const INTEGRATION: any = { name: 'Test OA', profile: 'test-oa', picture: '' };

const DRAFT = {
  title: 'Ca phe muoi ngon nhat pho di bo',
  description: 'Ca phe muoi ngon nhat pho di bo',
  author: 'Test OA',
  message: 'Ca phe muoi ngon nhat pho di bo',
  coverUrl: undefined,
  avatarUrl: undefined,
};

const now = Date.now();

function article(over: Record<string, any> = {}) {
  return {
    id: 'art-1',
    title: DRAFT.title,
    description: DRAFT.description,
    create_date: now, // ms epoch
    link_view: 'https://zalo.me/article/art-1',
    ...over,
  };
}

function getsliceBody(medias: any[]) {
  return { error: 0, data: { medias, total: medias.length } };
}

const createsIn = (calls: { url: string }[]) =>
  calls.filter((c) => c.url.includes('/article/create'));

const OA_OK = { error: 0, data: { name: 'Test OA' } };

describe('ZaloProvider pending/duplicate-safety contract', () => {
  let provider: ZaloProvider;
  beforeEach(() => {
    provider = new ZaloProvider();
  });

  it('postPending arms an article create and never mutates Zalo', async () => {
    const calls = mockFetch(provider, {});
    const res = await provider.postPending(
      'i1',
      'token',
      [{ id: 'p1', message: DRAFT.message, media: [] } as any],
      INTEGRATION
    );
    expect(res[0].status).toBe('pending');
    const pd = (res[0] as any).pendingData;
    expect(pd.kind).toBe('article_armed');
    expect(pd.armedAt).toBeGreaterThan(0);
    // preparatory only — no article/create, no upload_video, no list probe
    expect(calls).toHaveLength(0);
  });

  describe('arm -> confirm -> create handshake', () => {
    const armed = { kind: 'article_armed', article: DRAFT, armedAt: now };

    it('armed check returns ready without touching the article list', async () => {
      const calls = mockFetch(provider, {});
      const res = await provider.checkPostStatus('token', armed, INTEGRATION);
      expect(res.status).toBe('ready');
      // the check is a pure read of the workflow's own state — no getslice
      expect(calls).toHaveLength(0);
      expect((res as any).pendingData).toEqual(armed);
    });

    it('finalize on a witnessed armed state arms it - no create', async () => {
      const calls = mockFetch(provider, { '/oa/getoa': OA_OK });
      const res = await provider.finalizePost('token', armed, INTEGRATION);
      expect(res.status).toBe('pending');
      const pd = (res as any).pendingData;
      expect(pd.attempting).toBe(true);
      expect(pd.confirmed).toBe(false);
      expect(pd.kind).toBe('article_armed');
      expect(createsIn(calls)).toHaveLength(0);
    });

    it('check on a witnessed (attempting) state durably confirms it', async () => {
      const calls = mockFetch(provider, {});
      const res = await provider.checkPostStatus(
        'token',
        { ...armed, attempting: true, confirmed: false },
        INTEGRATION
      );
      expect(res.status).toBe('ready');
      // the workflow persists this BEFORE finalize runs - the attempt is
      // now uniquely accounted for
      expect((res as any).pendingData.confirmed).toBe(true);
      expect(calls).toHaveLength(0);
    });

    it('finalize runs the create only once the attempt is confirmed', async () => {
      const calls = mockFetch(provider, {
        '/article/create': { error: 0, token: 'create-token-1' },
      });
      const res = await provider.finalizePost(
        'token',
        { ...armed, attempting: true, confirmed: true },
        INTEGRATION
      );
      expect(res.status).toBe('pending');
      const pd = (res as any).pendingData;
      expect(pd.kind).toBe('article');
      expect(pd.token).toBe('create-token-1');
      expect(createsIn(calls)).toHaveLength(1); // exactly one mutation
    });

    it('finalize refuses a witnessed-but-unconfirmed attempt (ambiguous receipt)', async () => {
      // attempting without confirmed means the finalize ran before the
      // workflow durably armed the attempt - creating now could double a
      // receipt the next check cannot recognise.
      const calls = mockFetch(provider, {});
      const res = await provider.finalizePost(
        'token',
        { ...armed, attempting: true, confirmed: false },
        INTEGRATION
      );
      expect(res.status).toBe('pending');
      expect((res as any).pendingData.confirmed).toBe(false);
      expect(createsIn(calls)).toHaveLength(0);
    });

    it('drives the real check->finalize->check->finalize sequence', async () => {
      const calls = mockFetch(provider, {
        '/oa/getoa': OA_OK,
        '/article/create': { error: 0, token: 'ct-1' },
      });

      // 1. workflow arms the post, check says ready
      let res = await provider.checkPostStatus('token', armed, INTEGRATION);
      expect(res.status).toBe('ready');

      // 2. workflow persists pendingData, finalize witnesses the attempt
      res = await provider.finalizePost(
        'token',
        res.pendingData as any,
        INTEGRATION
      );
      expect(res.status).toBe('pending');
      expect(createsIn(calls)).toHaveLength(0);

      // 3. next check durably confirms the attempt
      res = await provider.checkPostStatus(
        'token',
        res.pendingData as any,
        INTEGRATION
      );
      expect(res.status).toBe('ready');
      expect((res as any).pendingData.confirmed).toBe(true);

      // 4. workflow persists, finalize creates exactly once
      res = await provider.finalizePost(
        'token',
        res.pendingData as any,
        INTEGRATION
      );
      expect(res.status).toBe('pending');
      expect((res as any).pendingData.kind).toBe('article');
      expect(createsIn(calls)).toHaveLength(1);
    });
  });

  describe('lost receipt never re-arms', () => {
    const armed = { kind: 'article_armed', article: DRAFT, armedAt: now };

    it('check -> finalize (create ran, response lost) -> check (empty list): create count <= 1', async () => {
      const calls = mockFetch(provider, {
        '/oa/getoa': OA_OK,
        // the create mutates Zalo but its response never reaches the
        // workflow - the worst duplicate-risk moment
        '/article/create': new Error('response lost mid-flight'),
        '/article/getslice': getsliceBody([]), // list not yet consistent
      });

      // arm + confirm, exactly like the live workflow
      let res = await provider.checkPostStatus('token', armed, INTEGRATION);
      res = await provider.finalizePost('token', res.pendingData as any, INTEGRATION);
      res = await provider.checkPostStatus('token', res.pendingData as any, INTEGRATION);
      expect((res as any).pendingData.confirmed).toBe(true);

      // the create mutates but the receipt is lost; last persisted state
      // still says attempting+confirmed without a token
      await expect(
        provider.finalizePost('token', res.pendingData as any, INTEGRATION)
      ).rejects.toThrow('response lost mid-flight');
      expect(createsIn(calls)).toHaveLength(1);

      // next check sees an EMPTY list - not proof nothing was created.
      // It must fail closed (park for manual reconciliation), never re-arm.
      await expect(
        provider.checkPostStatus(
          'token',
          (res as any).pendingData,
          INTEGRATION
        )
      ).rejects.toBeInstanceOf(BadBody);
      expect(createsIn(calls)).toHaveLength(1);
    });

    it('armed + confirmed state never claims a same-caption list entry as its own', async () => {
      // Two posts may share a caption: an identical-looking article on the
      // list is not proof it belongs to this attempt, so the check must not
      // adopt it as completed - it parks.
      const calls = mockFetch(provider, {
        '/article/getslice': getsliceBody([article({ id: 'someone-else' })]),
      });
      await expect(
        provider.checkPostStatus(
          'token',
          { ...armed, attempting: true, confirmed: true },
          INTEGRATION
        )
      ).rejects.toBeInstanceOf(BadBody);
      expect(createsIn(calls)).toHaveLength(0);
    });

    it('kind:article without a token (mangled receipt) also parks', async () => {
      await expect(
        provider.checkPostStatus(
          'token',
          { kind: 'article', article: DRAFT },
          INTEGRATION
        )
      ).rejects.toBeInstanceOf(BadBody);
    });

    it('repeated posts with the same caption do not coalesce', async () => {
      // Post B publishes the same caption post A already did. The list
      // shows A's article; B must still create its own (exactly one) - the
      // caption is never treated as a shared identity.
      const calls = mockFetch(provider, {
        '/oa/getoa': OA_OK,
        '/article/create': { error: 0, token: 'post-b-token' },
        '/article/getslice': getsliceBody([article({ id: 'post-a' })]),
      });

      let res = await provider.checkPostStatus('token', armed, INTEGRATION);
      res = await provider.finalizePost('token', res.pendingData as any, INTEGRATION);
      res = await provider.checkPostStatus('token', res.pendingData as any, INTEGRATION);
      res = await provider.finalizePost('token', res.pendingData as any, INTEGRATION);

      expect(createsIn(calls)).toHaveLength(1);
      expect((res as any).pendingData.token).toBe('post-b-token');
    });
  });

  describe('token probe before arming', () => {
    const armed = { kind: 'article_armed', article: DRAFT, armedAt: now };

    it('expired token at arm time -> RefreshToken, no attempt recorded', async () => {
      mockFetch(provider, { '/oa/getoa': { error: -216, message: 'expired' } });
      await expect(
        provider.finalizePost('token', armed, INTEGRATION)
      ).rejects.toBeInstanceOf(RefreshToken);
    });

    it('unreachable OA at arm time -> BadBody, no attempt recorded', async () => {
      mockFetch(provider, { '/oa/getoa': { error: -500, message: 'down' } });
      await expect(
        provider.finalizePost('token', armed, INTEGRATION)
      ).rejects.toBeInstanceOf(BadBody);
    });
  });

  describe('article token verification', () => {
    it('article token still verifying (-214) -> pending', async () => {
      mockFetch(provider, { '/article/verify': { error: -214 } });
      const res = await provider.checkPostStatus(
        'token',
        { kind: 'article', token: 'ct', article: DRAFT },
        INTEGRATION
      );
      expect(res.status).toBe('pending');
    });

    it('article token verified -> completed with resolved link', async () => {
      mockFetch(provider, {
        '/article/verify': { error: 0, data: { id: 'art-7' } },
        '/article/getslice': getsliceBody([
          article({ id: 'art-7', link_view: 'https://zalo.me/article/art-7' }),
        ]),
      });
      const res = await provider.checkPostStatus(
        'token',
        { kind: 'article', token: 'ct', article: DRAFT, armedAt: now },
        INTEGRATION
      );
      expect(res.status).toBe('completed');
      expect((res as any).postId).toBe('art-7');
      expect((res as any).releaseURL).toBe('https://zalo.me/article/art-7');
    });

    it('link lookup matches by the verified id, not the caption', async () => {
      // A same-caption article from another post appears first; the link
      // must resolve to OUR id only.
      mockFetch(provider, {
        '/article/verify': { error: 0, data: { id: 'art-9' } },
        '/article/getslice': getsliceBody([
          article({ id: 'not-ours', link_view: 'https://zalo.me/article/not-ours' }),
          article({ id: 'art-9', link_view: 'https://zalo.me/article/art-9' }),
        ]),
      });
      const res = await provider.checkPostStatus(
        'token',
        { kind: 'article', token: 'ct', article: DRAFT },
        INTEGRATION
      );
      expect(res.status).toBe('completed');
      expect((res as any).releaseURL).toBe('https://zalo.me/article/art-9');
    });

    it('verified article + inconclusive link lookup -> completed, OA fallback', async () => {
      mockFetch(provider, {
        '/article/verify': { error: 0, data: { id: 'art-7' } },
        '/article/getslice': { error: -500, message: 'list down' },
      });
      const res = await provider.checkPostStatus(
        'token',
        { kind: 'article', token: 'ct', article: DRAFT, armedAt: now },
        INTEGRATION
      );
      // The durable receipt is the verify token — a dead list only costs
      // the pretty link, not the completion signal.
      expect(res.status).toBe('completed');
      expect((res as any).releaseURL).toBe('https://zalo.me/test-oa');
    });

    it('link match past the page budget -> unknown -> OA fallback link', async () => {
      // 10 full pages of other articles: the list was never exhausted, so
      // 'missing' is not proven - lookup stays 'unknown', and completion
      // still succeeds with the OA fallback link.
      const full = Array.from({ length: 50 }, (_, i) =>
        article({ id: `noise-${i}`, title: `noise ${i}` })
      );
      mockFetch(provider, {
        '/article/verify': { error: 0, data: { id: 'deep-1' } },
        '/article/getslice': () => getsliceBody(full),
      });
      const res = await provider.checkPostStatus(
        'token',
        { kind: 'article', token: 'ct', article: DRAFT },
        INTEGRATION
      );
      expect(res.status).toBe('completed');
      expect((res as any).postId).toBe('deep-1');
      expect((res as any).releaseURL).toBe('https://zalo.me/test-oa');
    });

    it('malformed list payload -> unknown -> OA fallback link', async () => {
      mockFetch(provider, {
        '/article/verify': { error: 0, data: { id: 'art-5' } },
        '/article/getslice': { error: 0, data: { unexpected: true } },
      });
      const res = await provider.checkPostStatus(
        'token',
        { kind: 'article', token: 'ct', article: DRAFT },
        INTEGRATION
      );
      expect(res.status).toBe('completed');
      expect((res as any).releaseURL).toBe('https://zalo.me/test-oa');
    });
  });

  describe('RefreshToken propagation', () => {
    it('expired access token during link lookup -> RefreshToken (retried, not swallowed)', async () => {
      mockFetch(provider, {
        '/article/verify': { error: 0, data: { id: 'art-1' } },
        '/article/getslice': { error: -216, message: 'expired' },
      });
      await expect(
        provider.checkPostStatus(
          'token',
          { kind: 'article', token: 'ct', article: DRAFT, armedAt: now },
          INTEGRATION
        )
      ).rejects.toBeInstanceOf(RefreshToken);
    });

    it('expired access token during verify -> RefreshToken', async () => {
      mockFetch(provider, { '/article/verify': { error: -216 } });
      await expect(
        provider.checkPostStatus(
          'token',
          { kind: 'article', token: 'ct', article: DRAFT },
          INTEGRATION
        )
      ).rejects.toBeInstanceOf(RefreshToken);
    });
  });

  describe('video path', () => {
    it('video_upload kind waits on conversion then arms video_ready', async () => {
      mockFetch(provider, {
        '/article/upload_video/verify': { error: 0, data: { status: 3 } },
      });
      const pending = await provider.checkPostStatus(
        'token',
        { kind: 'video_upload', token: 'vt', article: DRAFT, armedAt: now },
        INTEGRATION
      );
      expect(pending.status).toBe('pending');
    });

    it('video_ready goes through the same handshake before creating', async () => {
      const calls = mockFetch(provider, {
        '/oa/getoa': OA_OK,
        '/article/create': { error: 0, token: 'v-art-t' },
      });
      const videoReady = {
        kind: 'video_ready',
        article: { ...DRAFT, avatarUrl: 'https://img/thumb.png' },
        videoId: 'vid-9',
        armedAt: now,
      };

      let res = await provider.checkPostStatus('token', videoReady as any, INTEGRATION);
      expect(res.status).toBe('ready');
      res = await provider.finalizePost('token', res.pendingData as any, INTEGRATION);
      expect(createsIn(calls)).toHaveLength(0);
      res = await provider.checkPostStatus('token', res.pendingData as any, INTEGRATION);
      res = await provider.finalizePost('token', res.pendingData as any, INTEGRATION);

      expect(createsIn(calls)).toHaveLength(1);
      const create = createsIn(calls)[0];
      expect(create.body.type).toBe('video');
      expect(create.body.video_id).toBe('vid-9');
      expect(create.body.avatar).toBe('https://img/thumb.png');
      expect((res as any).pendingData.kind).toBe('article');
    });
  });

  describe('create payloads', () => {
    const confirmed = {
      kind: 'article_armed',
      article: DRAFT,
      armedAt: now,
      attempting: true,
      confirmed: true,
    };

    it('does not replay article/create after an ambiguous HTTP 500', async () => {
      // Exercise the real inherited HTTP helper, not mockFetch: that helper
      // normally retries 500 responses even for mutating POST requests.
      const request = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('upstream failed after accepting article', { status: 500 })
      );
      try {
        await expect(
          provider.finalizePost('token', confirmed as any, INTEGRATION)
        ).rejects.toBeInstanceOf(BadBody);
        expect(request).toHaveBeenCalledTimes(1);
      } finally {
        request.mockRestore();
      }
    });

    it('text create payload carries type:normal and body blocks', async () => {
      const calls = mockFetch(provider, {
        '/article/create': { error: 0, token: 't' },
      });
      await provider.finalizePost('token', confirmed as any, INTEGRATION);
      const create = createsIn(calls)[0];
      expect(create.body.type).toBe('normal');
      expect(create.body.body[0].type).toBe('text');
      expect(create.body.body[0].content).toBe(DRAFT.message);
    });
  });
});
