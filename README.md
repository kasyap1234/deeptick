# DeepTick Stock Researcher Agent

A sophisticated AI-powered stock research agent built with Elysia.js, LangChain DeepAgents, and Exa web search. Designed for retail investors who need institutional-grade research capabilities.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Elysia.js API Server                     │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Research   │  │    Chat      │  │   Health     │      │
│  │    Routes    │  │   Routes     │  │   Routes     │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼─────────────────┼─────────────────┼──────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                      Service Layer                          │
├─────────────────┬─────────────────┬─────────────────────────┤
│ Research Service│   Chat Service  │  Query Router Service   │
│  (DeepAgents)   │  (Vector DB)    │  (Smart Cache)          │
└────────┬────────┴────────┬────────┴───────────┬─────────────┘
         │                 │                    │
         ▼                 ▼                    ▼
┌─────────────────┬─────────────────┬─────────────────────────┐
│  DeepAgents     │   Vector Store  │  Embedding Service      │
│  Orchestration  │   (Postgres     │  (OpenAI Embeddings)    │
│                 │    pgvector)    │                         │
└─────────────────┴─────────────────┴─────────────────────────┘
         │                 │
         ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data & Search Layer                      │
├─────────────────────────────┬───────────────────────────────┤
│  Exa Web Search (MCP)       │  PostgreSQL + pgvector        │
│  - Real-time research       │  - Local cache                │
│  - Deep crawling            │  - Conversation history       │
│  - Source extraction        │  - Similarity search          │
└─────────────────────────────┴───────────────────────────────┘
```

## Core Features

### 1. Intelligent Query Routing

The system uses a smart query router that:
- **Checks vector database first** for similar previous queries
- **Returns cached results** if similarity > 90%
- **Triggers fresh research** only when needed
- **Saves time and API costs** for common questions

### 2. Multi-Agent Research System

Seven specialized subagents collaborate to produce comprehensive reports:

| Agent | Responsibility |
|-------|---------------|
| **market-analysis** | TAM, growth rates, industry trends |
| **financial-research** | Financials, ratios, valuation |
| **competitive-analysis** | Market position, moats, competitors |
| **risk-assessment** | Risk factors, ESG, macro risks |
| **bull-case** | Upside catalysts, growth opportunities |
| **bear-case** | Downside risks, vulnerabilities |
| **growth-outlook** | Long-term trajectory, sustainability |

### 3. Report Structure

Each research job produces a comprehensive report with:

- **Executive Summary** - Key findings and recommendation
- **Bull Case** - Optimistic thesis and upside drivers
- **Bear Case** - Pessimistic thesis and risk factors
- **Long-term Growth Outlook** - Sustainability analysis
- **Market Analysis** - TAM, trends, dynamics
- **Financial Overview** - Metrics, valuation, health
- **Competitive Landscape** - Positioning and moats
- **Risk Factors** - Comprehensive risk assessment

### 4. Chat System with Memory

- **Conversations** persist across sessions
- **Context awareness** remembers the stock being discussed
- **Follow-up queries** use vector search for relevant context
- **Source attribution** shows which research supported each answer

## API Endpoints

### Research

```
POST   /api/research              # Create research job
GET    /api/research              # List all jobs
GET    /api/research/:jobId       # Get job details & results
```

### Chat

```
POST   /api/chat/conversations              # Create conversation
GET    /api/chat/conversations              # List conversations
GET    /api/chat/conversations/:id          # Get conversation
GET    /api/chat/conversations/:id/messages # Get messages
POST   /api/chat/conversations/:id/messages # Send message
GET    /api/chat/search?q=query             # Search conversations
DELETE /api/chat/conversations/:id          # Delete conversation
```

## Quick Start

### Prerequisites

- Bun runtime installed
- PostgreSQL 14+ with pgvector extension
- Exa AI API key
- DigitalOcean GenAI API key (or OpenAI API key)

### Installation

```bash
# Install dependencies
bun install

# Set up environment variables
cp .env.example .env

# Edit .env with your credentials:
# - DATABASE_URL (local Postgres or DigitalOcean Managed DB)
# - EXA_API_KEY
# - DO_GENAI_API_KEY

# Run database migrations
bun run db:migrate

# Start development server
bun run dev
```

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/deeptick

# AI/LLM (DigitalOcean GenAI or OpenAI)
DO_GENAI_API_KEY=your_key_here
DO_GENAI_ENDPOINT=https://api.genai.digitalocean.com/v1

# Search
EXA_API_KEY=your_exa_key_here

# Optional: LangSmith Tracing
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=your_key

# Server
PORT=3001
NODE_ENV=development
```

## Usage Examples

### Basic Research Request

```bash
curl -X POST http://localhost:3001/api/research \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Analyze Tesla (TSLA) investment prospects for 2025",
    "focusAreas": ["EV market growth", "competition", "energy business"]
  }'
```

### Chat with Follow-up Questions

```bash
# Create conversation
curl -X POST http://localhost:3001/api/chat/conversations \
  -H "Content-Type: application/json" \
  -d '{"title": "Tesla Analysis", "context": {"currentStock": "TSLA"}}'

# Send message (returns cached result if available)
curl -X POST http://localhost:3001/api/chat/conversations/{id}/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "What about Tesla energy business?"}'
```

## Vector Store Configuration

The system supports dual vector store setup:

1. **Local PostgreSQL with pgvector** - Fast local caching
2. **DigitalOcean Managed Database** - Production scalability

Configure via `DATABASE_URL` environment variable.

### pgvector Setup

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create tables with vector columns (handled by Drizzle migrations)
-- Vector dimension: 1536 (OpenAI text-embedding-3-small)
```

## How Smart Caching Works

```
User Query
    │
    ▼
┌─────────────────────┐
│  Embed Query Text   │──▶ OpenAI Embeddings API
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│  Vector Similarity  │──▶ pgvector cosine similarity search
│  Search in pgvector │
└─────────────────────┘
    │
    ├── Similarity > 0.9 ──▶ Return cached result immediately
    │
    ├── Similarity > 0.8 ──▶ Return cached + flag for fresh search
    │
    └── No match ──────────▶ Trigger DeepAgents research
                                    │
                                    ▼
                           ┌──────────────────┐
                           │  Deep Research   │
                           │  with Exa Search │
                           └──────────────────┘
                                    │
                                    ▼
                           ┌──────────────────┐
                           │  Store results   │
                           │  in vector DB    │
                           └──────────────────┘
```

## Technology Stack

- **Runtime**: Bun
- **API Framework**: Elysia.js
- **AI/LLM**: LangChain + DeepAgents
- **Search**: Exa AI (Web Search MCP)
- **Database**: PostgreSQL + pgvector
- **ORM**: Drizzle ORM
- **Validation**: TypeBox
- **Language**: TypeScript

## Project Structure

```
server/
├── src/
│   ├── api/
│   │   ├── routes/           # API route handlers
│   │   └── websocket/        # WebSocket handlers
│   ├── db/
│   │   ├── schema.ts         # Database schema definitions
│   │   └── connection.ts     # Database connection
│   ├── services/
│   │   ├── research.service.ts     # Main research orchestration
│   │   ├── chat.service.ts         # Chat & conversation management
│   │   ├── vector-store.service.ts # Vector DB operations
│   │   ├── query-router.service.ts # Smart query routing
│   │   └── embedding.service.ts    # Text embedding generation
│   ├── subagents/
│   │   └── index.ts          # DeepAgents subagent definitions
│   ├── tools/
│   │   └── exa-tools.ts      # Exa search tools
│   ├── types/
│   │   └── research.types.ts # TypeScript type definitions
│   └── config/
│       └── index.ts          # Configuration management
├── drizzle.config.ts         # Drizzle ORM configuration
└── package.json
```

## Development

```bash
# Run in development mode with hot reload
bun run dev

# Run type checking
bun run typecheck

# Run database migrations
bun run db:migrate

# Open Drizzle Studio (database GUI)
bun run db:studio
```

## License

MIT
