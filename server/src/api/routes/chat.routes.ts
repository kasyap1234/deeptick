import { Elysia, t } from 'elysia';
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
  jobId: t.Optional(t.String()),
  sources: t.Optional(t.Array(t.Object({
    url: t.String(),
    title: t.String(),
  }))),
});

export const chatRoutes = new Elysia({ prefix: '/api/chat' })
  // Create a new conversation
  .post('/conversations', async ({ body, set }) => {
    const conversationId = await chatService.createConversation(
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

    const conversations = await chatService.listConversations(limit, offset);

    return {
      success: true,
      data: conversations,
    };
  })

  // Get a specific conversation
  .get('/conversations/:conversationId', async ({ params, set }) => {
    const conversation = await chatService.getConversation(params.conversationId);

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
    const messages = await chatService.getConversationMessages(params.conversationId, limit);

    return {
      success: true,
      data: messages,
    };
  })

  // Send a message to a conversation
  .post('/conversations/:conversationId/messages', async ({ params, body }) => {
    const response = await chatService.sendMessage(
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

  // Search conversations
  .get('/search', async ({ query }) => {
    if (!query?.q) {
      return {
        success: false,
        error: 'Query parameter "q" is required',
      };
    }

    const limit = parseInt(query?.limit ?? '10');
    const results = await chatService.searchConversations(query.q, limit);

    return {
      success: true,
      data: results,
    };
  })

  // Delete a conversation
  .delete('/conversations/:conversationId', async ({ params, set }) => {
    await chatService.deleteConversation(params.conversationId);

    set.status = 204;
    return {
      success: true,
    };
  });
