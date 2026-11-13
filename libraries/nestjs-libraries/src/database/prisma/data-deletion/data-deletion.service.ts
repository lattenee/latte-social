import { Injectable } from '@nestjs/common';
import { DataDeletionRepository } from '@gitroom/nestjs-libraries/database/prisma/data-deletion/data-deletion.repository';

@Injectable()
export class DataDeletionService {
  constructor(private _repository: DataDeletionRepository) {}

  createRequest(input: { email: string; organizationId?: string; note?: string }) {
    return this._repository.createRequest(input);
  }

  listOpen(page = 0, limit = 20) {
    return this._repository.listOpen(page, Math.min(Math.max(limit, 1), 100));
  }

  resolve(id: string) {
    return this._repository.resolve(id);
  }
}
