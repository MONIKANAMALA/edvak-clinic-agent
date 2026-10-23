import { LLMProvider } from './llmProvider.js';
import { validateAgentOutput, InputMessageSchema } from '../schemas/outputSchema.js';
import { assessEmergency } from '../policies/safetyPolicy.js';

export class FrontDeskAgent {
  constructor(dataStore, toolRegistry) {
    this.store = dataStore;
    this.tools = toolRegistry;
    this.provider = new LLMProvider(dataStore, toolRegistry);
  }

  getProviderInfo() {
    return this.provider.getProviderInfo();
  }

  /**
   * Process a single incoming patient message
   */
  async processMessage(rawMessage) {
    // 1. Validate input message
    const inputValidation = InputMessageSchema.safeParse(rawMessage);
    if (!inputValidation.success) {
      throw new Error(`Invalid input message format: ${JSON.stringify(inputValidation.error.format())}`);
    }
    const message = inputValidation.data;

    // 2. Pre-execution Safety Guard: Immediate Emergency Triage Check
    // If the message is an unequivocal medical emergency, enforce emergency handling
    const emergencyTriage = assessEmergency(message.body);

    // 3. Process via provider
    const result = await this.provider.processMessage(message);

    // 4. Post-execution Safety Guard: Enforce strict deterministic safety invariants
    if (emergencyTriage.isEmergency) {
      result.urgency = 'emergency';
      if (!result.actions.includes('escalate_emergency')) {
        result.actions = ['escalate_emergency'];
      }
      if (!result.routed_to.includes('clinician_urgent')) {
        result.routed_to = ['clinician_urgent'];
      }
      // Guarantee no automated advice in reply
      if (!result.reply_draft.includes('911') && !result.reply_draft.includes('emergency')) {
        result.reply_draft = 'EMERGENCY ALERT: Please call 911 immediately or go to the nearest emergency room. We have alerted our clinic staff.';
      }
    }

    // Strip internal execution metadata from the public output schema
    const { _execution_meta, ...cleanOutput } = result;

    // 5. Validate output schema against Zod
    const outputValidation = validateAgentOutput(cleanOutput);
    if (!outputValidation.success) {
      console.error(`Validation failed for message ${message.id}:`, outputValidation.error.format());
      throw new Error(`Agent output schema validation failed: ${JSON.stringify(outputValidation.error.issues)}`);
    }

    return {
      output: outputValidation.data,
      meta: _execution_meta || { engine: 'unknown' }
    };
  }

  /**
   * Process an array of messages sequentially
   */
  async processBatch(messages) {
    const results = [];
    for (const msg of messages) {
      const res = await this.processMessage(msg);
      results.push(res);
    }
    return results;
  }
}
