import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { config } from '../config/index.js';
import type { InstitutionalResearchReport } from '../types/research.types.js';

export interface ChatContext {
  conversationId: string;
  currentStock?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  relevantResearch?: InstitutionalResearchReport;
  relatedChunks?: Array<{
    content: string;
    similarity: number;
    source?: string;
  }>;
}

export interface LLMResponse {
  content: string;
  sources?: Array<{ url: string; title: string }>;
  confidence?: number;
}

export class GradientLLMService {
  private llm: ChatOpenAI;

  constructor() {
    // Gradient AI is compatible with OpenAI API format
    this.llm = new ChatOpenAI({
      modelName: 'gradient/llama-3-70b-instruct', // or your preferred Gradient model
      temperature: 0.7,
      maxTokens: 2000,
      streaming: true,
      openAIApiKey: config.DO_GENAI_API_KEY,
      configuration: {
        baseURL: config.DO_GENAI_ENDPOINT,
      },
    });
  }

  async generateResponse(context: ChatContext): Promise<LLMResponse> {
    const messages = this.buildMessages(context);
    
    const response = await this.llm.invoke(messages);
    
    return {
      content: response.content as string,
      sources: this.extractSourcesFromContext(context),
    };
  }

  async *streamResponse(context: ChatContext): AsyncGenerator<string> {
    const messages = this.buildMessages(context);
    
    const stream = await this.llm.stream(messages);
    
    for await (const chunk of stream) {
      if (chunk.content) {
        yield chunk.content as string;
      }
    }
  }

  async generateResearchSummary(
    query: string,
    report: InstitutionalResearchReport
  ): Promise<string> {
    const systemPrompt = `You are an expert equity research analyst providing concise summaries for retail investors.

Your task is to create a clear, actionable summary of the institutional research report.
Focus on:
- Key investment thesis (bull and bear cases)
- Critical financial metrics
- Major risks and opportunities
- Clear recommendation

Keep your response concise but comprehensive. Use bullet points for readability.`;

    const userPrompt = `Original Query: ${query}

Research Report Summary:
${report.executiveSummary}

Bull Case:
${report.bullCase}

Bear Case:
${report.bearCase}

Investment Conclusion:
${report.investmentConclusion}

Please provide a concise summary for a retail investor.`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ];

    const response = await this.llm.invoke(messages);
    return response.content as string;
  }

  async enhanceQuery(query: string, context?: string): Promise<string> {
    const systemPrompt = `You are a query enhancement specialist for stock research.

Your task is to rewrite user queries to maximize search effectiveness.

Rules:
- Expand acronyms (TSLA → Tesla, AAPL → Apple)
- Add relevant financial context
- Include synonyms for better recall
- Keep the core intent intact
- Make it specific and searchable

Example:
Input: "How is Tesla doing?"
Output: "Tesla (TSLA) stock performance financial results earnings revenue 2024 2025"`;

    const userPrompt = context
      ? `Context: ${context}\n\nQuery: ${query}\n\nEnhanced Query:`
      : `Query: ${query}\n\nEnhanced Query:`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ];

    const response = await this.llm.invoke(messages);
    return (response.content as string).trim();
  }

  async analyzeFollowUp(
    query: string,
    previousContext: string
  ): Promise<{ requiresNewResearch: boolean; expandedQuery: string }> {
    const systemPrompt = `You are analyzing follow-up questions in a stock research conversation.

Determine if the follow-up question requires new research or can be answered from existing context.

Respond in JSON format:
{
  "requiresNewResearch": boolean,
  "expandedQuery": "the expanded/full question with context"
}

Rules:
- If asking for new data, news, or comparisons → requiresNewResearch: true
- If clarifying previous answer or asking for elaboration → requiresNewResearch: false
- Always expand the query with context from the conversation`;

    const userPrompt = `Previous Context:\n${previousContext}\n\nFollow-up Question: ${query}\n\nAnalyze and respond in JSON format.`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ];

    const response = await this.llm.invoke(messages);
    
    try {
      const parsed = JSON.parse(response.content as string);
      return {
        requiresNewResearch: parsed.requiresNewResearch ?? true,
        expandedQuery: parsed.expandedQuery ?? query,
      };
    } catch {
      // If parsing fails, default to requiring research
      return {
        requiresNewResearch: true,
        expandedQuery: `${previousContext}\n\nFollow-up: ${query}`,
      };
    }
  }

  private buildMessages(context: ChatContext): (SystemMessage | HumanMessage | AIMessage)[] {
    const systemPrompt = this.buildSystemPrompt(context);
    const messages: (SystemMessage | HumanMessage | AIMessage)[] = [
      new SystemMessage(systemPrompt),
    ];

    // Add conversation history
    for (const msg of context.messages.slice(-10)) { // Keep last 10 messages for context
      if (msg.role === 'user') {
        messages.push(new HumanMessage(msg.content));
      } else {
        messages.push(new AIMessage(msg.content));
      }
    }

    return messages;
  }

  private buildSystemPrompt(context: ChatContext): string {
    let prompt = `You are DeepTick, an institutional-grade AI research assistant for retail investors. You provide comprehensive, evidence-based stock analysis that rivals what a 1000-member institutional research team would produce.

CORE CAPABILITIES:
- Deep fundamental analysis
- Bull and bear case construction
- Risk assessment and scenario planning
- Competitive positioning analysis
- Valuation modeling

RESPONSE GUIDELINES:
1. Be concise but thorough - every sentence should add value
2. Cite specific data points with context
3. Balance bullish and bearish perspectives
4. Use bullet points for readability
5. End with clear, actionable takeaways
6. If you're uncertain, acknowledge limitations`;

    if (context.currentStock) {
      prompt += `\n\nCURRENT FOCUS: ${context.currentStock}`;
    }

    if (context.relevantResearch) {
      prompt += `\n\nRELEVANT RESEARCH CONTEXT:\n${this.formatResearchContext(context.relevantResearch)}`;
    }

    if (context.relatedChunks && context.relatedChunks.length > 0) {
      prompt += `\n\nRELEVANT DOCUMENT CHUNKS:\n${context.relatedChunks
        .slice(0, 5)
        .map((chunk) => `- ${chunk.content.substring(0, 300)}...`)
        .join('\n')}`;
    }

    return prompt;
  }

  private formatResearchContext(report: InstitutionalResearchReport): string {
    const sections = [
      `Executive Summary: ${report.executiveSummary.substring(0, 500)}...`,
    ];

    if (report.bullCase) {
      sections.push(`Bull Case: ${report.bullCase.substring(0, 300)}...`);
    }

    if (report.bearCase) {
      sections.push(`Bear Case: ${report.bearCase.substring(0, 300)}...`);
    }

    if (report.investmentConclusion) {
      sections.push(`Conclusion: ${report.investmentConclusion.substring(0, 300)}...`);
    }

    return sections.join('\n\n');
  }

  private extractSourcesFromContext(context: ChatContext): Array<{ url: string; title: string }> {
    const sources: Array<{ url: string; title: string }> = [];

    if (context.relevantResearch?.sources) {
      sources.push(...context.relevantResearch.sources.slice(0, 5).map((s) => ({
        url: s.url,
        title: s.title,
      })));
    }

    return sources;
  }
}

export const gradientLLMService = new GradientLLMService();
