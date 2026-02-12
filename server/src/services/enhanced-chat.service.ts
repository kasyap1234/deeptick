import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { conversations, messages, type NewConversation, type NewMessage, researchJobs } from '../db/schema.js';
import { vectorStoreService } from './vector-store.service.js';
import { embeddingService } from './embedding.service.js';
import { queryRouterService } from './query-router.service.js';
import { gradientLLMService, type ChatContext } from './gradient-llm.service.js';
import { stockDataService } from './stock-data.service.js';
import { researchService } from './research.service.js';
import type { InstitutionalResearchReport } from '../types/research.types.js';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: Array<{ url: string; title: string }>;
  jobId?: string;
  createdAt: Date;
}

export interface ConversationContext {
  currentStock?: string;
  currentSector?: string;
  lastResearchJobId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatResponse {
  message: ChatMessage;
  usedCache: boolean;
  triggeredResearch: boolean;
  researchJobId?: string;
  sourcesUsed?: Array<{ url: string; title: string; snippet?: string }>;
  relatedContent?: Array<{
    content: string;
    similarity: number;
    source?: string;
  }>;
  stockData?: {
    quote?: string;
    metrics?: string;
  };
}

export interface StreamingChatResponse {
  conversationId: string;
  messageId: string;
  content: string;
  isComplete: boolean;
  sources?: Array<{ url: string; title: string }>;
  researchJobId?: string;
}

export class EnhancedChatService {
  async createConversation(title?: string, context?: ConversationContext): Promise<string> {
    const conversationData: NewConversation = {
      title: title ?? 'New Conversation',
      context: context ?? {},
      metadata: {},
    };

    const [conversation] = await db
      .insert(conversations)
      .values(conversationData)
      .returning({ id: conversations.id });

    return conversation!.id;
  }

  async getConversation(conversationId: string) {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));

    return conversation;
  }

  async getConversationMessages(conversationId: string, limit: number = 50): Promise<ChatMessage[]> {
    const msgs = await db
      .select({
        id: messages.id,
        role: messages.role,
        content: messages.content,
        sources: messages.sources,
        jobId: messages.jobId,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(limit);

    return msgs.reverse().map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      sources: m.sources as Array<{ url: string; title: string }> | undefined,
      jobId: m.jobId ?? undefined,
      createdAt: m.createdAt,
    }));
  }

  async sendMessage(
    conversationId: string,
    content: string,
    options?: {
      jobId?: string;
      sources?: Array<{ url: string; title: string }>;
    }
  ): Promise<ChatResponse> {
    const embedding = await embeddingService.embedQuery(content);

    const messageData: NewMessage = {
      conversationId,
      role: 'user',
      content,
      contentEmbedding: embedding,
      sources: options?.sources,
      jobId: options?.jobId,
    };

    const [message] = await db.insert(messages).values(messageData).returning();

    const conversation = await this.getConversation(conversationId);
    const context = conversation?.context as ConversationContext | undefined;

    const stockData = await this.enrichWithStockData(content, context?.currentStock);

    const routing = await queryRouterService.routeQuery({ query: content });

    if (!routing.shouldSearch && routing.cachedResult) {
      return this.handleCachedResponse(
        conversationId,
        content,
        message!.id,
        routing.cachedResult,
        routing.existingJobId!,
        embedding,
        stockData,
        context
      );
    }

    if (routing.shouldSearch && routing.cachedResult && routing.existingJobId) {
      return this.handlePartialCache(
        conversationId,
        content,
        message!.id,
        routing.cachedResult,
        routing.existingJobId,
        embedding,
        stockData,
        context
      );
    }

    return this.handleNewResearch(
      conversationId,
      content,
      message!.id,
      embedding,
      stockData,
      context
    );
  }

  async *streamMessage(
    conversationId: string,
    content: string,
    options?: {
      jobId?: string;
      sources?: Array<{ url: string; title: string }>;
    }
  ): AsyncGenerator<StreamingChatResponse> {
    const embedding = await embeddingService.embedQuery(content);

    const messageData: NewMessage = {
      conversationId,
      role: 'user',
      content,
      contentEmbedding: embedding,
      sources: options?.sources,
      jobId: options?.jobId,
    };

    await db.insert(messages).values(messageData).returning();

    const conversation = await this.getConversation(conversationId);
    const context = conversation?.context as ConversationContext | undefined;
    const conversationMessages = await this.getConversationMessages(conversationId, 10);

    const similarContent = context?.lastResearchJobId
      ? await vectorStoreService.getRelatedContent(context.lastResearchJobId, embedding, 5)
      : await vectorStoreService.searchSimilarContent(embedding, undefined, 0.7);

    const relevantResearch = context?.lastResearchJobId
      ? await this.getResearchByJobId(context.lastResearchJobId)
      : undefined;

    const chatContext: ChatContext = {
      conversationId,
      currentStock: context?.currentStock,
      messages: conversationMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      relevantResearch: relevantResearch ?? undefined,
      relatedChunks: similarContent.map((c) => ({
        content: c.content,
        similarity: c.similarity,
        source: c.source ?? undefined,
      })),
    };

    const assistantContent: string[] = [];
    const messageId = crypto.randomUUID();

    yield {
      conversationId,
      messageId,
      content: '',
      isComplete: false,
    };

    for await (const chunk of gradientLLMService.streamResponse(chatContext)) {
      assistantContent.push(chunk);
      yield {
        conversationId,
        messageId,
        content: chunk,
        isComplete: false,
      };
    }

    const fullContent = assistantContent.join('');

    const assistantMessageData: NewMessage = {
      conversationId,
      role: 'assistant',
      content: fullContent,
      contentEmbedding: await embeddingService.embedQuery(fullContent),
      sources: relevantResearch?.sources?.slice(0, 5).map((s) => ({
        url: s.url,
        title: s.title,
      })),
      jobId: context?.lastResearchJobId,
    };

    await db.insert(messages).values(assistantMessageData);

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    yield {
      conversationId,
      messageId,
      content: '',
      isComplete: true,
      sources: relevantResearch?.sources?.slice(0, 5).map((s) => ({
        url: s.url,
        title: s.title,
      })),
    };
  }

  private async handleCachedResponse(
    conversationId: string,
    _query: string,
    _userMessageId: string,
    cachedResult: InstitutionalResearchReport,
    jobId: string,
    embedding: number[],
    stockData: { quote?: string; metrics?: string },
    context?: ConversationContext
  ): Promise<ChatResponse> {
    const relatedContent = await vectorStoreService.getRelatedContent(jobId, embedding, 5);

    const conversationMessages = await this.getConversationMessages(conversationId, 10);

    const chatContext: ChatContext = {
      conversationId,
      currentStock: context?.currentStock,
      messages: conversationMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      relevantResearch: cachedResult,
      relatedChunks: relatedContent.map((c) => ({
        content: c.content,
        similarity: c.similarity,
        source: c.source ?? undefined,
      })),
    };

    const response = await gradientLLMService.generateResponse(chatContext);

    const assistantMessage = await this.createAssistantMessage(
      conversationId,
      response.content,
      jobId,
      response.sources
    );

    return {
      message: assistantMessage,
      usedCache: true,
      triggeredResearch: false,
      researchJobId: jobId,
      sourcesUsed: cachedResult.sources,
      relatedContent: relatedContent.map((c) => ({
        content: c.content,
        similarity: c.similarity,
        source: c.source ?? undefined,
      })),
      stockData,
    };
  }

  private async handlePartialCache(
    conversationId: string,
    _query: string,
    _userMessageId: string,
    cachedResult: InstitutionalResearchReport,
    existingJobId: string,
    embedding: number[],
    stockData: { quote?: string; metrics?: string },
    context?: ConversationContext
  ): Promise<ChatResponse> {
    const relatedContent = await vectorStoreService.getRelatedContent(existingJobId, embedding, 5);

    const conversationMessages = await this.getConversationMessages(conversationId, 10);

    const chatContext: ChatContext = {
      conversationId,
      currentStock: context?.currentStock,
      messages: conversationMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      relevantResearch: cachedResult,
      relatedChunks: relatedContent.map((c) => ({
        content: c.content,
        similarity: c.similarity,
        source: c.source ?? undefined,
      })),
    };

    const response = await gradientLLMService.generateResponse(chatContext);

    const enhancedContent = `${response.content}\n\n---\n*Note: This response is based on cached research from ${new Date().toLocaleDateString()}. For the latest data, a new research job has been queued.*`;

    const assistantMessage = await this.createAssistantMessage(
      conversationId,
      enhancedContent,
      existingJobId,
      response.sources
    );

    return {
      message: assistantMessage,
      usedCache: true,
      triggeredResearch: true,
      researchJobId: existingJobId,
      sourcesUsed: cachedResult.sources,
      relatedContent: relatedContent.map((c) => ({
        content: c.content,
        similarity: c.similarity,
        source: c.source ?? undefined,
      })),
      stockData,
    };
  }

  private async handleNewResearch(
    conversationId: string,
    query: string,
    userMessageId: string,
    embedding: number[],
    stockData: { quote?: string; metrics?: string },
    context?: ConversationContext
  ): Promise<ChatResponse> {
    const conversationMessages = await this.getConversationMessages(conversationId, 10);

    const enhancedQuery = await gradientLLMService.enhanceQuery(
      query,
      context?.currentStock ? `Currently discussing: ${context.currentStock}` : undefined
    );

    const similarContent = await vectorStoreService.searchSimilarContent(embedding, undefined, 0.7);

    const researchJob = await researchService.createResearchJob({
      query: enhancedQuery,
      context: context?.currentStock
        ? `User is asking about ${context.currentStock}. Previous context: ${conversationMessages.map((m) => m.content).join('\n')}`
        : undefined,
    });

    await this.updateConversationContext(conversationId, {
      lastResearchJobId: researchJob.id,
    });

    return {
      message: {
        id: userMessageId,
        role: 'user',
        content: query,
        createdAt: new Date(),
      },
      usedCache: false,
      triggeredResearch: true,
      researchJobId: researchJob.id,
      relatedContent: similarContent.map((c) => ({
        content: c.content,
        similarity: c.similarity,
        source: c.source ?? undefined,
      })),
      stockData,
    };
  }

  private async enrichWithStockData(
    query: string,
    currentStock?: string
  ): Promise<{ quote?: string; metrics?: string }> {
    const stockSymbol = this.extractStockSymbol(query) || currentStock;

    if (!stockSymbol) {
      return {};
    }

    const quote = await stockDataService.getQuote(stockSymbol);
    const metrics = await stockDataService.getFinancialMetrics(stockSymbol);

    return {
      quote: quote ? stockDataService.formatQuoteForDisplay(quote) : undefined,
      metrics: metrics ? stockDataService.formatMetricsForDisplay(metrics) : undefined,
    };
  }

  private extractStockSymbol(query: string): string | undefined {
    const patterns = [
      /\b([A-Z]{1,5})\b/g,
      /\$([A-Z]{1,5})/g,
    ];

    for (const pattern of patterns) {
      const matches = query.match(pattern);
      if (matches && matches.length > 0) {
        return matches[0].replace('$', '');
      }
    }

    return undefined;
  }

  private async getResearchByJobId(jobId: string): Promise<InstitutionalResearchReport | null> {
    const [job] = await db
      .select({ result: researchJobs.result })
      .from(researchJobs)
      .where(eq(researchJobs.id, jobId))
      .limit(1);

    return (job?.result as InstitutionalResearchReport) ?? null;
  }

  async createAssistantMessage(
    conversationId: string,
    content: string,
    jobId?: string,
    sources?: Array<{ url: string; title: string }>
  ): Promise<ChatMessage> {
    const embedding = await embeddingService.embedQuery(content);

    const messageData: NewMessage = {
      conversationId,
      role: 'assistant',
      content,
      contentEmbedding: embedding,
      sources,
      jobId,
    };

    const [message] = await db.insert(messages).values(messageData).returning();

    await db
      .update(conversations)
      .set({ updatedAt: new Date() })
      .where(eq(conversations.id, conversationId));

    return {
      id: message!.id,
      role: 'assistant',
      content,
      sources,
      jobId,
      createdAt: message!.createdAt,
    };
  }

  async updateConversationContext(
    conversationId: string,
    contextUpdate: Partial<ConversationContext>
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) return;

    const existingContext = (conversation.context as ConversationContext) ?? {};
    const updatedContext = { ...existingContext, ...contextUpdate };

    await db
      .update(conversations)
      .set({
        context: updatedContext,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));
  }

  async searchConversations(query: string, limit: number = 10): Promise<Array<{ id: string; title: string; similarity: number }>> {
    const embedding = await embeddingService.embedQuery(query);
    const similarityThreshold = 0.7;

    const results = await db
      .select({
        id: messages.conversationId,
        content: messages.content,
        similarity: sql<number>`1 - (content_embedding <=> ${embedding}::vector)`,
      })
      .from(messages)
      .where(and(
        sql`1 - (content_embedding <=> ${embedding}::vector) > ${similarityThreshold}`,
        eq(messages.role, 'user')
      ))
      .orderBy(desc(sql`1 - (content_embedding <=> ${embedding}::vector)`))
      .limit(limit);

    const conversationsWithTitles = await Promise.all(
      results.map(async (r) => {
        const conv = await this.getConversation(r.id);
        return {
          id: r.id,
          title: conv?.title ?? 'Untitled',
          similarity: r.similarity,
        };
      })
    );

    return conversationsWithTitles;
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await db.delete(conversations).where(eq(conversations.id, conversationId));
  }

  async listConversations(limit: number = 20, offset: number = 0) {
    const results = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        context: conversations.context,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset);

    return results.map((r) => ({
      id: r.id,
      title: r.title,
      context: r.context as ConversationContext | undefined,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }
}

export const enhancedChatService = new EnhancedChatService();
