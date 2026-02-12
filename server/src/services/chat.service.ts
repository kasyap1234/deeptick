import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { conversations, messages, type NewConversation, type NewMessage } from '../db/schema.js';
import { vectorStoreService } from './vector-store.service.js';
import { embeddingService } from './embedding.service.js';
import { queryRouterService } from './query-router.service.js';
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
  sourcesUsed?: Array<{ url: string; title: string; snippet?: string }>;
  relatedContent?: Array<{
    content: string;
    similarity: number;
    source?: string;
  }>;
}

export class ChatService {
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

    const routing = await queryRouterService.routeQuery({ query: content });

    if (!routing.shouldSearch && routing.cachedResult) {
      const relatedContent = await vectorStoreService.getRelatedContent(
        routing.existingJobId!,
        embedding,
        5
      );

      const assistantMessage = await this.createAssistantMessage(
        conversationId,
        this.formatCachedResponse(routing.cachedResult, content),
        routing.existingJobId,
        routing.cachedResult.sources
      );

      return {
        message: assistantMessage,
        usedCache: true,
        sourcesUsed: routing.cachedResult.sources,
        relatedContent: relatedContent.map((c) => ({
          content: c.content,
          similarity: c.similarity,
          source: c.source ?? undefined,
        })),
      };
    }

    const similarContent = context?.lastResearchJobId
      ? await vectorStoreService.getRelatedContent(context.lastResearchJobId, embedding, 5)
      : await vectorStoreService.searchSimilarContent(embedding, undefined, 0.7);

    return {
      message: {
        id: message!.id,
        role: 'user',
        content: message!.content,
        jobId: message!.jobId ?? undefined,
        createdAt: message!.createdAt,
      },
      usedCache: false,
      relatedContent: similarContent.map((c) => ({
        content: c.content,
        similarity: c.similarity,
        source: c.source ?? undefined,
      })),
    };
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
      content: message!.content,
      sources: sources,
      jobId: jobId,
      createdAt: message!.createdAt,
    };
  }

  async updateConversationContext(
    conversationId: string,
    context: Partial<ConversationContext>
  ): Promise<void> {
    const conversation = await this.getConversation(conversationId);
    if (!conversation) return;

    const existingContext = (conversation.context as ConversationContext) ?? {};
    const updatedContext = { ...existingContext, ...context };

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

  private formatCachedResponse(result: InstitutionalResearchReport, _query: string): string {
    return `Based on my previous institutional research, here's a concise recap:\n\n${result.executiveSummary}\n\nCoverage available:\n- Market & Industry${result.industryAndMarketStructure ? ' ✓' : ''}\n- Financial Quality${result.financialQualityAndTrendAnalysis ? ' ✓' : ''}\n- Valuation${result.valuationRelative || result.valuationIntrinsic ? ' ✓' : ''}\n- Bull/Bear Cases${result.bullCase && result.bearCase ? ' ✓' : ''}\n- Risk & Governance${result.regulatoryAndLegalRisk ? ' ✓' : ''}\n\nTell me which section you want expanded.`;
  }
}

export const chatService = new ChatService();
