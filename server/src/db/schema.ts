import { pgTable, text, timestamp, jsonb, index, integer, boolean, uuid } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  emailIdx: index('user_email_idx').on(table.email),
}));

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
}, (table) => ({
  tokenIdx: index('session_token_idx').on(table.token),
  userIdIdx: index('session_user_id_idx').on(table.userId),
}));

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('account_user_id_idx').on(table.userId),
  providerIdx: index('account_provider_idx').on(table.providerId, table.accountId),
}));

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
}, (table) => ({
  identifierIdx: index('verification_identifier_idx').on(table.identifier),
}));

export const researchJobs = pgTable('research_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  query: text('query').notNull(),
  status: text('status', { enum: ['pending', 'in_progress', 'completed', 'failed'] }).notNull().default('pending'),
  result: jsonb('result'),
  metadata: jsonb('metadata'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('research_user_id_idx').on(table.userId),
  statusIdx: index('research_status_idx').on(table.status),
  createdAtIdx: index('research_created_at_idx').on(table.createdAt),
}));

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => researchJobs.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  title: text('title'),
  snippet: text('snippet'),
  relevanceScore: integer('relevance_score'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('source_user_id_idx').on(table.userId),
  jobIdIdx: index('source_job_id_idx').on(table.jobId),
}));

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  context: jsonb('context'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('conversation_user_id_idx').on(table.userId),
  updatedAtIdx: index('conversation_updated_at_idx').on(table.updatedAt),
}));

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  sources: jsonb('sources'),
  jobId: uuid('job_id').references(() => researchJobs.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('message_user_id_idx').on(table.userId),
  conversationIdIdx: index('message_conversation_id_idx').on(table.conversationId),
  createdAtIdx: index('message_created_at_idx').on(table.createdAt),
}));

export const userKnowledgeBases = pgTable('user_knowledge_bases', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: text('purpose', { enum: ['research', 'chat', 'cache', 'general'] }).notNull().default('general'),
  gradientKbId: text('gradient_kb_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('ukb_user_id_idx').on(table.userId),
  purposeIdx: index('ukb_purpose_idx').on(table.purpose),
}));

export const usersRelations = relations(users, ({ many }) => ({
  researchJobs: many(researchJobs),
  conversations: many(conversations),
  messages: many(messages),
  sources: many(sources),
  knowledgeBases: many(userKnowledgeBases),
}));

export const researchJobsRelations = relations(researchJobs, ({ many }) => ({
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

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const userKnowledgeBasesRelations = relations(userKnowledgeBases, ({ one }) => ({
  user: one(users, {
    fields: [userKnowledgeBases.userId],
    references: [users.id],
  }),
}));

// ============================================
// Prompt Cache & Semantic Search Tables
// Requires: CREATE EXTENSION vector;
// Embeddings stored as text (JSON array), cast to vector in SQL queries
// ============================================

// Prompt/LLM Response Cache with semantic embeddings
export const promptCache = pgTable('prompt_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  
  // Query that was cached
  queryHash: text('query_hash').notNull(),
  queryText: text('query_text').notNull(),
  
  // Embedding for semantic similarity search (stored as JSON, cast to vector in SQL)
  embedding: text('embedding').notNull(),
  
  // Cached response
  responseText: text('response_text').notNull(),
  responseMetadata: jsonb('response_metadata'),
  
  // Context about what was cached
  context: jsonb('context'),
  focusAreas: jsonb('focusAreas'),
  
  // Stats
  hitCount: integer('hit_count').notNull().default(0),
  lastHitAt: timestamp('last_hit_at', { withTimezone: true }),
  
  // TTL - auto-expire old cache entries
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  queryHashIdx: index('pc_cache_hash_idx').on(table.queryHash),
  userIdIdx: index('pc_cache_user_id_idx').on(table.userId),
  expiresAtIdx: index('pc_cache_expires_at_idx').on(table.expiresAt),
}));

// Research Report Embeddings for semantic search
export const reportEmbeddings = pgTable('report_embeddings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').references(() => researchJobs.id, { onDelete: 'cascade' }),
  
  // Report metadata
  query: text('query').notNull(),
  ticker: text('ticker'),
  companyName: text('company_name'),
  sector: text('sector'),
  reportDate: timestamp('report_date', { withTimezone: true }).notNull(),
  
  // Embedding of the full report content (stored as JSON, cast to vector in SQL)
  embedding: text('embedding').notNull(),
  
  // Summary for quick display
  executiveSummary: text('executive_summary'),
  
  // Full report sections (stored as JSON for flexibility)
  reportSections: jsonb('report_sections'),
  
  // Sentiment scores
  sentimentScore: integer('sentiment_score'),
  bullCaseStrength: integer('bull_case_strength'),
  bearCaseStrength: integer('bear_case_strength'),
  
  // Source stats
  sourceCount: integer('source_count').default(0),
  uniqueDomains: integer('unique_domains').default(0),
  
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('re_user_id_idx').on(table.userId),
  jobIdIdx: index('re_job_id_idx').on(table.jobId),
  tickerIdx: index('re_ticker_idx').on(table.ticker),
  sectorIdx: index('re_sector_idx').on(table.sector),
  queryIdx: index('re_query_idx').on(table.query),
}));

// Relations for new tables
export const promptCacheRelations = relations(promptCache, ({ one }) => ({
  user: one(users, {
    fields: [promptCache.userId],
    references: [users.id],
  }),
}));

export const reportEmbeddingsRelations = relations(reportEmbeddings, ({ one }) => ({
  user: one(users, {
    fields: [reportEmbeddings.userId],
    references: [users.id],
  }),
  job: one(researchJobs, {
    fields: [reportEmbeddings.jobId],
    references: [researchJobs.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type ResearchJob = typeof researchJobs.$inferSelect;
export type NewResearchJob = typeof researchJobs.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type UserKnowledgeBase = typeof userKnowledgeBases.$inferSelect;
export type NewUserKnowledgeBase = typeof userKnowledgeBases.$inferInsert;
export type PromptCache = typeof promptCache.$inferSelect;
export type NewPromptCache = typeof promptCache.$inferInsert;
export type ReportEmbedding = typeof reportEmbeddings.$inferSelect;
export type NewReportEmbedding = typeof reportEmbeddings.$inferInsert;
