import { Body, Controller, HttpException, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DataDeletionService } from '@gitroom/nestjs-libraries/database/prisma/data-deletion/data-deletion.service';
import { ThrottlerRealIpGuard } from '@gitroom/nestjs-libraries/throttler/throttler.provider';

// Public endpoints backing the legal pages Meta App Review requires
// (/privacy, /terms, /data-deletion). No auth: the person filing a deletion
// request may have no account, matching the connect-link precedent.
@ApiTags('Legal')
@Controller('/legal')
export class LegalController {
  constructor(private _dataDeletionService: DataDeletionService) {}

  // Records a deletion request for a human to action. Deliberately records
  // only the email + free-text note: the requester cannot attach this to an
  // organization id they do not own, and the admin-side workflow verifies
  // the account before deleting anything.
  @UseGuards(ThrottlerRealIpGuard)
  @Throttle({ default: { limit: 10, ttl: 3600000 } })
  @Post('/data-deletion-request')
  async createDataDeletionRequest(
    @Body() body: { email?: string; note?: string }
  ) {
    const email = (body?.email || '').trim();
    if (
      !email ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      throw new HttpException(
        { msg: 'A valid email address is required' },
        400
      );
    }

    const request = await this._dataDeletionService.createRequest({
      email,
      ...(typeof body?.note === 'string' && body.note.trim()
        ? { note: body.note }
        : {}),
    });

    return { id: request.id, received: true };
  }
}
