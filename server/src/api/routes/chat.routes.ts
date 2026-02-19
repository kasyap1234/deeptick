import { Elysia, t } from 'elysia';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../../db/connection.js';
import { conversations, messages } from '../../db/schema.js';
import { authMiddleware } from '../../middleware/auth.js';
import { chatService } from '../../services/chat.service.js';

const CreateConversationSchema = t.Object({
  title: t.Optional(t.String()),
  context: t.Optional(t.Object({
    currentStock: t.Optional(t.String()),
    currentSector: t.Optional(t.String()),
    lastResearchJobId: t.Optional(t.String()),
    metadata: t.Optional(t.Record(t.String(), t.Unknown())),
  })),
});

const SendMessageSchema = t.Object({
  content: t.String({ minLength: 1 }),
  role: t.Optional(t.Union([t.Literal('user'), t.Literal('assistant'), t.Literal('system')])),
  sources: t.Optional(t.Array(t.Object({
    url: t.String(),
    title: t.String(),
  }))),
});

export const chatRoutes = new Elysia({ prefix: '/api/chat' })
  .post('/conversations', async ({ body, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const db = getDb();
    const [conversation] = await db
      .insert(conversations)
      .values({
        userId: authResult.userId,
        title: body.title ?? 'New Conversation',
        context: body.context ?? {},
      })
      .returning();

    set.status = 201;
    return {
      success: true,
      data: {
        conversationId: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
      },
    };
  }, {
    body: CreateConversationSchema,
  })

  .get('/conversations', async ({ query, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const db = getDb();
    const limit = parseInt(query?.limit ?? '20');
    const offset = parseInt(query?.offset ?? '0');

    const userConversations = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        context: conversations.context,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(eq(conversations.userId, authResult.userId))
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset);

    return {
      success: true,
      data: userConversations,
    };
  })

  .get('/conversations/:conversationId', async ({ params, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const db = getDb();
    const [conversation] = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        context: conversations.context,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        userId: conversations.userId,
      })
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .limit(1);

    if (!conversation || conversation.userId !== authResult.userId) {
      set.status = 404;
      return { success: false, error: 'Conversation not found' };
    }

    return { success: true, data: conversation };
  })

  .get('/conversations/:conversationId/messages', async ({ params, query, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const db = getDb();
    const limit = parseInt(query?.limit ?? '50');

    const [conversation] = await db
      .select({ userId: conversations.userId })
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .limit(1);

    if (!conversation || conversation.userId !== authResult.userId) {
      set.status = 404;
      return { success: false, error: 'Conversation not found' };
    }

    const userMessages = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        sources: messages.sources,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, params.conversationId))
      .orderBy(messages.createdAt)
      .limit(limit);

    return { success: true, data: userMessages };
  })

  .post('/conversations/:conversationId/messages', async ({ params, body, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const db = getDb();
    
    const [conversation] = await db
      .select({ userId: conversations.userId, context: conversations.context })
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .limit(1);

    if (!conversation || conversation.userId !== authResult.userId) {
      set.status = 404;
      return { success: false, error: 'Conversation not found' };
    }

    const previousMessages = await db
      .select({
        role: messages.role,
        content: messages.content,
      })
      .from(messages)
      .where(eq(messages.conversationId, params.conversationId))
      .orderBy(messages.createdAt)
      .limit(10);

    const [message] = await db
      .insert(messages)
      .values({
        userId: authResult.userId,
        conversationId: params.conversationId,
        role: (body.role ?? 'user') as 'user' | 'assistant' | 'system',
        content: body.content,
        sources: body.sources ?? [],
      })
      .returning();

    const responseContent = await chatService.generateResponse(
      body.content,
      {
        previousMessages: previousMessages.map(m => ({ role: m.role, content: m.content })),
        stockContext: (conversation.context as Record<string, unknown>)?.currentStock as string | undefined,
      }
    );

    const [assistantMessage] = await db
      .insert(messages)
      .values({
        userId: authResult.userId,
        conversationId: params.conversationId,
        role: 'assistant',
        content: responseContent,
        sources: [],
      })
      .returning();

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, params.conversationId));

    return { success: true, data: { userMessage: message, assistantMessage } };
  }, {
    body: SendMessageSchema,
  })

  .post('/conversations/:conversationId/stream', async ({ params, body, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const db = getDb();
    
    const [conversation] = await db
      .select({ userId: conversations.userId, context: conversations.context })
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .limit(1);

    if (!conversation || conversation.userId !== authResult.userId) {
      set.status = 404;
      return { success: false, error: 'Conversation not found' };
    }

    const messageBody = body as { content: string };
    
    const [userMessage] = await db
      .insert(messages)
      .values({
        userId: authResult.userId,
        conversationId: params.conversationId,
        role: 'user',
        content: messageBody.content,
        sources: [],
      })
      .returning();

    const previousMessages = await db
      .select({
        role: messages.role,
        content: messages.content,
      })
      .from(messages)
      .where(eq(messages.conversationId, params.conversationId))
      .orderBy(messages.createdAt)
      .limit(10);

    set.headers['Content-Type'] = 'text/event-stream';
    set.headers['Cache-Control'] = 'no-cache';
    set.headers['Connection'] = 'keep-alive';

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const fullResponse: string[] = [];
          
          for await (const chunk of chatService.streamResponse(
            messageBody.content,
            {
              previousMessages: previousMessages.map(m => ({ role: m.role, content: m.content })),
              stockContext: (conversation.context as Record<string, unknown>)?.currentStock as string | undefined,
            }
          )) {
            fullResponse.push(chunk);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`));
          }

          await db
            .insert(messages)
            .values({
              userId: authResult.userId,
              conversationId: params.conversationId,
              role: 'assistant',
              content: fullResponse.join(''),
              sources: [],
            })
            .returning();

          await db
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, params.conversationId));

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (error) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'Stream failed' })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream);
  }, {
    body: t.Object({
      content: t.String({ minLength: 1 }),
    }),
  })

  .delete('/conversations/:conversationId', async ({ params, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const db = getDb();
    
    const [conversation] = await db
      .select({ userId: conversations.userId })
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .limit(1);

    if (!conversation || conversation.userId !== authResult.userId) {
      set.status = 404;
      return { success: false, error: 'Conversation not found' };
    }

    await db.delete(conversations).where(eq(conversations.id, params.conversationId));

    set.status = 204;
    return { success: true };
  })

  .get('/search', async ({ query, set, cookie }) => {
    const authResult = await authMiddleware({ cookie, set });
    if (!authResult.success) return authResult;

    const q = (query as Record<string, string | undefined>).q;
    if (!q) {
      set.status = 400;
      return { success: false, error: 'Query parameter "q" is required' };
    }

    const db = getDb();
    const limit = parseInt((query as Record<string, string | undefined>).limit ?? '10');
    const searchLower = q.toLowerCase();

    const userConversations = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        context: conversations.context,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(eq(conversations.userId, authResult.userId))
      .limit(limit);

    const filtered = userConversations.filter(c => 
      c.title?.toLowerCase().includes(searchLower)
    );

    return { success: true, data: filtered };
  });
