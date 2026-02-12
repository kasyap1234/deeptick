import { Elysia, t } from 'elysia';
import { enhancedChatService } from '../../services/enhanced-chat.service.js';
import { logger } from '../../utils/logger.js';

interface ChatStreamMessage {
  type: 'chat_message' | 'stream_chunk' | 'stream_complete' | 'error';
  conversationId: string;
  messageId?: string;
  content?: string;
  isComplete?: boolean;
  sources?: Array<{ url: string; title: string }>;
  researchJobId?: string;
  error?: string;
}

export const chatWebSocket = new Elysia()
  .ws('/ws/chat/:conversationId', {
    params: t.Object({
      conversationId: t.String(),
    }),
    
    async open(ws) {
      const conversationId = ws.data.params.conversationId;
      
      const conversation = await enhancedChatService.getConversation(conversationId);
      if (!conversation) {
        ws.send(JSON.stringify({
          type: 'error',
          conversationId,
          error: 'Conversation not found',
        } as ChatStreamMessage));
        ws.close();
        return;
      }

      ws.send(JSON.stringify({
        type: 'stream_complete',
        conversationId,
        content: 'Connected to chat stream',
        isComplete: true,
      } as ChatStreamMessage));
    },

    async message(ws, message) {
      const { params } = ws.data as { params: { conversationId: string } };
      const conversationId = params.conversationId;

      try {
        let data: { content: string; jobId?: string };
        
        if (typeof message === 'string') {
          data = JSON.parse(message);
        } else {
          data = message as { content: string; jobId?: string };
        }

        if (!data.content) {
          ws.send(JSON.stringify({
            type: 'error',
            conversationId,
            error: 'Message content is required',
          } as ChatStreamMessage));
          return;
        }

        const messageId = crypto.randomUUID();

        ws.send(JSON.stringify({
          type: 'chat_message',
          conversationId,
          messageId,
          content: data.content,
        } as ChatStreamMessage));

        for await (const chunk of enhancedChatService.streamMessage(conversationId, data.content, {
          jobId: data.jobId,
        })) {
          ws.send(JSON.stringify({
            type: 'stream_chunk',
            conversationId,
            messageId: chunk.messageId,
            content: chunk.content,
            isComplete: chunk.isComplete,
            sources: chunk.sources,
            researchJobId: chunk.researchJobId,
          } as ChatStreamMessage));
        }

      } catch (error) {
        logger.error({ error }, 'Chat WebSocket error');
        ws.send(JSON.stringify({
          type: 'error',
          conversationId,
          error: error instanceof Error ? error.message : 'Unknown error',
        } as ChatStreamMessage));
      }
    },

    close(ws) {
      const { params } = ws.data as { params: { conversationId: string } };
      logger.info(`Chat WebSocket closed for conversation: ${params.conversationId}`);
    },
  });
