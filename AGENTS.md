always use bun instead of npm
use elsysia js for the api layer
use langchain , deep agents (part of langchain ecosystem )
all code should be written in typescript
use typebox for validation
use bun (elsyia js for the api layer, langchain for deep agents, exa web search for thorough research)

** Always use context7 mcp and exa search web mcp if you are not sure of the code to look for the right documentation and the correct code **



USE AGENT SKILLS WHEREVER POSSIBLE 


## Project Overview

DeepTick is an AI-powered stock research platform. A Next.js frontend communicates with a Bun/Elysia.js backend that orchestrates 16+ specialized DeepAgents (LangChain ecosystem) to produce institutional-grade equity research reports. PostgreSQL with pgvector handles data storage and semantic search.

## Commands

### Development
```bash
bun run dev              # Start both server (3001) and client (3000) in parallel
bun run dev:server       # Server only with hot reload
bun run dev:client       # Client only
```

### Build & Start
```bash
bun run build            # Build both
bun run start            # Start both in production mode
```

### Server (run from /server)
```bash
bun run typecheck        # TypeScript validation
bun run lint             # ESLint
bun run test             # Vitest
bun run test:ui          # Vitest with browser UI
bun run db:generate      # Generate Drizzle migrations
bun run db:migrate       # Run migrations
bun run db:studio        # Drizzle Studio GUI
```

### Client (run from /client/deeptick)
```bash
bun run lint             # ESLint
bun run build            # Next.js build (uses --webpack flag)
```

## Architecture

### Monorepo Layout
- **`server/`** — Bun + Elysia.js API (port 3001)
- **`client/deeptick/`** — Next.js 16 App Router frontend (port 3000)
- Root `package.json` orchestrates parallel dev/build/start

### Backend Stack
- **Runtime**: Bun
- **Framework**: Elysia.js with TypeBox validation
- **ORM**: Drizzle ORM with PostgreSQL + pgvector
- **Auth**: Better Auth (email/password + Google OAuth) — sessions stored in DB, routes protected with `{ auth: true }` macro
- **AI**: LangChain DeepAgents orchestrating 16+ specialized subagents + compliance auditor
- **Search Tools**: Exa (web search), Yahoo Finance, Context7
- **LLM Providers**: OpenAI (primary), Anthropic Claude, DigitalOcean GenAI

### Frontend Stack
- **Next.js 16** with App Router, React 19, TypeScript
- **Styling**: Tailwind CSS v4
- **UI**: Radix UI primitives, Framer Motion, Lucide icons
- **Auth**: Better Auth React client (session cookies with credentials: include)

### Key Data Flow
1. Client POSTs research query → server returns 202 + jobId
2. DeepAgents orchestrator spawns specialized subagents (market-size, financials, bull/bear thesis, etc.)
3. Subagents use Exa search + Yahoo Finance tools for data gathering
4. Results stored in PostgreSQL; embeddings stored for semantic cache
5. Smart cache: >90% similarity = cache hit, 80-90% = return cached + revalidate, <80% = fresh research

### Database Schema (server/src/db/schema.ts)
- **Auth tables**: users, sessions, accounts, verifications (from auth-schema.ts)
- **Business tables**: research_jobs, sources, conversations, messages, user_knowledge_bases, prompt_cache, report_embeddings
- Embeddings stored as JSON text, cast to vector in SQL queries (1536 dims, OpenAI text-embedding-3-small)

### API Routes Pattern
All routes under `server/src/api/routes/`. Key endpoints:
- `/api/research` — CRUD for research jobs + vector search
- `/api/chat/conversations` — Conversations and messages
- `/api/gradient/*` — Optional DigitalOcean Gradient AI integration
- `/api/auth/*` — Better Auth handles all auth endpoints
- `/api/health` — Health check

## Conventions

- Always use **Bun** (never npm/yarn/node)
- Use **Elysia.js** for API routes with **TypeBox** for request/response validation
- Use **LangChain DeepAgents** for AI orchestration
- All code in **TypeScript** with strict mode
- Services follow `*.service.ts` naming, routes follow `*.routes.ts`, tools follow `*-tools.ts`
- Database tables use plural snake_case names
- Centralized error handling via `server/src/utils/api-error.ts`
- Server config validated with Zod in `server/src/config/index.ts` — process exits on validation failure

## Branches
- `normal` — main branch (use for PRs)
- `digitalocean` — DigitalOcean deployment variant
