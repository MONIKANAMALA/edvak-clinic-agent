import dotenv from 'dotenv';
dotenv.config();

import { DeterministicEngine } from './deterministicEngine.js';
import { LocalHuggingFaceEngine } from './localModel.js';

/**
 * Clean LLM Provider Abstraction
 * Supports:
 * - 'huggingface' / 'local': In-process local Hugging Face AI model (Zero API keys, zero rate limits!)
 * - 'ollama': Local Ollama inference server (e.g. llama3.2, smollm)
 * - 'mistral': Mistral AI API
 * - 'openai': OpenAI API
 * - 'anthropic': Anthropic Claude API
 * - 'deterministic': Explicit rule-based baseline
 */
export class LLMProvider {
  constructor(dataStore, toolRegistry) {
    this.store = dataStore;
    this.tools = toolRegistry;
    this.deterministicEngine = new DeterministicEngine(dataStore, toolRegistry);

    const explicitProvider = process.env.LLM_PROVIDER?.toLowerCase();
    if (explicitProvider) {
      this.provider = explicitProvider;
    } else if (process.env.MISTRAL_API_KEY) {
      this.provider = 'mistral';
    } else if (process.env.OPENAI_API_KEY) {
      this.provider = 'openai';
    } else if (process.env.ANTHROPIC_API_KEY) {
      this.provider = 'anthropic';
    } else {
      this.provider = 'deterministic';
    }

    if (this.provider === 'local' || this.provider === 'huggingface') {
      this.localEngine = new LocalHuggingFaceEngine(dataStore, toolRegistry);
      this.model = process.env.LOCAL_MODEL || 'Xenova/all-MiniLM-L6-v2';
      this.apiKey = 'local-in-process';
      this.baseUrl = 'local';
    } else if (this.provider === 'ollama') {
      this.apiKey = 'ollama';
      this.model = process.env.LLM_MODEL || 'llama3.2:1b';
      this.baseUrl = process.env.LLM_BASE_URL || 'http://localhost:11434/v1/chat/completions';
    } else if (this.provider === 'mistral') {
      this.apiKey = process.env.MISTRAL_API_KEY || process.env.LLM_API_KEY || '';
      this.model = process.env.LLM_MODEL || 'mistral-small-latest';
      this.baseUrl = process.env.LLM_BASE_URL || 'https://api.mistral.ai/v1/chat/completions';
    } else if (this.provider === 'openai') {
      this.apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || '';
      this.model = process.env.LLM_MODEL || 'gpt-4o';
      this.baseUrl = process.env.LLM_BASE_URL || 'https://api.openai.com/v1/chat/completions';
    } else if (this.provider === 'anthropic') {
      this.apiKey = process.env.ANTHROPIC_API_KEY || process.env.LLM_API_KEY || '';
      this.model = process.env.LLM_MODEL || 'claude-3-5-sonnet-20241022';
      this.baseUrl = process.env.LLM_BASE_URL || 'https://api.anthropic.com/v1/messages';
    } else {
      this.apiKey = process.env.LLM_API_KEY || '';
      this.model = process.env.LLM_MODEL || 'baseline';
      this.baseUrl = process.env.LLM_BASE_URL || '';
    }

    this.allowFallback = process.env.ALLOW_DETERMINISTIC_FALLBACK !== 'false';

    // Metrics tracking
    this.runStats = {
      llmCalls: 0,
      fallbackCalls: 0,
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      errors: []
    };
  }

  isConfiguredForLiveLLM() {
    if (this.provider === 'local' || this.provider === 'huggingface' || this.provider === 'ollama') {
      return true;
    }
    return this.provider !== 'deterministic' && !!this.apiKey;
  }

  getProviderInfo() {
    return {
      provider: this.provider,
      model: this.model,
      hasApiKey: !!this.apiKey,
      isLiveLLM: this.isConfiguredForLiveLLM(),
      allowFallback: this.allowFallback
    };
  }

  /**
   * Main entry point to process a message
   */
  async processMessage(message) {
    if (!this.isConfiguredForLiveLLM()) {
      // Deterministic baseline run
      this.runStats.fallbackCalls++;
      const result = await this.deterministicEngine.processMessage(message);
      return {
        ...result,
        _execution_meta: {
          engine: 'deterministic_baseline',
          is_fallback: false,
          model: 'rule-based-policy-engine'
        }
      };
    }

    // Attempt live LLM execution
    try {
      this.runStats.llmCalls++;
      const llmResult = await this.callLiveLLM(message);
      return {
        ...llmResult,
        _execution_meta: {
          engine: this.provider,
          is_fallback: false,
          model: this.model
        }
      };
    } catch (err) {
      this.runStats.errors.push({ id: message.id, error: err.message });

      if (this.allowFallback) {
        console.warn(`[WARN] LLM call failed for message ${message.id} (${err.message}). Using deterministic fallback.`);
        this.runStats.fallbackCalls++;
        const fallbackResult = await this.deterministicEngine.processMessage(message);
        return {
          ...fallbackResult,
          _execution_meta: {
            engine: 'deterministic_fallback',
            is_fallback: true,
            model: this.model,
            fallback_reason: err.message
          }
        };
      }

      throw new Error(`LLM call failed for message ${message.id}: ${err.message}`);
    }
  }

  /**
   * Calls the configured LLM API (OpenAI / Anthropic / Gemini)
   */
  async callLiveLLM(message) {
    const toolDefs = this.tools.getToolDefinitions().map(t => `- ${t.name}: ${t.description}`).join('\n');

    const systemPrompt = `You are an AI front-desk agent for Maplewood Family Clinic.
Today is ${this.store.getToday()}.

Available MCP Clinic Tools:
${toolDefs}

Clinic policies:
1. Medical emergencies must be escalated immediately with urgency 'emergency', action 'escalate_emergency', routed to 'clinician_urgent'. Never provide automated clinical medical advice for emergencies.
2. Controlled substances refills cannot be prepared by the agent; route to provider.
3. Patients not seen in 12 months require an appointment before refills.
4. Refills with zero refills remaining route to provider.
5. Refills requested >7 days before supply depletion are too early.
6. Appointments must not double-book providers, cannot be during lunch (12-13), on holidays, or during provider leave.
7. Unverified senders or unauthorized third parties cannot receive protected health information.
8. Output JSON only according to this exact schema:
{
  "patient_id": string or null,
  "intents": string[],
  "urgency": "emergency" | "urgent" | "routine",
  "actions": string[],
  "routed_to": string[],
  "tool_calls": string[],
  "reply_draft": string
}`;

    const userPrompt = `Process this incoming message:
ID: ${message.id}
From: ${message.from_name} (${message.from_contact})
Channel: ${message.channel}
Stated DOB: ${message.stated_dob || 'none'}
Body: "${message.body}"`;

    if (this.provider === 'local' || this.provider === 'huggingface') {
      return await this.localEngine.processMessage(message);
    } else if (this.provider === 'ollama' || this.provider === 'mistral' || this.provider === 'openai') {
      return await this.callOpenAI(systemPrompt, userPrompt, message);
    } else if (this.provider === 'anthropic') {
      return await this.callAnthropic(systemPrompt, userPrompt, message);
    } else {
      throw new Error(`Unsupported LLM provider "${this.provider}"`);
    }
  }

  async callOpenAI(systemPrompt, userPrompt, originalMessage) {
    const url = this.baseUrl || 'https://api.openai.com/v1/chat/completions';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI HTTP ${response.status}: ${errorText.substring(0, 150)}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenAI');
      }

      const parsed = JSON.parse(content);
      // Ensure required structure
      return {
        id: originalMessage.id,
        patient_id: parsed.patient_id ?? null,
        intents: Array.isArray(parsed.intents) ? parsed.intents : ['other'],
        urgency: parsed.urgency || 'routine',
        actions: Array.isArray(parsed.actions) ? parsed.actions : ['no_action'],
        routed_to: Array.isArray(parsed.routed_to) ? parsed.routed_to : [],
        tool_calls: Array.isArray(parsed.tool_calls) ? parsed.tool_calls : ['find_patient'],
        reply_draft: parsed.reply_draft || 'Thank you for contacting Maplewood Family Clinic.'
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async callAnthropic(systemPrompt, userPrompt, originalMessage) {
    const url = this.baseUrl || 'https://api.anthropic.com/v1/messages';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.model,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          max_tokens: 1024,
          temperature: 0.1
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic HTTP ${response.status}: ${errorText.substring(0, 150)}`);
      }

      const data = await response.json();
      const text = data.content?.[0]?.text;
      const parsed = JSON.parse(text);

      return {
        id: originalMessage.id,
        patient_id: parsed.patient_id ?? null,
        intents: Array.isArray(parsed.intents) ? parsed.intents : ['other'],
        urgency: parsed.urgency || 'routine',
        actions: Array.isArray(parsed.actions) ? parsed.actions : ['no_action'],
        routed_to: Array.isArray(parsed.routed_to) ? parsed.routed_to : [],
        tool_calls: Array.isArray(parsed.tool_calls) ? parsed.tool_calls : ['find_patient'],
        reply_draft: parsed.reply_draft || 'Thank you for contacting Maplewood Family Clinic.'
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  getRunStats() {
    return { ...this.runStats };
  }
}
