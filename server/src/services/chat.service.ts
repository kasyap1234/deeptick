import { ChatOpenAI } from '@langchain/openai';
import { config, normalizeModelForOpenAICompatible } from '../config/index.js';
import { logger } from '../utils/logger.js';

export class ChatService {
  private model: ChatOpenAI | null = null;

  private getModel(): ChatOpenAI | null {
    if (this.model) return this.model;

    if (!config.DO_GENAI_API_KEY) return null;

    this.model = new ChatOpenAI({
      model: normalizeModelForOpenAICompatible(config.deepResearch.orchestratorModel),
      apiKey: config.DO_GENAI_API_KEY,
      configuration: {
        baseURL: config.DO_GENAI_ENDPOINT,
      },
      temperature: 0.7,
    });

    return this.model;
  }

  async generateResponse(userMessage: string, context?: { previousMessages?: Array<{ role: string; content: string }>; stockContext?: string }): Promise<string> {
    const model = this.getModel();

    if (!model) {
      logger.warn('No LLM model available for chat response');
      return this.getFallbackResponse(userMessage);
    }

    try {
      const systemMessage = `You are a helpful stock research assistant. ${context?.stockContext ? `The user is currently discussing ${context.stockContext}.` : ''} Provide concise, accurate information about stocks and investments. If you don't know something, say so honestly.`;

      const messages = [
        { role: 'system', content: systemMessage },
        ...(context?.previousMessages?.slice(-6).map(m => ({ role: m.role, content: m.content })) || []),
        { role: 'user', content: userMessage },
      ];

      const invokePromise = model.invoke(messages);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Chat LLM invoke timed out after 60s')), 60_000)
      );
      const response = await Promise.race([invokePromise, timeoutPromise]);
      return response.content as string;
    } catch (error) {
      logger.error({ error }, 'Failed to generate chat response');
      return this.getFallbackResponse(userMessage);
    }
  }

  private getFallbackResponse(userMessage: string): string {
    const lowerMessage = userMessage.toLowerCase();
    
    if (lowerMessage.includes('stock') || lowerMessage.includes('share') || lowerMessage.includes('price')) {
      return "I'm ready to help you with stock research! Unfortunately, my AI capabilities are currently unavailable due to configuration issues. " +
        "To enable AI-powered responses, please configure DO_GENAI_API_KEY in the server environment variables. " +
        "You can also use the Research feature to get comprehensive stock analysis reports.";
    }
    
    if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey')) {
      return "Hello! I'm your stock research assistant. I can help you analyze stocks, discuss investment ideas, and answer questions about the market. " +
        "Unfortunately, my AI capabilities are currently unavailable. Please configure DO_GENAI_API_KEY to enable full functionality.";
    }
    
    return "Thank you for your message! I'm currently operating in limited mode because the AI service isn't configured. " +
      "To enable full functionality, please configure DO_GENAI_API_KEY in the server's environment variables. " +
      "In the meantime, you can still use the Research feature to get detailed stock analysis reports.";
  }

  async *streamResponse(userMessage: string, context?: { previousMessages?: Array<{ role: string; content: string }>; stockContext?: string }): AsyncGenerator<string> {
    const model = this.getModel();

    if (!model) {
      const fallback = this.getFallbackResponse(userMessage);
      for (const chunk of this.chunkText(fallback, 50)) {
        yield chunk;
      }
      return;
    }

    try {
      const systemMessage = `You are a helpful stock research assistant. ${context?.stockContext ? `The user is currently discussing ${context.stockContext}.` : ''} Provide concise, accurate information about stocks and investments.`;

      const messages = [
        { role: 'system', content: systemMessage },
        ...(context?.previousMessages?.slice(-6).map(m => ({ role: m.role, content: m.content })) || []),
        { role: 'user', content: userMessage },
      ];

      const controller = new AbortController();
      const streamTimeout = setTimeout(() => controller.abort(), 120_000);
      try {
        const stream = await model.stream(messages, { signal: controller.signal });

        for await (const chunk of stream) {
          yield chunk.content as string;
        }
      } finally {
        clearTimeout(streamTimeout);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to stream chat response');
      const fallback = this.getFallbackResponse(userMessage);
      for (const chunk of this.chunkText(fallback, 50)) {
        yield chunk;
      }
    }
  }

  private *chunkText(text: string, chunkSize: number): Generator<string> {
    let i = 0;
    while (i < text.length) {
      yield text.slice(i, i + chunkSize);
      i += chunkSize;
    }
  }
}

export const chatService = new ChatService();
