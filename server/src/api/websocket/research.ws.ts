import { Elysia, t } from 'elysia';
import { researchService } from '../../services/research.service.js';
import { auth } from '../../services/auth/index.js';
import { getDb } from '../../db/connection.js';
import { researchJobs } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import type { WebSocketLike } from '../../types/research.types.js';

async function getSessionFromWs(ws: { data: unknown }): Promise<{ user: { id: string } } | null> {
  const headers =
    (ws.data as { request?: { headers?: Headers } } | undefined)?.request?.headers
    ?? (ws.data as { headers?: Headers } | undefined)?.headers;
  if (!headers) return null;
  try {
    return await auth.api.getSession({ headers });
  } catch {
    return null;
  }
}

async function verifyJobOwnership(userId: string, jobId: string): Promise<boolean> {
  const db = getDb();
  const [job] = await db
    .select({ userId: researchJobs.userId })
    .from(researchJobs)
    .where(eq(researchJobs.id, jobId))
    .limit(1);
  return !!job && job.userId === userId;
}

function sendError(ws: { send: (data: string) => void }, message: string, code: string) {
  ws.send(JSON.stringify({
    type: 'error',
    payload: { error: message, code },
    timestamp: new Date(),
  }));
}

export const researchWebSocket = new Elysia()
  .ws('/ws/research/:jobId?', {
    params: t.Object({
      jobId: t.Optional(t.String()),
    }),

    async open(ws) {
      const session = await getSessionFromWs(ws);
      if (!session?.user?.id) {
        sendError(ws, 'Authentication required', 'auth_required');
        ws.close();
        return;
      }

      // Store userId on the ws data for later message handlers
      (ws.data as Record<string, unknown>).__userId = session.user.id;

      const jobId = ws.data.params.jobId;
      if (jobId) {
        const isOwner = await verifyJobOwnership(session.user.id, jobId);
        if (!isOwner) {
          sendError(ws, 'Not authorized for this research job', 'forbidden');
          ws.close();
          return;
        }

        const wsLike = ws as unknown as WebSocketLike;
        researchService.registerWebSocket(jobId, wsLike);

        const job = researchService.getJob(jobId);
        const progress = researchService.getProgress(jobId);
        ws.send(JSON.stringify({
          type: 'status',
          jobId,
          payload: { status: job?.status || 'unknown' },
          timestamp: new Date(),
        }));

        if (progress) {
          ws.send(JSON.stringify({
            type: 'progress',
            jobId,
            payload: progress,
            timestamp: new Date(),
          }));
        }
      }
    },

    async message(ws, message) {
      const userId = (ws.data as Record<string, unknown>).__userId as string | undefined;
      if (!userId) {
        sendError(ws, 'Authentication required', 'auth_required');
        return;
      }

      const data = message as {
        type: 'subscribe' | 'unsubscribe' | 'start_research';
        jobId?: string;
        query?: string;
        context?: string;
        focusAreas?: string[];
      };

      switch (data.type) {
        case 'subscribe': {
          if (data.jobId) {
            const isOwner = await verifyJobOwnership(userId, data.jobId);
            if (!isOwner) {
              sendError(ws, 'Not authorized for this research job', 'forbidden');
              break;
            }

            const wsLike = ws as unknown as WebSocketLike;
            researchService.registerWebSocket(data.jobId, wsLike);

            const job = researchService.getJob(data.jobId);
            const progress = researchService.getProgress(data.jobId);
            ws.send(JSON.stringify({
              type: 'status',
              jobId: data.jobId,
              payload: { status: job?.status || 'unknown' },
              timestamp: new Date(),
            }));

            if (progress) {
              ws.send(JSON.stringify({
                type: 'progress',
                jobId: data.jobId,
                payload: progress,
                timestamp: new Date(),
              }));
            }
          }
          break;
        }

        case 'unsubscribe': {
          if (data.jobId) {
            const wsLike = ws as unknown as WebSocketLike;
            researchService.unregisterWebSocket(data.jobId, wsLike);
          }
          break;
        }

        case 'start_research': {
          if (data.query) {
            try {
              const job = await researchService.createResearchJob({
                userId,
                query: data.query,
                context: data.context,
                focusAreas: data.focusAreas,
              });
              const wsLike = ws as unknown as WebSocketLike;
              researchService.registerWebSocket(job.id, wsLike);

              ws.send(JSON.stringify({
                type: 'status',
                jobId: job.id,
                payload: { status: job.status },
                timestamp: new Date(),
              }));
            } catch (error) {
              ws.send(JSON.stringify({
                type: 'error',
                payload: {
                  error: error instanceof Error ? error.message : 'Failed to create research job',
                  code: 'provider_error',
                },
                timestamp: new Date(),
              }));
            }
          }
          break;
        }
      }
    },

    close(ws) {
      const jobId = ws.data.params.jobId;
      if (jobId) {
        const wsLike = ws as unknown as WebSocketLike;
        researchService.unregisterWebSocket(jobId, wsLike);
      }
    },
  });
