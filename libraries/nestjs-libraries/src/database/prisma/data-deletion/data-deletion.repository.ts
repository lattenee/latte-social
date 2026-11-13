import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class DataDeletionRepository extends PrismaRepository<'dataDeletionRequest'> {
  createRequest(input: { email: string; organizationId?: string; note?: string }) {
    return this.model.dataDeletionRequest.create({
      data: {
        email: input.email.trim().toLowerCase(),
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
        ...(input.note ? { note: input.note.slice(0, 2000) } : {}),
      },
      select: { id: true, createdAt: true },
    });
  }

  listOpen(page: number, limit: number) {
    return this.model.dataDeletionRequest.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'desc' },
      skip: page * limit,
      take: limit,
      select: {
        id: true,
        email: true,
        organizationId: true,
        note: true,
        status: true,
        createdAt: true,
      },
    });
  }

  resolve(id: string) {
    return this.model.dataDeletionRequest.updateMany({
      where: { id, status: 'open' },
      data: { status: 'resolved', resolvedAt: new Date() },
    });
  }
}
