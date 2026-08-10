import type { Prisma, PrismaClient } from "@prisma/client";

type AuditDatabase = Pick<PrismaClient, "auditLog"> | Prisma.TransactionClient;

export type AuditEvent = {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Prisma.InputJsonValue | undefined;
  ipAddress: string | undefined;
  userAgent: string | undefined;
};

export async function writeAuditEvent(database: AuditDatabase, event: AuditEvent): Promise<void> {
  await database.auditLog.create({
    data: {
      actorUserId: event.actorUserId,
      action: event.action,
      entityType: event.entityType,
      ...(event.entityId !== null ? { entityId: event.entityId } : {}),
      ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
      ...(event.ipAddress !== undefined ? { ipAddress: event.ipAddress } : {}),
      ...(event.userAgent !== undefined ? { userAgent: event.userAgent } : {}),
    },
  });
}
