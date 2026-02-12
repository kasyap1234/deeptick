const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Research endpoints
  async createResearchJob(query: string, context?: string, focusAreas?: string[]) {
    return this.fetch<{ success: boolean; data: { jobId: string; status: string; query: string; createdAt: string } }>('/api/research', {
      method: 'POST',
      body: JSON.stringify({ query, context, focusAreas }),
    });
  }

  async getResearchJobs(limit = 50, offset = 0) {
    return this.fetch<{ success: boolean; data: Array<{ jobId: string; status: string; query: string; createdAt: string; updatedAt: string; hasResult: boolean }> }>(`/api/research?limit=${limit}&offset=${offset}`);
  }

  async getResearchJob(jobId: string) {
    return this.fetch<{ success: boolean; data: import('./types').ResearchJob }>(`/api/research/${jobId}`);
  }

  async getResearchReport(jobId: string) {
    return this.fetch<{ success: boolean; data: { jobId: string; query: string; createdAt: string; report: import('./types').InstitutionalResearchReport } }>(`/api/research/${jobId}/report`);
  }

  async searchResearch(query: string, limit = 10, threshold = 0.7) {
    return this.fetch<{ success: boolean; data: Array<{ jobId: string; query: string; status: string; similarity: number }> }>(`/api/research/search?q=${encodeURIComponent(query)}&limit=${limit}&threshold=${threshold}`);
  }

  // Chat endpoints
  async createConversation(title?: string, context?: Record<string, unknown>) {
    return this.fetch<{ success: boolean; data: { conversationId: string; title: string } }>('/api/chat/conversations', {
      method: 'POST',
      body: JSON.stringify({ title, context }),
    });
  }

  async getConversations(limit = 20, offset = 0) {
    return this.fetch<{ success: boolean; data: import('./types').Conversation[] }>(`/api/chat/conversations?limit=${limit}&offset=${offset}`);
  }

  async getConversation(conversationId: string) {
    return this.fetch<{ success: boolean; data: import('./types').Conversation }>(`/api/chat/conversations/${conversationId}`);
  }

  async getMessages(conversationId: string, limit = 50) {
    return this.fetch<{ success: boolean; data: import('./types').Message[] }>(`/api/chat/conversations/${conversationId}/messages?limit=${limit}`);
  }

  async sendMessage(conversationId: string, content: string, options?: { jobId?: string; sources?: Array<{ url: string; title: string }> }) {
    return this.fetch<{ success: boolean; data: import('./types').ChatMessageResponse }>(`/api/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, ...options }),
    });
  }

  async deleteConversation(conversationId: string) {
    return this.fetch<{ success: boolean }>(`/api/chat/conversations/${conversationId}`, {
      method: 'DELETE',
    });
  }

  // WebSocket connections
  connectResearchWebSocket(jobId?: string): WebSocket {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws');
    const url = jobId ? `${wsUrl}/ws/research/${jobId}` : `${wsUrl}/ws/research`;
    return new WebSocket(url);
  }

  connectChatWebSocket(conversationId: string): WebSocket {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws');
    return new WebSocket(`${wsUrl}/ws/chat/${conversationId}`);
  }
}

export const api = new ApiClient(API_BASE_URL);
