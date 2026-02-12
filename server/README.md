# **Product Requirements Document (PRD): Pramana**

## **1. Project Vision**

**Pramana** is a high-performance, agentic research platform designed to provide retail investors with institutional-grade stock analysis. It automates the "Deep Research" workflow—scraping, analyzing, and auditing data—delivering verifiable reports with full source transparency.

---

## **2. System Architecture & Tech Stack**

* **Backend Runtime:** Bun (v1.2+)
* **Server API:** **ElysiaJS** (High-performance, type-safe API layer)
* **Orchestration:** LangGraph.js + LangChain Deep Agents
* **Intelligence:** Fine-tuned Llama 3.3 / DeepSeek R1 (DigitalOcean GPU Droplets)
* **Data Scraper:** Rust-based CLI (CPU Droplet)
* **Search Engine:** Exa Search API
* **Vector Database (RAG):** DigitalOcean Managed OpenSearch
* **Storage:** DigitalOcean Spaces (S3-compatible)
* **Frontend:** Next.js (TypeScript) + Vercel AI SDK

---

## **3. Functional Requirements**

### **3.1. Unified Server API (ElysiaJS)**

* **End-to-end Type Safety:** Use `Elysia.t` (TypeBox) to define schemas for stock queries, ensuring the frontend and backend are always in sync without manual DTOs.
* **Real-time Streaming:** Implement **Elysia Server-Sent Events (SSE)** or WebSockets to stream "Agent Thoughts" and the final report from the LangGraph loop directly to the Next.js UI.
* **Swagger Documentation:** Enable `@elysiajs/swagger` for instant, interactive documentation of the research endpoints.

### **3.2. Agentic Workflows**

* **Phase 1: Deep Research (Cold Start):**
* **Planner Agent:** Breaks user query into specific tasks (e.g., "Extract CapEx from FY25 Q3 filing").
* **Execution Tools:** Triggers the **Rust Scraper** for filings and **Exa** for live news.
* **Memory Storage:** Upsert cleaned Markdown data into OpenSearch with Ticker/Timestamp metadata.


* **Phase 2: RAG Retrieval (Subsequent Queries):**
* **Recency Filter:** Prioritize Vector DB chunks  days old.
* **Delta Check:** If info is stale, autonomously search only for the "missing" time gap.



### **3.3. Compliance & Reporting**

* **Compliance Auditor Agent:** Must cross-reference every numerical claim in the draft report against the original source text in the Vector DB.
* **Report Generation:** Output structured reports featuring:
1. Executive Summary.
2. Financial Health (Quant analysis).
3. Growth Plans (Expansion details).
4. **Proof Layer:** Clickable citations for every claim.



---

## **4. Infrastructure Requirements (DigitalOcean)**

| Resource | Purpose | Strategy |
| --- | --- | --- |
| **GPU Droplet** | LLM Inference & Fine-tuning | **Ephemeral:** Spin up for "Deep Think" tasks; Snapshot and Kill. |
| **CPU Droplet** | **ElysiaJS Server** & Rust Scraper | **Persistent:** General Purpose Droplet to host the API 24/7. |
| **Managed DB** | OpenSearch (Vector RAG) | **Persistent:** Stores the "Institutional Memory." |
| **Spaces** | S3-compatible Storage | **Persistent:** Stores raw PDFs and model checkpoints. |

---

## **5. Logic Flow (The Elysia Bridge)**

1. **Request:** User asks about "HDFC Bank merger impact."
2. **Elysia Handler:** Validates input using TypeBox and checks OpenSearch for existing "HDFC" context.
3. **Agent Decision:** If context is missing/stale, Elysia executes the exa web search to to thoroughly do deep research . If context is missing/stale, Elysia executes the exa web search to to thoroughly do deep research . else if context is present, use  
4. **Deep Think:** The LangChain Deep Agent investigates, writes to the "Virtual File System," and generates the report.
5. **Response:** Elysia streams the progress and final JSON/Markdown report back to the UI.

---

## **6. Non-Functional Requirements**

* **Security:** Multi-tenant metadata filtering in OpenSearch (User X cannot see User Y's private research).
* **Auditability:** Every report must maintain a `trace_id` linking back to the raw scraper logs.
* **Speed:** ElysiaJS must maintain  overhead for the API layer (excluding LLM processing).


