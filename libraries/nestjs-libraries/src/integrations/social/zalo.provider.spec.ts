import { ZaloProvider } from './zalo.provider';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';

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
    expect((res[0] as any).pendingData.kind).toBe('article_armed');
    expect((res[0] as any).pendingData.armedAt).toBeGreaterThan(0);
    // preparatory only — no article/create, no upload_video
    expect(calls).toHaveLength(0);
  });

  it('armed + article already exists -> completed, never ready', async () => {
    mockFetch(provider, { '/article/getslice': getsliceBody([article()]) });
    const res = await provider.checkPostStatus(
      'token',
      { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    expect(res.status).toBe('completed');
    expect((res as any).postId).toBe('art-1');
    expect((res as any).releaseURL).toBe('https://zalo.me/article/art-1');
  });

  it('armed + empty article list -> ready for finalize', async () => {
    mockFetch(provider, { '/article/getslice': getsliceBody([]) });
    const res = await provider.checkPostStatus(
      'token',
      { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    expect(res.status).toBe('ready');
  });

  it('armed + lookup failure -> pending, NOT ready (fail closed)', async () => {
    mockFetch(provider, { '/article/getslice': { error: -500, message: 'boom' } });
    const res = await provider.checkPostStatus(
      'token',
      { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    // A create whose outcome was lost may already exist; without a
    // conclusive lookup the provider must not arm a second create.
    expect(res.status).toBe('pending');
  });

  it('armed + network throw on getslice -> pending, NOT ready', async () => {
    (provider as any).fetch = jest.fn(async () => {
      throw new Error('socket reset');
    });
    const res = await provider.checkPostStatus(
      'token',
      { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    expect(res.status).toBe('pending');
  });

  it('armed + same title but different description -> ready (distinct article)', async () => {
    mockFetch(provider, {
      '/article/getslice': getsliceBody([
        article({ id: 'other', description: 'different text' }),
      ]),
    });
    const res = await provider.checkPostStatus(
      'token',
      { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    expect(res.status).toBe('ready');
  });

  it('armed + identical article created BEFORE arming -> ready (not deduped)', async () => {
    // A distinct, earlier post with the same caption must not be silently
    // absorbed as "this post already exists".
    mockFetch(provider, {
      '/article/getslice': getsliceBody([
        article({ create_date: now - 3 * 60 * 60 * 1000 }),
      ]),
    });
    const res = await provider.checkPostStatus(
      'token',
      { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    expect(res.status).toBe('ready');
  });

  it('armed + seconds-precision create_date still dedups', async () => {
    mockFetch(provider, {
      '/article/getslice': getsliceBody([
        article({ create_date: Math.floor(now / 1000) }), // seconds, not ms
      ]),
    });
    const res = await provider.checkPostStatus(
      'token',
      { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    expect(res.status).toBe('completed');
    expect((res as any).postId).toBe('art-1');
  });

  it('dedup match can live past the first getslice page', async () => {
    const older = Array.from({ length: 50 }, (_, i) =>
      article({ id: `noise-${i}`, title: `noise ${i}` })
    );
    mockFetch(provider, {
      '/article/getslice': (url: string) =>
        url.includes('offset=0')
          ? getsliceBody(older)
          : getsliceBody([article({ id: 'deep-1' })]),
    });
    const res = await provider.checkPostStatus(
      'token',
      { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    expect(res.status).toBe('completed');
    expect((res as any).postId).toBe('deep-1');
  });

  it('finalizePost runs the only create and returns pending+token', async () => {
    const calls = mockFetch(provider, {
      '/article/create': { error: 0, token: 'create-token-1' },
    });
    const res = await provider.finalizePost(
      'token',
      { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    expect(res.status).toBe('pending');
    const pd = (res as any).pendingData;
    expect(pd.kind).toBe('article');
    expect(pd.token).toBe('create-token-1');
    const creates = calls.filter((c) => c.url.includes('/article/create'));
    expect(creates).toHaveLength(1); // exactly one mutation call
  });

  it('video create payload carries type:video, video_id and avatar', async () => {
    const calls = mockFetch(provider, {
      '/article/create': { error: 0, token: 'vt' },
    });
    const videoDraft = { ...DRAFT, avatarUrl: 'https://img/thumb.png' };
    await provider.finalizePost(
      'token',
      { kind: 'video_ready', article: videoDraft, videoId: 'vid-9' },
      INTEGRATION
    );
    const create = calls.find((c) => c.url.includes('/article/create'))!;
    expect(create.body.type).toBe('video');
    expect(create.body.video_id).toBe('vid-9');
    expect(create.body.avatar).toBe('https://img/thumb.png');
  });

  it('text create payload carries type:normal and body blocks', async () => {
    const calls = mockFetch(provider, {
      '/article/create': { error: 0, token: 't' },
    });
    await provider.finalizePost(
      'token',
      { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    const create = calls.find((c) => c.url.includes('/article/create'))!;
    expect(create.body.type).toBe('normal');
    expect(create.body.body[0].type).toBe('text');
    expect(create.body.body[0].content).toBe(DRAFT.message);
  });

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
      { kind: 'article', token: 'ct', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    expect(res.status).toBe('completed');
    expect((res as any).postId).toBe('art-7');
    expect((res as any).releaseURL).toBe('https://zalo.me/article/art-7');
  });

  it('verified article + inconclusive link lookup -> completed, OA fallback', async () => {
    mockFetch(provider, {
      '/article/verify': { error: 0, data: { id: 'art-7' } },
      '/article/getslice': { error: -500, message: 'list down' },
    });
    const res = await provider.checkPostStatus(
      'token',
      { kind: 'article', token: 'ct', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    // The durable receipt is the verify token — a dead list only costs the
    // pretty link, not the completion signal.
    expect(res.status).toBe('completed');
    expect((res as any).releaseURL).toBe('https://zalo.me/test-oa');
  });

  it('expired access token during check -> RefreshToken (retried, not swallowed)', async () => {
    mockFetch(provider, {
      '/article/getslice': { error: -216, message: 'expired' },
    });
    await expect(
      provider.checkPostStatus(
        'token',
        { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
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

  it('lost create receipt: finalize threw but the article exists -> completed', async () => {
    // Simulates: finalizePost's createArticle mutated Zalo but the response
    // was lost, the workflow re-polled with armed pendingData, and the list
    // now shows the article. The check must complete, never re-arm.
    mockFetch(provider, {
      '/article/getslice': getsliceBody([article({ id: 'ghost-1' })]),
    });
    const res = await provider.checkPostStatus(
      'token',
      { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    expect(res.status).toBe('completed');
    expect((res as any).postId).toBe('ghost-1');
  });

  it('ambiguous title match without description -> pending (inconclusive)', async () => {
    mockFetch(provider, {
      '/article/getslice': getsliceBody([
        { id: 'x', title: DRAFT.title, create_date: now, link_view: '' },
      ]),
    });
    const res = await provider.checkPostStatus(
      'token',
      { kind: 'article_armed', article: DRAFT, armedAt: now - 60_000 },
      INTEGRATION
    );
    expect(res.status).toBe('pending');
  });

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

  it('video_ready path also dedups against video articles before arming', async () => {
    mockFetch(provider, {
      '/article/getslice': (url: string) =>
        url.includes('type=video') ? getsliceBody([article({ id: 'v-1' })]) : getsliceBody([]),
    });
    const res = await provider.checkPostStatus(
      'token',
      { kind: 'video_ready', article: DRAFT, videoId: 'vid-9', armedAt: now - 60_000 },
      INTEGRATION
    );
    expect(res.status).toBe('completed');
    expect((res as any).postId).toBe('v-1');
  });
});
