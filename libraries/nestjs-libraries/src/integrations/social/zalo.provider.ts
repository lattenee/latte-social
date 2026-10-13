import {
  AuthTokenDetails,
  PendingCheckResponse,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import {
  BadBody,
  RefreshToken,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { Integration } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

/**
 * Zalo Official Account (OA) provider.
 *
 * OAuth v4 + PKCE flow (developers.zalo.me):
 * - Permission endpoint: https://oauth.zaloapp.com/v4/oa/permission
 * - Token endpoint:      https://oauth.zaloapp.com/v4/oa/access_token
 *   (app secret goes in the `secret_key` header, not the body)
 * - OA REST API:         https://openapi.zalo.me/v2.0
 *
 * Access tokens live ~25h (expires_in 90000). Refresh tokens live ~3 months,
 * are single-use and rotate on every refresh - the framework stores the new
 * refreshToken returned here, so `refreshCron` is required.
 */
export class ZaloProvider extends SocialAbstract implements SocialProvider {
  identifier = 'zalo';
  name = 'Zalo';
  isBetweenSteps = false;
  editor = 'normal' as const;
  refreshCron = true;
  // Zalo OA permissions are granted through the permission link configured in
  // the developer console - the OAuth URL takes no `scope` parameter.
  scopes = [] as string[];

  maxLength() {
    // Zalo OA articles cap title at 150 chars and description at 300 chars;
    // the body accepts long-form text.
    return 2000;
  }

  private generatePKCE() {
    const codeVerifier = randomBytes(64).toString('base64url');
    const challenge = Buffer.from(
      createHash('sha256').update(codeVerifier).digest()
    )
      .toString('base64')
      .replace(/=*$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    return { codeVerifier, codeChallenge: challenge };
  }

  async generateAuthUrl() {
    const state = makeSecureId(32);
    const { codeVerifier, codeChallenge } = this.generatePKCE();

    const redirectUri = `${process.env.FRONTEND_URL}/integrations/social/zalo`;

    const url =
      `https://oauth.zaloapp.com/v4/oa/permission` +
      `?app_id=${process.env.ZALO_APP_ID}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code_challenge=${codeChallenge}` +
      `&code_challenge_method=S256` +
      `&state=${state}`;

    return {
      url,
      codeVerifier,
      state,
    };
  }

  // Zalo answers OAuth errors as {error, error_name, error_description} in a
  // 200 body - a missing access_token means the exchange failed.
  private async zaloTokenRequest(params: Record<string, string>) {
    const response = await fetch(
      'https://oauth.zaloapp.com/v4/oa/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          secret_key: process.env.ZALO_APP_SECRET!,
        },
        body: new URLSearchParams({
          app_id: process.env.ZALO_APP_ID!,
          ...params,
        }),
      }
    );

    return response.json();
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const { access_token, refresh_token, expires_in } =
      await this.zaloTokenRequest({
        grant_type: 'authorization_code',
        code: params.code,
        code_verifier: params.codeVerifier,
      });

    if (!access_token) {
      throw new BadBody(
        this.identifier,
        JSON.stringify({ code: params.code }),
        '{}',
        'Zalo did not return an access token, please try connecting again'
      );
    }

    const oa = await this.getOaInfo(access_token);

    return {
      id: oa.id,
      name: oa.name,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      picture: oa.picture,
      username: oa.username,
    };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokenDetails> {
    const { access_token, refresh_token, expires_in } =
      await this.zaloTokenRequest({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

    if (!access_token) {
      // Refresh tokens are single-use; a rejected one means the channel has to
      // be re-connected by the user.
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'Zalo refresh token was rejected, please re-connect the channel'
      );
    }

    const oa = await this.getOaInfo(access_token);

    return {
      refreshToken: refresh_token,
      expiresIn: expires_in,
      accessToken: access_token,
      id: oa.id,
      name: oa.name,
      picture: oa.picture,
      username: oa.username,
    };
  }

  private async getOaInfo(
    accessToken: string
  ): Promise<{ id: string; name: string; username: string; picture: string }> {
    const { data } = await (
      await this.fetch('https://openapi.zalo.me/v2.0/oa/getoa', {
        method: 'GET',
        headers: {
          access_token: accessToken,
        },
      })
    ).json();

    return {
      id: String(data?.oaid ?? ''),
      name: data?.name || 'Zalo OA',
      username: data?.oa_alias || data?.name || 'zalo-oa',
      picture: data?.avatar || '',
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    // Zalo OA publishes long-form content as articles. The create call is
    // asynchronous: it returns a processing `token`, and `checkPostStatus`
    // resolves the final article id through the verify endpoint.
    // TODO(zalo): the cover photo_url must be a public URL under 1MB - Zalo
    // fetches it server-side, so only already-public media works as a cover.
    // Upload support for local media is not implemented yet.
    const cover = firstPost.media?.find((m) => m.type === 'image');

    const response = await this.fetch(
      'https://openapi.zalo.me/v2.0/article/create',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: accessToken,
        },
        body: JSON.stringify({
          type: 'normal',
          title: firstPost.message.slice(0, 150),
          description: firstPost.message.slice(0, 300),
          ...(cover
            ? {
                cover: {
                  cover_type: 'photo',
                  photo_url: cover.path,
                  status: 'show',
                },
              }
            : {}),
          body: [{ type: 'text', content: firstPost.message }],
          status: 'show',
          comment: 'show',
        }),
      },
      this.identifier
    );

    // Zalo OA APIs answer errors as {error: <non-zero>, message} in a 200 body.
    const { error, message, token } = await response.json();

    if (error === -216) {
      // TODO(zalo): -216 is the documented invalid/expired-token code; other
      // auth-related codes may need the same mapping once tested against a
      // real app.
      throw new RefreshToken(
        this.identifier,
        JSON.stringify({ error, message }),
        '{}',
        'Zalo access token expired'
      );
    }

    if (error !== 0 || !token) {
      throw new BadBody(
        this.identifier,
        JSON.stringify({ error, message }),
        '{}',
        `Zalo could not create the article${message ? `: ${message}` : ''}`
      );
    }

    return [
      {
        id: firstPost.id,
        postId: token,
        releaseURL: '',
        status: 'pending',
        pendingData: { token },
      },
    ];
  }

  // Single read-only check of the article-creation token - the post workflow
  // polls it until Zalo finishes processing and returns the article id.
  override async checkPostStatus(
    accessToken: string,
    pendingData: { token: string },
    integration: Integration
  ): Promise<PendingCheckResponse> {
    const { error, message, data } = await (
      await this.fetch(
        'https://openapi.zalo.me/v2.0/article/verify',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            access_token: accessToken,
          },
          body: JSON.stringify({ token: pendingData.token }),
        },
        this.identifier
      )
    ).json();

    if (error === -216) {
      throw new RefreshToken(
        this.identifier,
        JSON.stringify({ error, message }),
        '{}',
        'Zalo access token expired'
      );
    }

    // TODO(zalo): confirm the exact error/data shape Zalo returns while an
    // article is still processing - treated as "pending" whenever it reports
    // success without an id.
    if (error !== 0) {
      throw new BadBody(
        this.identifier,
        JSON.stringify({ error, message }),
        '{}',
        `Zalo could not verify the article${message ? `: ${message}` : ''}`
      );
    }

    if (!data?.id) {
      return { status: 'pending', pendingData };
    }

    return {
      status: 'completed',
      postId: String(data.id),
      // TODO(zalo): the article API does not return a public URL - link to the
      // OA profile instead (integration.profile holds the OA alias).
      releaseURL: `https://zalo.me/${integration.profile}`,
    };
  }
}
