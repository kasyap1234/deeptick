import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

export interface Guardrail {
  id: string;
  name: string;
  type: 'sensitive_data' | 'jailbreak' | 'content_moderation';
  description: string;
}

export interface GuardrailCheckResult {
  passed: boolean;
  triggered: Array<{
    ruleName: string;
    message: string;
  }>;
}

export class GuardrailsService {
  private baseUrl = 'https://api.digitalocean.com/v2/gen-ai';
  private accessToken: string;

  constructor() {
    this.accessToken = process.env.DIGITALOCEAN_TOKEN || '';
  }

  async listGuardrails(): Promise<Guardrail[]> {
    if (!this.accessToken) {
      logger.warn('No DigitalOcean token configured for guardrails');
      return [];
    }

    try {
      const response = await fetch(`${this.baseUrl}/guardrails`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to list guardrails: ${response.status}`);
      }

      const data = await response.json() as { guardrails: Array<{ id: string; name: string; type: string }> };
      return data.guardrails.map(g => ({
        id: g.id,
        name: g.name,
        type: g.type as Guardrail['type'],
        description: `Gradient AI ${g.type} guardrail`,
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to list guardrails');
      return [];
    }
  }

  async checkContent(input: string, output?: string): Promise<GuardrailCheckResult> {
    const enabled = config.guardrails?.enabled ?? false;
    
    if (!enabled || !this.accessToken) {
      return { passed: true, triggered: [] };
    }

    const guardrailIds = [
      config.guardrails?.sensitiveDataId,
      config.guardrails?.jailbreakId,
      config.guardrails?.contentModerationId,
    ].filter(Boolean);

    if (guardrailIds.length === 0) {
      return { passed: true, triggered: [] };
    }

    try {
      const response = await fetch(`${this.baseUrl}/guardrails/check`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          guardrail_ids: guardrailIds,
          input,
          output: output || '',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.warn({ status: response.status, error: errorText }, 'Guardrail check failed');
        return { passed: true, triggered: [] };
      }

      const data = await response.json() as {
        passed: boolean;
        triggered_guardrails: Array<{ rule_name: string; message: string }>;
      };

      return {
        passed: data.passed,
        triggered: data.triggered_guardrails?.map(g => ({
          ruleName: g.rule_name,
          message: g.message,
        })) || [],
      };
    } catch (error) {
      logger.error({ error }, 'Guardrail check error');
      return { passed: true, triggered: [] };
    }
  }

  async sanitizeInput(input: string): Promise<{ sanitized: string; warnings: string[] }> {
    const result = await this.checkContent(input);
    
    if (result.passed) {
      return { sanitized: input, warnings: [] };
    }

    const warnings = result.triggered.map(t => t.message);
    
    let sanitized = input;
    for (const trigger of result.triggered) {
      if (trigger.ruleName.includes('sensitive')) {
        sanitized = sanitized.replace(/\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/g, '[REDACTED]');
        sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL REDACTED]');
      }
    }

    return { sanitized, warnings };
  }

  async sanitizeOutput(output: string): Promise<{ sanitized: string; warnings: string[] }> {
    const result = await this.checkContent('', output);
    
    if (result.passed) {
      return { sanitized: output, warnings: [] };
    }

    const warnings = result.triggered.map(t => t.message);
    
    let sanitized = output;
    for (const trigger of result.triggered) {
      if (trigger.ruleName.includes('content')) {
        sanitized = '[Content filtered by guardrails]';
      }
    }

    return { sanitized, warnings };
  }
}

export const guardrailsService = new GuardrailsService();
