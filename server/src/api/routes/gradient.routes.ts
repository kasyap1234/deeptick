import { Elysia, t } from 'elysia';
import { gradientResearchService } from '../../services/gradient-research.service.js';
import { gradientAgentFactory } from '../../services/gradient-agent-factory.js';
import { gradientKnowledgeBaseService } from '../../services/gradient-kb.service.js';
import { logger } from '../../utils/logger.js';

const CreateGradientResearchSchema = t.Object({
  query: t.String({ minLength: 1 }),
  context: t.Optional(t.String()),
  focusAreas: t.Optional(t.Array(t.String())),
  useGradientNative: t.Optional(t.Boolean()),
});

const CreateKnowledgeBaseSchema = t.Object({
  name: t.String({ minLength: 1 }),
  dataSources: t.Optional(t.Array(t.Object({
    name: t.String(),
    url: t.String(),
  }))),
});

export const gradientRoutes = new Elysia({ prefix: '/api/gradient' })
  .post('/research', async ({ body, set }) => {
    try {
      const job = await gradientResearchService.createGradientResearchJob({
        query: body.query,
        context: body.context,
        focusAreas: body.focusAreas,
        useGradientNative: body.useGradientNative ?? true,
      });

      set.status = 202;
      return {
        success: true,
        data: {
          jobId: job.id,
          status: job.status,
          query: job.query,
          createdAt: job.createdAt,
          agentId: job.metadata?.gradientAgentId,
          knowledgeBaseId: job.metadata?.gradientKnowledgeBaseId,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to create Gradient research job');
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create research job',
      };
    }
  }, {
    body: CreateGradientResearchSchema,
  })

  .post('/research/:jobId/stream', async ({ params, body, set }) => {
    try {
      const request = body as { query: string; context?: string; focusAreas?: string[] };
      
      set.headers['Content-Type'] = 'text/event-stream';
      set.headers['Cache-Control'] = 'no-cache';
      set.headers['Connection'] = 'keep-alive';

      const encoder = new TextEncoder();
      const readableStream = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of await gradientResearchService.streamGradientResearch(
              params.jobId,
              {
                query: request.query,
                context: request.context,
                focusAreas: request.focusAreas,
              }
            )) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch (error) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: String(error) })}\n\n`));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readableStream);
    } catch (error) {
      logger.error({ error, jobId: params.jobId }, 'Failed to stream Gradient research');
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stream research',
      };
    }
  })

  .post('/knowledge-bases', async ({ body, set }) => {
    try {
      const kb = await gradientAgentFactory.createKnowledgeBaseForResearch(
        body.name,
        body.dataSources
      );

      return {
        success: true,
        data: {
          id: kb.id,
          name: kb.name,
          status: kb.status,
          createdAt: kb.createdAt,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to create knowledge base');
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create knowledge base',
      };
    }
  }, {
    body: CreateKnowledgeBaseSchema,
  })

  .get('/knowledge-bases', async ({ set }) => {
    try {
      const kbs = await gradientKnowledgeBaseService.listKnowledgeBases();

      return {
        success: true,
        data: kbs.map((kb) => ({
          id: kb.id,
          name: kb.name,
          status: kb.status,
          createdAt: kb.createdAt,
        })),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to list knowledge bases');
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list knowledge bases',
      };
    }
  })

  .get('/knowledge-bases/:kbId', async ({ params, set }) => {
    try {
      const kb = await gradientKnowledgeBaseService.getKnowledgeBase(params.kbId);

      return {
        success: true,
        data: {
          id: kb.id,
          name: kb.name,
          status: kb.status,
          embeddingModelUrn: kb.embeddingModelUrn,
          createdAt: kb.createdAt,
        },
      };
    } catch (error) {
      logger.error({ error, kbId: params.kbId }, 'Failed to get knowledge base');
      set.status = 404;
      return {
        success: false,
        error: 'Knowledge base not found',
      };
    }
  })

  .delete('/knowledge-bases/:kbId', async ({ params, set }) => {
    try {
      await gradientKnowledgeBaseService.deleteKnowledgeBase(params.kbId);

      return {
        success: true,
        message: 'Knowledge base deleted',
      };
    } catch (error) {
      logger.error({ error, kbId: params.kbId }, 'Failed to delete knowledge base');
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete knowledge base',
      };
    }
  })

  .post('/knowledge-bases/:kbId/search', async ({ params, body, set }) => {
    try {
      const searchBody = body as { query: string; limit?: number };
      const results = await gradientKnowledgeBaseService.searchKnowledgeBase(
        params.kbId,
        searchBody.query,
        searchBody.limit
      );

      return {
        success: true,
        data: results,
      };
    } catch (error) {
      logger.error({ error, kbId: params.kbId }, 'Failed to search knowledge base');
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search knowledge base',
      };
    }
  })

  .post('/knowledge-bases/:kbId/index', async ({ params, set }) => {
    try {
      await gradientKnowledgeBaseService.indexKnowledgeBase(params.kbId);

      return {
        success: true,
        message: 'Knowledge base indexing initiated',
      };
    } catch (error) {
      logger.error({ error, kbId: params.kbId }, 'Failed to index knowledge base');
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to index knowledge base',
      };
    }
  })

  .get('/agents', async ({ set }) => {
    try {
      const agents = await gradientAgentFactory.getOrCreateResearchAgent('list-check', undefined);
      const allAgents = await (await import('../services/gradient-agent.service.js')).gradientAgentService.listAgents();

      return {
        success: true,
        data: allAgents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          modelUuid: agent.modelUuid,
          createdAt: agent.createdAt,
        })),
      };
    } catch (error) {
      logger.error({ error }, 'Failed to list agents');
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list agents',
      };
    }
  })

  .post('/agents/:agentId/invoke', async ({ params, body, set }) => {
    try {
      const invokeBody = body as { message: string; stream?: boolean };
      
      if (invokeBody.stream) {
        set.headers['Content-Type'] = 'text/event-stream';
        
        const stream = await (await import('../services/gradient-agent.service.js')).gradientAgentService
          .streamAgent(params.agentId, invokeBody.message);

        const encoder = new TextEncoder();
        const readableStream = new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of stream) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: chunk })}\n\n`));
              }
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } finally {
              controller.close();
            }
          },
        });

        return new Response(readableStream);
      }

      const result = await (await import('../services/gradient-agent.service.js')).gradientAgentService
        .invokeAgent(params.agentId, invokeBody.message);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      logger.error({ error, agentId: params.agentId }, 'Failed to invoke agent');
      set.status = 500;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to invoke agent',
      };
    }
  });
