import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { gradientKnowledgeBaseService } from '../../services/gradient-kb.service.js';
import { gradientAgentService } from '../../services/gradient-agent.service.js';
import { getDb } from '../../db/connection.js';
import { userKnowledgeBases } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { authMiddleware } from '../../middleware/auth.js';

const CreateKnowledgeBaseSchema = t.Object({
  name: t.String({ minLength: 1 }),
  description: t.Optional(t.String()),
  purpose: t.Optional(t.String()),
});

export const gradientRoutes = new Elysia({ prefix: '/api/gradient' })
  .get('/knowledge-bases', async ({ set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

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
        .where(eq(userKnowledgeBases.userId, authResult.userId));

      return { success: true, data: userKBs };
    } catch (error) {
      logger.error({ error }, 'Failed to list knowledge bases');
      set.status = 500;
      return { success: false, error: 'Failed to list knowledge bases' };
    }
  })

  .post('/knowledge-bases', async ({ body, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    try {
      const kb = await gradientKnowledgeBaseService.createKnowledgeBase({
        name: body.name,
        description: body.description ?? 'User knowledge base',
      });

      const db = getDb();
      const [userKB] = await db
        .insert(userKnowledgeBases)
        .values({
          userId: authResult.userId,
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
      set.status = 500;
      return { success: false, error: 'Failed to create knowledge base' };
    }
  }, {
    body: CreateKnowledgeBaseSchema,
  })

  .get('/knowledge-bases/:kbId', async ({ params, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

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

      if (!userKB || userKB.userId !== authResult.userId) {
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
      set.status = 500;
      return { success: false, error: 'Failed to get knowledge base' };
    }
  })

  .delete('/knowledge-bases/:kbId', async ({ params, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    try {
      const db = getDb();
      const [userKB] = await db
        .select({ gradientKbId: userKnowledgeBases.gradientKbId, userId: userKnowledgeBases.userId })
        .from(userKnowledgeBases)
        .where(eq(userKnowledgeBases.id, params.kbId))
        .limit(1);

      if (!userKB || userKB.userId !== authResult.userId) {
        set.status = 404;
        return { success: false, error: 'Knowledge base not found' };
      }

      await gradientKnowledgeBaseService.deleteKnowledgeBase(userKB.gradientKbId);
      await db.delete(userKnowledgeBases).where(eq(userKnowledgeBases.id, params.kbId));

      return { success: true, message: 'Knowledge base deleted' };
    } catch (error) {
      logger.error({ error, kbId: params.kbId }, 'Failed to delete knowledge base');
      set.status = 500;
      return { success: false, error: 'Failed to delete knowledge base' };
    }
  })

  .post('/knowledge-bases/:kbId/search', async ({ params, body, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    try {
      const db = getDb();
      const [userKB] = await db
        .select({ gradientKbId: userKnowledgeBases.gradientKbId, userId: userKnowledgeBases.userId })
        .from(userKnowledgeBases)
        .where(eq(userKnowledgeBases.id, params.kbId))
        .limit(1);

      if (!userKB || userKB.userId !== authResult.userId) {
        set.status = 404;
        return { success: false, error: 'Knowledge base not found' };
      }

      const searchBody = body as { query: string; limit?: number };
      const results = await gradientKnowledgeBaseService.searchKnowledgeBase(
        userKB.gradientKbId,
        searchBody.query,
        searchBody.limit
      );

      return { success: true, data: results };
    } catch (error) {
      logger.error({ error, kbId: params.kbId }, 'Failed to search knowledge base');
      set.status = 500;
      return { success: false, error: 'Failed to search knowledge base' };
    }
  })

  .post('/knowledge-bases/:kbId/index', async ({ params, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    try {
      const db = getDb();
      const [userKB] = await db
        .select({ gradientKbId: userKnowledgeBases.gradientKbId, userId: userKnowledgeBases.userId })
        .from(userKnowledgeBases)
        .where(eq(userKnowledgeBases.id, params.kbId))
        .limit(1);

      if (!userKB || userKB.userId !== authResult.userId) {
        set.status = 404;
        return { success: false, error: 'Knowledge base not found' };
      }

      await gradientKnowledgeBaseService.indexKnowledgeBase(userKB.gradientKbId);

      return { success: true, message: 'Knowledge base indexing initiated' };
    } catch (error) {
      logger.error({ error, kbId: params.kbId }, 'Failed to index knowledge base');
      set.status = 500;
      return { success: false, error: 'Failed to index knowledge base' };
    }
  })

  .get('/agents', async ({ set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

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
      logger.error({ error }, 'Failed to list agents');
      set.status = 500;
      return { success: false, error: 'Failed to list agents' };
    }
  })

  .post('/agents/:agentId/invoke', async ({ params, body, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    try {
      const invokeBody = body as { message: string; stream?: boolean };
      
      if (invokeBody.stream) {
        set.headers['Content-Type'] = 'text/event-stream';
        
        const stream = await gradientAgentService.streamAgent(
          params.agentId,
          invokeBody.message
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
        invokeBody.message
      );

      return { success: true, data: result };
    } catch (error) {
      logger.error({ error, agentId: params.agentId }, 'Failed to invoke agent');
      set.status = 500;
      return { success: false, error: 'Failed to invoke agent' };
    }
  });
