import {
  AnalyticsData,
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
import FormData from 'form-data';
import { timer } from '@gitroom/helpers/utils/timer';
import dayjs from 'dayjs';

// Zalo OA article limits (docs.zaloplatforms.com OA -> noi-dung-dang-bai-viet).
const ZALO_API = 'https://openapi.zalo.me/v2.0';
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // article video upload cap
const MAX_COVER_BYTES = 1024 * 1024; // article cover photo cap

// Everything the article create call needs, carried through the pending flow.
type ZaloArticleDraft = {
  title: string;
  description: string;
  author: string;
  message: string; // article body text
  coverUrl: string | undefined; // public image URL usable as cover/avatar
  avatarUrl: string | undefined; // thumbnail for type=video articles
};

// Travels through the workflow history between postPending, checkPostStatus
// and finalizePost - keep it small JSON.
type ZaloPendingData = {
  // article_armed: nothing on Zalo yet, create runs in finalizePost
  // video_upload:  preparevideo accepted, conversion still running
  // video_ready:   conversion done, video_id in hand, create armed
  // article:       article create accepted, token still verifying
  kind: 'article_armed' | 'video_upload' | 'video_ready' | 'article';
  article: ZaloArticleDraft;
  token?: string; // upload_video token (video_upload) or article token (article)
  videoId?: string; // resolved by upload_video/verify, used by the create
  // when postPending armed this post (ms epoch) - kept for diagnostics
  armedAt?: number;
  // The arm -> confirm -> create handshake (same shape as
  // pinterest.provider): finalizePost witnesses the intent (attempting),
  // the next check durably arms it (confirmed), and only then does the
  // create run. The workflow persists pendingData BEFORE the mutating
  // finalize runs, so a create whose receipt was lost is detectable:
  // attempting+confirmed without an article token means the outcome is
  // unknown and the post must park, never create again.
  attempting?: boolean;
  confirmed?: boolean;
};

// What a getslice lookup learned about an article this post might have
// already created. 'unknown' means the list could not be interrogated —
// callers must NOT treat it as "no article exists".
type ArticleLookup =
  | { status: 'found'; id: string; link: string }
  | { status: 'missing' }
  | { status: 'unknown' };

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
 *
 * Publishing is article-based (Zalo allows no personal feed posts):
 * - Text/image posts -> `type: 'normal'` article (POST /article/create).
 * - Video posts      -> `type: 'video'` article. The mp4 is pushed through
 *   /article/upload_video/preparevideo + /article/upload_video/verify first,
 *   which yields the video_id the create call needs.
 *
 * Both calls are asynchronous: create answers a `token`, and
 * /article/verify resolves the final article id. That maps onto the
 * pending-post machinery: postPending only uploads (reversible),
 * finalizePost creates the article (the only irreversible mutation),
 * checkPostStatus stays read-only and closes the duplicate-risk window
 * with an arm -> confirm -> create handshake (Zalo's create has no
 * idempotency key, so a lost receipt parks the post rather than guessing).
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
      await this.fetch(`${ZALO_API}/oa/getoa`, {
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

  // Zalo OA APIs answer errors as {error: <non-zero>, message} in a 200 body.
  // The mapped codes come from the OA error table
  // (docs.zaloplatforms.com/docs/OA/phu-luc/ma-loi); -214 ("article is being
  // processed") is handled by the caller since it means "keep polling", and
  // -216 means the 25h access token died mid-flight.
  private mapZaloError(
    error: number,
    message: string | undefined,
    context: string
  ): never {
    const detail = `${context}${message ? `: ${message}` : ''}`;
    if (error === -216 || error === -220) {
      throw new RefreshToken(
        this.identifier,
        JSON.stringify({ error, message }),
        '{}',
        'Zalo access token expired'
      );
    }
    const human: Record<number, string> = {
      [-32]: 'Zalo rate limit reached, the post will be retried later',
      [-201]: 'Zalo rejected a parameter',
      [-204]: 'The Zalo OA is disabled',
      [-205]: 'The Zalo OA no longer exists',
      [-209]: 'The Zalo app is not activated in the developer console',
      [-211]: 'The Zalo OA is out of quota for this feature',
      [-212]: 'The app has not registered the article API permission',
      [-223]: 'The OA has not granted this permission to the app',
      [-224]: 'The OA package does not include this feature',
    };
    throw new BadBody(
      this.identifier,
      JSON.stringify({ error, message }),
      '{}',
      human[error] ? `${human[error]} (${detail})` : detail
    );
  }

  private buildDraft(
    post: PostDetails,
    author: string,
    coverUrl: string | undefined,
    avatarUrl: string | undefined
  ): ZaloArticleDraft {
    return {
      // title doubles as the article headline.
      title: post.message.slice(0, 150),
      description: post.message.slice(0, 300),
      author: (author || 'Latte').slice(0, 50),
      message: post.message,
      coverUrl,
      avatarUrl,
    };
  }

  // Upload the mp4 through Zalo's two-step article-video flow. The returned
  // token resolves to a video_id once conversion finishes (verify endpoint).
  private async uploadArticleVideo(
    accessToken: string,
    videoPath: string
  ): Promise<string> {
    const size = await this.mediaSize(videoPath, this.identifier);
    if (size > MAX_VIDEO_BYTES) {
      throw new BadBody(
        this.identifier,
        JSON.stringify({ size }),
        '{}',
        'Zalo article videos are capped at 50MB, this video is too large'
      );
    }

    // The stream and FormData live inside the factory: runStreamedUpload
    // retries on 429/5xx, and a retried request must re-open the media -
    // a stream consumed by the failed attempt would send an empty body.
    const { error, message, data } = await this.runStreamedUpload(async () => {
      const stream = await this.mediaStream(videoPath, this.identifier);
      const formData = new FormData();
      formData.append('file', stream, {
        filename: videoPath.split('/').at(-1) || 'video.mp4',
      });
      const response = await this.getSsrfSafeAxios().post(
        `${ZALO_API}/article/upload_video/preparevideo`,
        formData,
        { headers: { ...formData.getHeaders(), access_token: accessToken } }
      );
      return response.data;
    }, this.identifier);

    if (error === -216 || error === -220) {
      throw new RefreshToken(
        this.identifier,
        JSON.stringify({ error, message }),
        '{}',
        'Zalo access token expired'
      );
    }
    if (error !== 0 || !data?.token) {
      this.mapZaloError(error, message, 'Zalo could not upload the video');
    }
    return data.token;
  }

  private async verifyVideoUpload(
    accessToken: string,
    token: string
  ): Promise<{ status: number; videoId?: string }> {
    const { error, message, data } = await (
      await this.fetch(
        `${ZALO_API}/article/upload_video/verify?token=${encodeURIComponent(
          token
        )}`,
        {
          method: 'GET',
          headers: { access_token: accessToken },
        },
        this.identifier
      )
    ).json();

    if (error === -216 || error === -220) {
      throw new RefreshToken(
        this.identifier,
        JSON.stringify({ error, message }),
        '{}',
        'Zalo access token expired'
      );
    }
    if (error !== 0) {
      this.mapZaloError(error, message, 'Zalo could not verify the video');
    }

    return {
      status: Number(data?.status ?? 0),
      videoId: data?.video_id ? String(data.video_id) : undefined,
    };
  }

  // The create call; the only irreversible mutation, run by finalizePost.
  private async createArticle(
    accessToken: string,
    draft: ZaloArticleDraft,
    videoId?: string
  ): Promise<string> {
    if (videoId && !draft.avatarUrl) {
      // `avatar` is a required field for type=video articles - fail early
      // with an actionable message instead of letting Zalo's -201 surface.
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'Zalo video articles need a thumbnail - attach an image to the post'
      );
    }
    const body = videoId
      ? {
          // docs: noi-dung-dang-video - a video article needs type 'video',
          // the converted video_id plus a public thumbnail URL.
          type: 'video',
          title: draft.title,
          description: draft.description,
          status: 'show',
          video_id: videoId,
          avatar: draft.avatarUrl,
          comment: 'show',
        }
      : {
          type: 'normal',
          title: draft.title,
          author: draft.author,
          description: draft.description,
          ...(draft.coverUrl
            ? {
                cover: {
                  cover_type: 'photo',
                  photo_url: draft.coverUrl,
                  status: 'show',
                },
              }
            : {}),
          body: [{ type: 'text', content: draft.message }],
          status: 'show',
          comment: 'show',
        };

    const response = await this.fetch(
      `${ZALO_API}/article/create`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: accessToken,
        },
        body: JSON.stringify(body),
      },
      this.identifier,
      // Never let SocialAbstract.fetch replay this irreversible POST on
      // HTTP 500/429. A failed response can follow a successful mutation;
      // the durable handshake must park it for manual reconciliation.
      3
    );

    const { error, message, token } = await response.json();

    if (error === -216 || error === -220) {
      throw new RefreshToken(
        this.identifier,
        JSON.stringify({ error, message }),
        '{}',
        'Zalo access token expired'
      );
    }
    if (error !== 0 || !token) {
      this.mapZaloError(error, message, 'Zalo could not create the article');
    }
    return token;
  }

  // The OA's own article list, paged newest-first. Used to resolve the
  // public `link_view` Zalo never returns from create/verify for an article
  // whose id is already proven. Matched by id only: two posts may
  // legitimately share a title/description, so caption fields never prove
  // an article belongs to this post.
  //
  // Fail-closed contract: 'missing' means the list was fully interrogated
  // and the article is not there; ANY failure to answer that question
  // (network, non-zero Zalo error, an unreadable payload, or the page
  // budget running out before the history did) returns 'unknown' so
  // callers never act on a guess.
  private async findArticleById(
    accessToken: string,
    type: 'normal' | 'video',
    id: string
  ): Promise<ArticleLookup> {
    const PAGE = 50;
    const MAX_PAGES = 10; // 500 most-recent articles of this type is plenty

    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const { error, message, data } = await (
          await this.fetch(
            `${ZALO_API}/article/getslice?offset=${page * PAGE}&limit=${PAGE}&type=${type}`,
            {
              method: 'GET',
              headers: { access_token: accessToken },
            },
            this.identifier
          )
        ).json();

        if (error === -216 || error === -220) {
          throw new RefreshToken(
            this.identifier,
            JSON.stringify({ error, message }),
            '{}',
            'Zalo access token expired'
          );
        }
        if (error !== 0) {
          return { status: 'unknown' };
        }
        if (!Array.isArray(data?.medias)) {
          // a successful-looking reply we cannot read is not an empty list
          return { status: 'unknown' };
        }

        const medias: any[] = data.medias;
        if (!medias.length) {
          return { status: 'missing' };
        }

        const match = medias.find((m) => String(m?.id) === String(id));
        if (match) {
          return {
            status: 'found',
            id: String(match.id),
            link: match.link_view || '',
          };
        }

        if (medias.length < PAGE) {
          // a partial page is the end of the list
          return { status: 'missing' };
        }
      }
      // The page budget ran out while history was still unread - that is
      // not proof the article is absent.
      return { status: 'unknown' };
    } catch (err) {
      if (err instanceof RefreshToken) {
        throw err; // the workflow retries with a fresh token
      }
      return { status: 'unknown' };
    }
  }

  private async verifyArticleToken(
    accessToken: string,
    token: string
  ): Promise<{ done: boolean; id?: string }> {
    const { error, message, data } = await (
      await this.fetch(
        `${ZALO_API}/article/verify`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            access_token: accessToken,
          },
          body: JSON.stringify({ token }),
        },
        this.identifier
      )
    ).json();

    if (error === -214) {
      // documented "article is being processed" - the workflow keeps polling
      return { done: false };
    }
    if (error === -216 || error === -220) {
      throw new RefreshToken(
        this.identifier,
        JSON.stringify({ error, message }),
        '{}',
        'Zalo access token expired'
      );
    }
    if (error !== 0) {
      this.mapZaloError(error, message, 'Zalo could not verify the article');
    }
    return { done: !!data?.id, id: data?.id ? String(data.id) : undefined };
  }

  async postPending(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;
    const video = firstPost.media?.find((m) => m.type === 'video');
    const image = firstPost.media?.find((m) => m.type === 'image');

    // Article covers/avatars are fetched by Zalo server-side, so only public
    // URLs work: locally-stored media carries a disk path in `path` and its
    // fetchable URL in `url` (see PostsService.updateMedia).
    const publicUrl = (m: { path?: string; url?: string } | undefined) => {
      const url = (m as any)?.url;
      if (typeof url === 'string' && url.indexOf('http') === 0) {
        return url;
      }
      return m?.path?.indexOf('http') === 0 ? m.path : undefined;
    };

    // Covers skip attached images over the 1MB cap (Zalo would reject the
    // create otherwise) and fall back to the OA avatar, which is a small
    // already-public image; the avatar field for video articles prefers the
    // image thumbnail, then the image, then the OA avatar.
    const imageUrl = publicUrl(image);
    let coverUrl: string | undefined;
    if (image && imageUrl) {
      try {
        const size = await this.mediaSize(image.path, this.identifier);
        if (size <= MAX_COVER_BYTES) {
          coverUrl = imageUrl;
        }
      } catch (err) {
        // An unmeasurable image must not kill the publish - skip the cover
        // rather than letting Zalo reject the whole create for it.
        coverUrl = undefined;
      }
    }
    const draft = this.buildDraft(
      firstPost,
      integration.name || '',
      coverUrl || integration.picture || undefined,
      imageUrl || integration.picture || undefined
    );

    if (video) {
      // Upload now; the conversion wait moves to checkPostStatus and the
      // article itself is only created by finalizePost, so nothing here is
      // irreversible - a failure leaves only an orphaned upload.
      const token = await this.uploadArticleVideo(accessToken, video.path);
      return [
        {
          id: firstPost.id,
          postId: '',
          releaseURL: '',
          status: 'pending',
          pendingData: {
            kind: 'video_upload',
            token,
            article: draft,
            armedAt: Date.now(),
          },
        },
      ];
    }

    // No async prep for text/image articles - arm the create and let
    // checkPostStatus/finalizePost run it through the witnessed handshake.
    return [
      {
        id: firstPost.id,
        postId: '',
        releaseURL: '',
        status: 'pending',
        pendingData: {
          kind: 'article_armed',
          article: draft,
          armedAt: Date.now(),
        },
      },
    ];
  }

  override async checkPostStatus(
    accessToken: string,
    pendingData: ZaloPendingData,
    integration: Integration
  ): Promise<PendingCheckResponse> {
    // Article already accepted - resolve its token.
    if (pendingData.kind === 'article' && pendingData.token) {
      const { done, id } = await this.verifyArticleToken(
        accessToken,
        pendingData.token
      );
      if (!done) {
        return { status: 'pending', pendingData };
      }

      const link = await this.articleLink(accessToken, pendingData, id!);
      return {
        status: 'completed',
        postId: id!,
        releaseURL: link || `https://zalo.me/${integration.profile}`,
      };
    }

    // Video still converting.
    if (pendingData.kind === 'video_upload' && pendingData.token) {
      const { status, videoId } = await this.verifyVideoUpload(
        accessToken,
        pendingData.token
      );
      // status: 1 ready, 3 processing, 0 unknown; 2 locked / 4 failed / 5
      // deleted are terminal.
      if (status === 2 || status === 4 || status === 5) {
        throw new BadBody(
          this.identifier,
          JSON.stringify({ status }),
          '{}',
          'Zalo rejected the uploaded video (locked, failed or deleted)'
        );
      }
      if (status !== 1 || !videoId) {
        return { status: 'pending', pendingData };
      }
      pendingData = { ...pendingData, kind: 'video_ready', videoId };
    }

    // Armed create (article_armed or video_ready), plus a defensive case:
    // 'article' without its token is a create whose receipt was mangled.
    // Zalo's article/create has no idempotency key or client correlation
    // field, and the OA article list cannot prove which same-caption
    // article is ours - so once a create is durably armed (attempting +
    // confirmed) and its receipt never arrives, this check must neither
    // re-arm nor claim a caption match off the list. Fail closed: park the
    // post for manual reconciliation on the OA.
    if (
      (pendingData.kind === 'article' && !pendingData.token) ||
      (pendingData.attempting && pendingData.confirmed)
    ) {
      throw new BadBody(
        this.identifier,
        JSON.stringify({ kind: pendingData.kind }),
        '{}',
        'Zalo may have already published this article - check the OA before reposting to avoid duplicates'
      );
    }

    // Witness the armed create so finalizePost knows the attempt is
    // uniquely accounted for before it mutates anything. The workflow
    // persists this pendingData BEFORE running finalizePost, so a create
    // that dies after mutating leaves attempting+confirmed set for the
    // next check instead of arming a second create.
    return pendingData.attempting
      ? {
          status: 'ready',
          pendingData: { ...pendingData, confirmed: true },
        }
      : { status: 'ready', pendingData };
  }

  // Best-effort public link for an article whose existence is already
  // proven (by the verify token): an inconclusive lookup just means no
  // pretty link, never a wrong answer. Matched by the verified id, never
  // by caption - two posts may legitimately share a title/description.
  private async articleLink(
    accessToken: string,
    pendingData: ZaloPendingData,
    id: string
  ): Promise<string> {
    const lookup = await this.findArticleById(
      accessToken,
      pendingData.videoId ? 'video' : 'normal',
      id
    );
    return lookup.status === 'found' ? lookup.link : '';
  }

  // Read-only probe before arming the create: an expired token surfacing
  // inside the create's response would look exactly like a lost receipt
  // and park a post that was never created - catch it while the
  // refresh-retry is still safe.
  private async assertTokenAlive(accessToken: string) {
    const { error, message } = await (
      await this.fetch(
        `${ZALO_API}/oa/getoa`,
        {
          method: 'GET',
          headers: { access_token: accessToken },
        },
        this.identifier
      )
    ).json();

    if (error === -216 || error === -220) {
      throw new RefreshToken(
        this.identifier,
        JSON.stringify({ error, message }),
        '{}',
        'Zalo access token expired'
      );
    }
    if (error !== 0) {
      this.mapZaloError(error, message, 'Zalo could not reach the OA');
    }
  }

  override async finalizePost(
    accessToken: string,
    pendingData: ZaloPendingData,
    integration: Integration
  ): Promise<PendingCheckResponse> {
    // The one irreversible mutation, behind an arm -> confirm -> publish
    // handshake (same shape as pinterest.provider): the create only runs
    // once the attempt is durably witnessed, so a run that dies mid-create
    // is detectable by the next check and never publishes twice.
    if (!pendingData.attempting) {
      await this.assertTokenAlive(accessToken);
      return {
        status: 'pending',
        pendingData: { ...pendingData, attempting: true, confirmed: false },
      };
    }
    if (!pendingData.confirmed) {
      // Witnessed but not durably armed - this pendingData predates the
      // armed marker, so refuse to guess: bounce back through the check,
      // which stamps `confirmed` for the workflow to persist before
      // finalize is called again.
      return { status: 'pending', pendingData };
    }

    const token = await this.createArticle(
      accessToken,
      pendingData.article,
      pendingData.videoId
    );
    return {
      status: 'pending',
      pendingData: { ...pendingData, kind: 'article', token },
    };
  }

  // Blocking wrapper kept for workflow versions that still call `post`
  // instead of the pending machinery.
  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [response] = await this.postPending(
      id,
      accessToken,
      postDetails,
      integration
    );

    let pendingData = response.pendingData as ZaloPendingData;
    const started = Date.now();
    // Cap below the activity timeout: a retried activity would otherwise
    // re-upload and risk a second article.
    while (true) {
      if (Date.now() - started > 8 * 60 * 1000) {
        throw new BadBody(
          this.identifier,
          '{}',
          {} as any,
          'Zalo took too long to process the post, please check the OA before reposting'
        );
      }

      const check = await this.checkPostStatus(
        accessToken,
        pendingData,
        integration
      );

      if (check.status === 'pending') {
        pendingData = check.pendingData;
        await timer(20000);
        continue;
      }

      const result =
        check.status === 'ready'
          ? await this.finalizePost(accessToken, check.pendingData, integration)
          : check;

      if (result.status === 'completed') {
        return [
          {
            id: response.id,
            postId: result.postId,
            releaseURL: result.releaseURL,
            status: 'success',
          },
        ];
      }
      pendingData = result.pendingData;
    }
  }

  // Article stats live on the OA's article list, not a dedicated insights
  // endpoint - find the post's article and report its counters.
  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    fromDate: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');
    try {
      for (const type of ['normal', 'video'] as const) {
        const { error, data } = await (
          await this.fetch(
            `${ZALO_API}/article/getslice?offset=0&limit=50&type=${type}`,
            {
              method: 'GET',
              headers: { access_token: accessToken },
            },
            this.identifier
          )
        ).json();

        const match = (data?.medias || []).find(
          (m: any) => String(m.id) === String(postId)
        );
        if (match) {
          const result: AnalyticsData[] = [];
          if (match.total_view !== undefined) {
            result.push({
              label: 'Views',
              percentageChange: 0,
              data: [{ total: String(match.total_view), date: today }],
            });
          }
          if (match.total_share !== undefined) {
            result.push({
              label: 'Shares',
              percentageChange: 0,
              data: [{ total: String(match.total_share), date: today }],
            });
          }
          return result;
        }
      }
      return [];
    } catch (err) {
      console.error('Error fetching Zalo post analytics:', err);
      return [];
    }
  }
}
