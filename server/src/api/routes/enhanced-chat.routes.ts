import { Elysia, t } from 'elysia';
import { enhancedChatService } from '../../services/enhanced-chat.service.js';

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
  jobId: t.Optional(t.String()),
  sources: t.Optional(t.Array(t.Object({
    url: t.String(),
    title: t.String(),
  }))),
});

const StreamMessageSchema = t.Object({
  content: t.String({ minLength: 1 }),
  jobId: t.Optional(t.String()),
});

export const enhancedChatRoutes = new Elysia({ prefix: '/api/chat' })
  // Create a new conversation
  .post('/conversations', async ({ body, set }) => {
    const conversationId = await enhancedChatService.createConversation(
      body.title,
      body.context
    );

    set.status = 201;
    return {
      success: true,
      data: {
        conversationId,
        title: body.title ?? 'New Conversation',
      },
    };
  }, {
    body: CreateConversationSchema,
  })

  // List all conversations
  .get('/conversations', async ({ query }) => {
    const limit = parseInt(query?.limit ?? '20');
    const offset = parseInt(query?.offset ?? '0');

    const conversations = await enhancedChatService.listConversations(limit, offset);

    return {
      success: true,
      data: conversations,
    };
  })

  // Get a specific conversation
  .get('/conversations/:conversationId', async ({ params, set }) => {
    const conversation = await enhancedChatService.getConversation(params.conversationId);

    if (!conversation) {
      set.status = 404;
      return {
        success: false,
        error: 'Conversation not found',
      };
    }

    return {
      success: true,
      data: conversation,
    };
  })

  // Get messages for a conversation
  .get('/conversations/:conversationId/messages', async ({ params, query }) => {
    const limit = parseInt(query?.limit ?? '50');
    const messages = await enhancedChatService.getConversationMessages(params.conversationId, limit);

    return {
      success: true,
      data: messages,
    };
  })

  // Send a message to a conversation (non-streaming)
  .post('/conversations/:conversationId/messages', async ({ params, body }) => {
    const response = await enhancedChatService.sendMessage(
      params.conversationId,
      body.content,
      {
        jobId: body.jobId,
        sources: body.sources,
      }
    );

    return {
      success: true,
      data: response,
    };
  }, {
    body: SendMessageSchema,
  })

  // Stream a message response (Server-Sent Events)
  .post('/conversations/:conversationId/stream', async ({ params, body, set }) => {
    set.headers['Content-Type'] = 'text/event-stream';
    set.headers['Cache-Control'] = 'no-cache';
    set.headers['Connection'] = 'keep-alive';

    const stream = new ReadableStream({
      async start(controller) {
        try {
          const encoder = new TextEncoder();

          for await (const chunk of enhancedChatService.streamMessage(
            params.conversationId,
            body.content,
            { jobId: body.jobId }
          )) {
            const data = `data: ${JSON.stringify(chunk)}\n\n`;
            controller.enqueue(encoder.encode(data));
          }

          controller.close();
        } catch (error) {
          const encoder = new TextEncoder();
          const errorData = `data: ${JSON.stringify({
            type: 'error',
            conversationId: params.conversationId,
            error: error instanceof Error ? error.message : 'Unknown error',
          })}\n\n`;
          controller.enqueue(encoder.encode(errorData));
          controller.close();
        }
      },
    });

    return stream;
  }, {
    body: StreamMessageSchema,
  })

  // Search conversations
  .get('/search', async ({ query }) => {
    if (!query?.q) {
      return {
        success: false,
        error: 'Query parameter "q" is required',
      };
    }

    const limit = parseInt(query?.limit ?? '10');
    const results = await enhancedChatService.searchConversations(query.q, limit);

    return {
      success: true,
      data: results,
    };
  })

  // Delete a conversation
  .delete('/conversations/:conversationId', async ({ params, set }) => {
    await enhancedChatService.deleteConversation(params.conversationId);

    set.status = 204;
    return {
      success: true,
    };
  });
