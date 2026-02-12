import { pgTable, uuid, text, timestamp, jsonb, index, vector, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Research jobs table - tracks all research requests
export const researchJobs = pgTable('research_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  query: text('query').notNull(),
  queryEmbedding: vector('query_embedding', { dimensions: 1536 }),
  status: text('status', { enum: ['pending', 'in_progress', 'completed', 'failed'] }).notNull().default('pending'),
  result: jsonb('result'),
  metadata: jsonb('metadata'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  queryEmbeddingIdx: index('query_embedding_idx').using('hnsw', table.queryEmbedding.op('vector_cosine_ops')),
  statusIdx: index('status_idx').on(table.status),
  createdAtIdx: index('created_at_idx').on(table.createdAt),
}));

// Research embeddings table - stores detailed chunks for semantic search
export const researchEmbeddings = pgTable('research_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => researchJobs.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  contentEmbedding: vector('content_embedding', { dimensions: 1536 }).notNull(),
  source: text('source'), // URL or source identifier
  sourceType: text('source_type', { enum: ['web_search', 'report_section', 'chat_message'] }),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  contentEmbeddingIdx: index('content_embedding_idx').using('hnsw', table.contentEmbedding.op('vector_cosine_ops')),
  jobIdIdx: index('job_id_idx').on(table.jobId),
  sourceTypeIdx: index('source_type_idx').on(table.sourceType),
}));

// Conversations table - for chat history and follow-up queries
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title'),
  context: jsonb('context'), // Stores conversation context like current stock being discussed
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Messages table - individual chat messages
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  contentEmbedding: vector('content_embedding', { dimensions: 1536 }),
  sources: jsonb('sources'), // References to research used
  jobId: uuid('job_id').references(() => researchJobs.id), // Link to research job if triggered
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  contentEmbeddingIdx: index('message_embedding_idx').using('hnsw', table.contentEmbedding.op('vector_cosine_ops')),
  conversationIdIdx: index('conversation_id_idx').on(table.conversationId),
  roleIdx: index('role_idx').on(table.role),
}));

// Sources table - tracks all sources used in research
export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => researchJobs.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  title: text('title'),
  snippet: text('snippet'),
  relevanceScore: integer('relevance_score'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  jobIdIdx: index('source_job_id_idx').on(table.jobId),
  urlIdx: index('url_idx').on(table.url),
}));

// Relations
export const researchJobsRelations = relations(researchJobs, ({ many }) => ({
  embeddings: many(researchEmbeddings),
  sources: many(sources),
  messages: many(messages),
}));

export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  job: one(researchJobs, {
    fields: [messages.jobId],
    references: [researchJobs.id],
  }),
}));

export type ResearchJob = typeof researchJobs.$inferSelect;
export type NewResearchJob = typeof researchJobs.$inferInsert;
export type ResearchEmbedding = typeof researchEmbeddings.$inferSelect;
export type NewResearchEmbedding = typeof researchEmbeddings.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;