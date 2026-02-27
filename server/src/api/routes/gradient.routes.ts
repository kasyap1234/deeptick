import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { config } from '../../config/index.js';
import { gradientKnowledgeBaseService } from '../../services/gradient-kb.service.js';
import { gradientAgentService } from '../../services/gradient-agent.service.js';
import { researchService } from '../../services/research.service.js';
import { getDb } from '../../db/connection.js';
import { userKnowledgeBases } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { authMacro } from '../../plugins/better-auth.plugin.js';
import { toApiError } from '../../utils/api-error.js';

const CreateKnowledgeBaseSchema = t.Object({
  name: t.String({ minLength: 1 }),
  description: t.Optional(t.String()),
  purpose: t.Optional(t.String()),
});

const KBSearchSchema = t.Object({
  query: t.String({ minLength: 1 }),
  limit: t.Optional(t.Number({ minimum: 1, maximum: 100 })),
});

const GradientResearchSchema = t.Object({
  query: t.String({ minLength: 1 }),
  context: t.Optional(t.String()),
  focusAreas: t.Optional(t.Array(t.String())),
  maxResults: t.Optional(t.Number({ minimum: 1, maximum: 50 })),
});

const AgentInvokeSchema = t.Object({
  message: t.String({ minLength: 1 }),
  stream: t.Optional(t.Boolean()),
});

function routeError(set: { status: number }, error: unknown, fallbackMessage: string) {
  const mapped = toApiError(error, fallbackMessage);
  set.status = mapped.status;
  return mapped.body;
}

export const gradientRoutes = new Elysia({ prefix: '/api/gradient' })
  .use(authMacro)
  .get('/knowledge-bases', async ({ set, user }) => {
    try {
      const db = getDb();
      const userKBs = await db
        .select({
          id: userKnowledgeBases.id,
          purpose: userKnowledgeBases.purpose,
          gradientKbId: userKnowledgeBases.gradientKbId,
          name: userKnowledgeBases.name,
          description: userKnowledgeBases.description,
          createdAt: userKnowledgeBases.createdAt,
          updatedAt: userKnowledgeBases.updatedAt,
        })
        .from(userKnowledgeBases)
        .where(eq(userKnowledgeBases.userId, user.id));

      return { success: true, data: userKBs };
    } catch (error) {
      logger.error({ error }, 'Failed to list knowledge bases');
      return routeError(set, error, 'Failed to list knowledge bases');
    }
  }, { auth: true })

  .post('/knowledge-bases', async ({ body, set, user }) => {
    try {
      const kb = await gradientKnowledgeBaseService.createKnowledgeBase({
        name: body.name,
        description: body.description ?? 'User knowledge base',
      });

      const db = getDb();
      const [userKB] = await db
        .insert(userKnowledgeBases)
        .values({
          userId: user.id,
          purpose: (body.purpose ?? 'general') as 'research' | 'chat' | 'cache' | 'general',
          gradientKbId: kb.id,
          name: kb.name,
          description: body.description,
        })
        .returning();

      return {
        success: true,
        data: {
          id: userKB.id,
          gradientKbId: kb.id,
          name: kb.name,
          status: kb.status,
          createdAt: userKB.createdAt,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to create knowledge base');
      return routeError(set, error, 'Failed to create knowledge base');
    }
  }, {
    auth: true,
    body: CreateKnowledgeBaseSchema,
  })

  .get('/knowledge-bases/:kbId', async ({ params, set, user }) => {
    try {
      const db = getDb();
      const [userKB] = await db
        .select({
          id: userKnowledgeBases.id,
          purpose: userKnowledgeBases.purpose,
          gradientKbId: userKnowledgeBases.gradientKbId,
          name: userKnowledgeBases.name,
          description: userKnowledgeBases.description,
          createdAt: userKnowledgeBases.createdAt,
          updatedAt: userKnowledgeBases.updatedAt,
          userId: userKnowledgeBases.userId,
        })
        .from(userKnowledgeBases)
        .where(eq(userKnowledgeBases.id, params.kbId))
        .limit(1);

      if (!userKB || userKB.userId !== user.id) {
        set.status = 404;
        return { success: false, error: 'Knowledge base not found' };
      }

      const kb = await gradientKnowledgeBaseService.getKnowledgeBase(userKB.gradientKbId);

      return {
        success: true,
        data: {
          id: userKB.id,
          gradientKbId: kb.id,
          name: kb.name,
          status: kb.status,
          embeddingModelUrn: kb.embeddingModelUrn,
          createdAt: userKB.createdAt,
        },
      };
    } catch (error) {
      logger.error({ error, kbId: params.kbId }, 'Failed to get knowledge base');
      return routeError(set, error, 'Failed to get knowledge base');
    }
  }, { auth: true })

  .delete('/knowledge-bases/:kbId', async ({ params, set, user }) => {
    try {
      const db = getDb();
      const [userKB] = await db
        .select({ gradientKbId: userKnowledgeBases.gradientKbId, userId: userKnowledgeBases.userId })
        .from(userKnowledgeBases)
        .where(eq(userKnowledgeBases.id, params.kbId))
        .limit(1);

      if (!userKB || userKB.userId !== user.id) {
        set.status = 404;
        return { success: false, error: 'Knowledge base not found' };
      }

      await gradientKnowledgeBaseService.deleteKnowledgeBase(userKB.gradientKbId);
      await db.delete(userKnowledgeBases).where(eq(userKnowledgeBases.id, params.kbId));

      return { success: true, message: 'Knowledge base deleted' };
    } catch (error) {
      logger.error({ error, kbId: params.kbId }, 'Failed to delete knowledge base');
      return routeError(set, error, 'Failed to delete knowledge base');
    }
  }, { auth: true })

  .post('/knowledge-bases/:kbId/search', async ({ params, body, set, user }) => {
    try {
      const db = getDb();
      const [userKB] = await db
        .select({ gradientKbId: userKnowledgeBases.gradientKbId, userId: userKnowledgeBases.userId })
        .from(userKnowledgeBases)
        .where(eq(userKnowledgeBases.id, params.kbId))
        .limit(1);

      if (!userKB || userKB.userId !== user.id) {
        set.status = 404;
        return { success: false, error: 'Knowledge base not found' };
      }

      const results = await gradientKnowledgeBaseService.searchKnowledgeBase(
        userKB.gradientKbId,
        body.query,
        body.limit
      );

      return { success: true, data: results };
    } catch (error) {
      logger.error({ error, kbId: params.kbId }, 'Failed to search knowledge base');
      return routeError(set, error, 'Failed to search knowledge base');
    }
  }, { auth: true, body: KBSearchSchema })

  .post('/knowledge-bases/:kbId/index', async ({ params, set, user }) => {
    try {
      const db = getDb();
      const [userKB] = await db
        .select({ gradientKbId: userKnowledgeBases.gradientKbId, userId: userKnowledgeBases.userId })
        .from(userKnowledgeBases)
        .where(eq(userKnowledgeBases.id, params.kbId))
        .limit(1);

      if (!userKB || userKB.userId !== user.id) {
        set.status = 404;
        return { success: false, error: 'Knowledge base not found' };
      }

      await gradientKnowledgeBaseService.indexKnowledgeBase(userKB.gradientKbId);

      return { success: true, message: 'Knowledge base indexing initiated' };
    } catch (error) {
      logger.error({ error, kbId: params.kbId }, 'Failed to index knowledge base');
      return routeError(set, error, 'Failed to index knowledge base');
    }
  }, { auth: true })

  .post('/research', async ({ body, set, user }) => {
    try {
      // Create research job using the regular research service
      const job = await researchService.createResearchJob({
        userId: user.id,
        query: body.query,
        context: body.context,
        focusAreas: body.focusAreas,
        maxResults: body.maxResults,
      });

      set.status = 202;
      return {
        success: true,
        data: {
          jobId: job.id,
          status: job.status,
          query: job.query,
          createdAt: job.createdAt,
        },
      };
    } catch (error) {
      logger.error({ error }, 'Failed to create Gradient research job');
      return routeError(set, error, 'Failed to create research job');
    }
  }, { auth: true, body: GradientResearchSchema })

  .get('/agents', async ({ set }) => {
    if (!config.gradient.projectId || !config.DO_GENAI_API_KEY) {
      return {
        success: true,
        data: [],
      };
    }
    try {
      const agents = await gradientAgentService.listAgents();

      return {
        success: true,
        data: agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          modelUuid: agent.modelUuid,
          createdAt: agent.createdAt,
        })),
      };
    } catch (error) {
      // Gracefully handle auth failures — the GenAI API key may not have
      // permissions for the Agent Management API.
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('401') || msg.includes('Unauthorized')) {
        logger.warn('Gradient Agent API returned 401 — agent listing unavailable');
        return { success: true, data: [] };
      }
      logger.error({ error }, 'Failed to list agents');
      return routeError(set, error, 'Failed to list agents');
    }
  }, { auth: true })

  .post('/agents/:agentId/invoke', async ({ params, body, set }) => {
    try {
      if (body.stream) {
        set.headers['Content-Type'] = 'text/event-stream';

        const stream = await gradientAgentService.streamAgent(
          params.agentId,
          body.message
        );

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

      const result = await gradientAgentService.invokeAgent(
        params.agentId,
        body.message
      );

      return { success: true, data: result };
    } catch (error) {
      logger.error({ error, agentId: params.agentId }, 'Failed to invoke agent');
      return routeError(set, error, 'Failed to invoke agent');
    }
  }, { auth: true, body: AgentInvokeSchema });
