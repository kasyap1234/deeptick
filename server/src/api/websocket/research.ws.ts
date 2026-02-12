import { Elysia, t } from 'elysia';
import { researchService } from '../../services/research.service.js';
import type { WebSocketLike } from '../../types/research.types.js';

export const researchWebSocket = new Elysia()
  .ws('/ws/research/:jobId?', {
    params: t.Object({
      jobId: t.Optional(t.String()),
    }),
    
    open(ws) {
      const jobId = ws.data.params.jobId;
      
      if (jobId) {
        const wsLike = ws as unknown as WebSocketLike;
        researchService.registerWebSocket(jobId, wsLike);
        
        const job = researchService.getJob(jobId);
        ws.send(JSON.stringify({
          type: 'status',
          jobId,
          payload: { status: job?.status || 'unknown' },
          timestamp: new Date(),
        }));
      }
    },

    message(ws, message) {
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
            const wsLike = ws as unknown as WebSocketLike;
            researchService.registerWebSocket(data.jobId, wsLike);
            
            const job = researchService.getJob(data.jobId);
            ws.send(JSON.stringify({
              type: 'status',
              jobId: data.jobId,
              payload: { status: job?.status || 'unknown' },
              timestamp: new Date(),
            }));
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
            researchService.createResearchJob({
              query: data.query,
              context: data.context,
              focusAreas: data.focusAreas,
            }).then((job) => {
              const wsLike = ws as unknown as WebSocketLike;
              researchService.registerWebSocket(job.id, wsLike);
              
              ws.send(JSON.stringify({
                type: 'status',
                jobId: job.id,
                payload: { status: job.status },
                timestamp: new Date(),
              }));
            });
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
