-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Prompt Cache table for semantic caching of LLM responses
CREATE TABLE "prompt_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	"query_hash" text NOT NULL,
	"query_text" text NOT NULL,
	"embedding" text NOT NULL,
	"response_text" text NOT NULL,
	"response_metadata" jsonb,
	"context" jsonb,
	"focus_areas" jsonb,
	"hit_count" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Report Embeddings table for semantic search across research reports
CREATE TABLE "report_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	"job_id" uuid REFERENCES "public"."research_jobs"("id") ON DELETE cascade ON UPDATE no action,
	"query" text NOT NULL,
	"ticker" text,
	"company_name" text,
	"sector" text,
	"report_date" timestamp with time zone NOT NULL,
	"embedding" text NOT NULL,
	"executive_summary" text,
	"report_sections" jsonb,
	"sentiment_score" integer,
	"bull_case_strength" integer,
	"bear_case_strength" integer,
	"source_count" integer DEFAULT 0 NOT NULL,
	"unique_domains" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Indexes for prompt_cache
CREATE INDEX "pc_cache_hash_idx" ON "prompt_cache" USING btree ("query_hash");
CREATE INDEX "pc_cache_user_id_idx" ON "prompt_cache" USING btree ("user_id");
CREATE INDEX "pc_cache_expires_at_idx" ON "prompt_cache" USING btree ("expires_at");

-- Indexes for report_embeddings
CREATE INDEX "re_user_id_idx" ON "report_embeddings" USING btree ("user_id");
CREATE INDEX "re_job_id_idx" ON "report_embeddings" USING btree ("job_id");
CREATE INDEX "re_ticker_idx" ON "report_embeddings" USING btree ("ticker");
CREATE INDEX "re_sector_idx" ON "report_embeddings" USING btree ("sector");
CREATE INDEX "re_query_idx" ON "report_embeddings" USING btree ("query");
