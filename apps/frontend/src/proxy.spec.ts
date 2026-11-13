import { proxy } from './proxy';
import { NextRequest } from 'next/server';

// Signed-out middleware routing: /legal/* must pass through anonymously
// (the privacy/terms/deletion pages are public for Meta App Review), while
// a private route without an auth cookie still bounces to /auth.
const request = (url: string, cookie?: string) =>
  new NextRequest(new URL(url), {
    headers: cookie ? { cookie } : undefined,
  } as any);

const isPassthrough = (res: any) =>
  res.headers.get('x-middleware-next') === '1' &&
  !res.headers.get('x-middleware-redirect');

describe('proxy auth gating', () => {
  it.each(['/legal', '/legal/privacy', '/legal/terms', '/legal/data-deletion'])(
    'lets a signed-out visitor through %s',
    async (path) => {
      const res = await proxy(request(`http://localhost${path}`));
      expect(isPassthrough(res)).toBe(true);
    }
  );

  it('still redirects a signed-out visitor away from the app', async () => {
    const res = await proxy(request('http://localhost/launches'));
    expect(isPassthrough(res)).toBe(false);
    expect(res.headers.get('location')).toContain('/auth');
  });

  it('a signed-in visitor hits /legal without being bounced home', async () => {
    const res = await proxy(
      request('http://localhost/legal/privacy', 'auth=tok')
    );
    expect(isPassthrough(res)).toBe(true);
  });
});
