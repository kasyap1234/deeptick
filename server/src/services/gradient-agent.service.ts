import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface GradientAgentConfig {
  name: string;
  instruction: string;
  description?: string;
  modelUuid?: string;
  knowledgeBaseUuids?: string[];
}

export interface GradientAgent {
  id: string;
  name: string;
  modelUuid: string;
  instruction: string;
  description?: string;
  projectId: string;
  region: string;
  createdAt: string;
  updatedAt: string;
  knowledgeBaseUuids: string[];
  endpoint?: string;
  accessKey?: string;
}

export interface GradientAgentResponse {
  agent: GradientAgent;
}

export interface RetrievedData {
  id: string;
  index: string;
  page_content: string;
  score: number;
  filename: string;
  data_source_id: string;
  metadata?: Record<string, unknown>;
}

export interface RetrievalInfo {
  retrieved_data: RetrievedData[];
}

export interface AgentInvocationOptions {
  includeRetrievalInfo?: boolean;
  includeFunctionsInfo?: boolean;
  includeGuardrailsInfo?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export class GradientAgentService {
  private baseUrl = 'https://api.digitalocean.com';
  private apiVersion = 'v2';

  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30_000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private requireAccessToken(): string {
    if (!config.DO_GENAI_API_KEY) {
      throw new Error('DO_GENAI_API_KEY is required for Gradient agent operations');
    }
    return config.DO_GENAI_API_KEY;
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.requireAccessToken()}`,
    };
  }

  async createAgent(agentConfig: GradientAgentConfig): Promise<GradientAgent> {
    const { name, instruction, description, modelUuid, knowledgeBaseUuids } = agentConfig;

    if (!config.gradient.projectId) {
      throw new Error('GRADIENT_PROJECT_ID is required to create agents');
    }

    const payload: Record<string, unknown> = {
      name,
      instruction,
      model_uuid: modelUuid || 'gradient/llama-3-3-70b-instruct',
      project_id: config.gradient.projectId,
      region: config.gradient.region || 'tor1',
    };

    if (description) {
      payload.description = description;
    }

    if (knowledgeBaseUuids && knowledgeBaseUuids.length > 0) {
      payload.knowledge_base_uuid = knowledgeBaseUuids;
    }

    logger.info({ agentName: name, projectId: config.gradient.projectId }, 'Creating Gradient Agent');

    const response = await this.fetchWithTimeout(`${this.baseUrl}/${this.apiVersion}/gen-ai/agents`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, 'Failed to create Gradient Agent');
      throw new Error(`Failed to create agent: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as GradientAgentResponse;
    logger.info({ agentId: data.agent.id }, 'Gradient Agent created successfully');
    return data.agent;
  }

  async getAgent(agentId: string): Promise<GradientAgent> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/${this.apiVersion}/gen-ai/agents/${agentId}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get agent: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as GradientAgentResponse;
    return data.agent;
  }

  async listAgents(): Promise<GradientAgent[]> {
    if (!config.gradient.projectId) {
      throw new Error('GRADIENT_PROJECT_ID is required to list agents');
    }

    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/${this.apiVersion}/gen-ai/agents?project_id=${config.gradient.projectId}`,
      {
        method: 'GET',
        headers: this.getHeaders(),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list agents: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as { agents?: GradientAgent[] };
    return data.agents || [];
  }

  async deleteAgent(agentId: string): Promise<void> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/${this.apiVersion}/gen-ai/agents/${agentId}`, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to delete agent: ${response.status} - ${error}`);
    }

    logger.info({ agentId }, 'Gradient Agent deleted');
  }

  async attachKnowledgeBases(agentId: string, knowledgeBaseUuids: string[]): Promise<void> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/${this.apiVersion}/gen-ai/agents/${agentId}/knowledge_bases`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ knowledge_base_uuids: knowledgeBaseUuids }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to attach knowledge bases: ${response.status} - ${error}`);
    }

    logger.info({ agentId, kbCount: knowledgeBaseUuids.length }, 'Knowledge bases attached to agent');
  }

  async invokeAgent(agentId: string, message: string): Promise<{ response: string; sessionId?: string }> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/${this.apiVersion}/gen-ai/agents/${agentId}/complete`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          query: message,
          ...(config.gradient.projectId && { project_id: config.gradient.projectId }),
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to invoke agent: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    return {
      response:
        (typeof data.response === 'string' ? data.response : undefined) ||
        ((data.choices as any)?.[0]?.message?.content as string | undefined) ||
        '',
      sessionId: typeof data.session_id === 'string' ? data.session_id : undefined,
    };
  }

  async invokeAgentWithRetrieval(
    agentId: string,
    message: string,
    options: AgentInvocationOptions = {}
  ): Promise<{
    response: string;
    sessionId?: string;
    retrieval?: RetrievalInfo;
    functions?: { called_functions: string[] };
    guardrails?: { triggered_guardrails: Array<{ rule_name: string; message: string }> };
  }> {
    const agent = await this.getAgent(agentId);
    
    if (!agent.endpoint || !agent.accessKey) {
      throw new Error('Agent must have endpoint and accessKey configured. Use createAgentWithEndpoint() or update agent in console.');
    }

    const response = await this.fetchWithTimeout(`${agent.endpoint}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agent.accessKey}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }],
        stream: false,
        include_retrieval_info: options.includeRetrievalInfo ?? true,
        include_functions_info: options.includeFunctionsInfo ?? false,
        include_guardrails_info: options.includeGuardrailsInfo ?? false,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to invoke agent with retrieval: ${response.status} - ${error}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    return {
      response: ((data.choices as any)?.[0]?.message?.content as string | undefined) || '',
      sessionId: typeof data.session_id === 'string' ? data.session_id : undefined,
      retrieval: data.retrieval as RetrievalInfo | undefined,
      functions: data.functions as { called_functions: string[] } | undefined,
      guardrails: data.guardrails as { triggered_guardrails: Array<{ rule_name: string; message: string }> } | undefined,
    };
  }

  async *streamAgentWithRetrieval(
    agentId: string,
    message: string,
    options: AgentInvocationOptions = {}
  ): AsyncGenerator<{
    content: string;
    retrieval?: RetrievalInfo;
  }> {
    const agent = await this.getAgent(agentId);
    
    if (!agent.endpoint || !agent.accessKey) {
      throw new Error('Agent must have endpoint and accessKey configured');
    }

    const response = await this.fetchWithTimeout(`${agent.endpoint}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${agent.accessKey}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }],
        stream: true,
        include_retrieval_info: options.includeRetrievalInfo ?? true,
        include_functions_info: options.includeFunctionsInfo ?? false,
        include_guardrails_info: options.includeGuardrailsInfo ?? false,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to stream agent with retrieval: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';

    let currentRetrieval: RetrievalInfo | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content || '';

              if (parsed.retrieval) {
                currentRetrieval = parsed.retrieval;
              }

              if (content) {
                yield { content, retrieval: currentRetrieval };
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async createAgentWithEndpoint(agentConfig: GradientAgentConfig): Promise<GradientAgent> {
    const agent = await this.createAgent(agentConfig);
    
    const response = await fetch(`${this.baseUrl}/${this.apiVersion}/gen-ai/agents/${agent.id}`, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.warn({ agentId: agent.id, error }, 'Could not fetch agent endpoint details');
      return agent;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const agentData = (data.agent ?? {}) as Record<string, unknown>;
    return {
      ...agent,
      endpoint: typeof agentData.endpoint === 'string' ? agentData.endpoint : undefined,
      accessKey:
        typeof agentData.access_key === 'string'
          ? agentData.access_key
          : typeof agentData.accessKey === 'string'
            ? agentData.accessKey
            : undefined,
    };
  }

  async *streamAgent(agentId: string, message: string): AsyncGenerator<string> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/${this.apiVersion}/gen-ai/agents/${agentId}/stream`,
      {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          query: message,
          ...(config.gradient.projectId && { project_id: config.gradient.projectId }),
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to stream agent: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') return;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.response || parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

export const gradientAgentService = new GradientAgentService();
