import { Test } from '@nestjs/testing';
import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { LegalController } from './legal.controller';
import { AdminController } from './admin.controller';
import { AuthMiddleware } from '@gitroom/backend/services/auth/auth.middleware';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { HttpExceptionFilter } from '@gitroom/nestjs-libraries/services/exception.filter';
import { DataDeletionService } from '@gitroom/nestjs-libraries/database/prisma/data-deletion/data-deletion.service';
import { ErrorsService } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.service';
import { AdminStatsService } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';

// The import chains of these services reach ESM-only packages (nostr-tools
// via integration.manager, @mastra/core); the HTTP test needs the real
// controllers, middleware and throttler guard, so the heavy modules are
// replaced rather than loaded. The injected services are stubbed at the
// provider level below.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service',
  () => ({ OrganizationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/users/users.service',
  () => ({ UsersService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({
  MastraService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/sentry/initialize.sentry', () => ({
  setSentryUserContext: jest.fn(),
  initializeSentry: jest.fn(),
}));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'legal-throttle-spec';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';

// Mirrors api.module.ts: LegalController is registered WITHOUT the auth
// middleware (public by design, the deletion form is for people with no
// account) while AdminController sits behind the real AuthMiddleware. The
// throttler is the in-memory storage - the point is exercising the real
// ThrottlerRealIpGuard + @Throttle metadata over HTTP, not Redis.
const deletionService = {
  createRequest: jest.fn(async (input: { email: string }) => ({
    id: 'req-1',
    createdAt: new Date(),
    ...input,
  })),
};

const userService = {
  getUserById: jest.fn(async (id: string) => ({
    id,
    activated: true,
    isSuperAdmin: false,
    password: 'x',
  })),
};

const organizationService = {
  getOrgsByUserId: jest.fn(async () => [
    {
      id: 'org-1',
      apiKey: 'key-1',
      users: [{ userId: 'u-1', disabled: false, role: 'USER' }],
      subscription: null,
      paymentId: null,
    },
  ]),
  getUserOrg: jest.fn(async () => null),
  updateApiKey: jest.fn(async () => undefined),
};

@Module({
  imports: [
    // no storage option: the default in-memory ThrottlerStorageService is
    // exactly the "test storage" this spec wants - no external Redis
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 1000 }],
    }),
  ],
  controllers: [LegalController, AdminController],
  providers: [
    { provide: DataDeletionService, useValue: deletionService },
    { provide: ErrorsService, useValue: {} },
    { provide: AdminStatsService, useValue: {} },
    { provide: SubscriptionService, useValue: {} },
    { provide: OrganizationService, useValue: organizationService },
    { provide: UsersService, useValue: userService },
  ],
})
class LegalThrottleTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // same wiring as api.module.ts: only the authenticated controllers get
    // the middleware, /legal stays anonymous
    consumer.apply(AuthMiddleware).forRoutes(AdminController);
  }
}

describe('legal + admin HTTP surface (real Nest app, in-memory throttler)', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LegalThrottleTestModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // production main.ts registers cookie-parser and the
    // HttpForbiddenException -> 401 filter; mirror both
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.listen(0);
    const server = app.getHttpServer();
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  const postDeletion = (body: any, ip: string) =>
    fetch(`${baseUrl}/legal/data-deletion-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify(body),
    });

  it('accepts an anonymous valid deletion request', async () => {
    const res = await postDeletion({ email: 'a@b.co' }, '10.0.0.1');
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toEqual({ id: 'req-1', received: true });
    expect(deletionService.createRequest).toHaveBeenCalledWith({
      email: 'a@b.co',
    });
  });

  it('rejects an invalid email with 400', async () => {
    const res = await postDeletion({ email: 'not-an-email' }, '10.0.0.2');
    expect(res.status).toBe(400);
  });

  it('throttles the public route at the decorated limit (10/hr per IP)', async () => {
    const ip = '10.0.0.3';
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (await postDeletion({ email: `person${i}@b.co` }, ip)).status
      );
    }
    // @Throttle({default: {limit: 10, ttl: 3600000}}) on the handler: the
    // first ten succeed, the eleventh is a real 429
    expect(statuses.slice(0, 10)).toEqual(new Array(10).fill(201));
    expect(statuses[10]).toBe(429);
  });

  it('keeps throttles per-IP: another address is not affected', async () => {
    const res = await postDeletion({ email: 'other@b.co' }, '10.0.0.4');
    expect(res.status).toBe(201);
  });

  it('rejects an unauthenticated admin call through the real auth middleware', async () => {
    const res = await fetch(`${baseUrl}/admin/organizations/org-1/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'PRO' }),
    });
    // AuthMiddleware throws HttpForbiddenException -> 401 via the global
    // filter registered in main.ts
    expect(res.status).toBe(401);
  });

  it('rejects an authenticated non-super-admin on the admin route with 403', async () => {
    const auth = AuthService.signJWT({ id: 'u-1' });
    const res = await fetch(`${baseUrl}/admin/organizations/org-1/plan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        auth,
      },
      body: JSON.stringify({ tier: 'PRO' }),
    });
    // middleware resolved the user; the controller's assertSuperAdmin is
    // the wall for ordinary accounts
    expect(res.status).toBe(403);
  });
});
