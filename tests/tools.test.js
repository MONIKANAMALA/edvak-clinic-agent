import { test } from 'node:test';
import assert from 'node:assert';
import { toolRegistry } from '../src/mcp/toolRegistry.js';
import { LLMProvider } from '../src/agent/llmProvider.js';
import { dataStore } from '../src/data/dataStore.js';

test('MCP Tools: all tools are registered and return structured schema', () => {
  const defs = toolRegistry.getToolDefinitions();
  const toolNames = defs.map(d => d.name);

  assert.ok(toolNames.includes('find_patient'));
  assert.ok(toolNames.includes('verify_patient'));
  assert.ok(toolNames.includes('check_refill_eligibility'));
  assert.ok(toolNames.includes('prepare_refill_request'));
  assert.ok(toolNames.includes('find_available_slots'));
  assert.ok(toolNames.includes('book_appointment'));
  assert.ok(toolNames.includes('reschedule_appointment'));
  assert.ok(toolNames.includes('cancel_appointment'));
  assert.ok(toolNames.includes('route_message'));
  assert.ok(toolNames.includes('draft_reply'));
});

test('MCP Tools: throws clear error when executing unregistered tool', async () => {
  await assert.rejects(
    async () => {
      await toolRegistry.executeTool('non_existent_tool', {});
    },
    /is not registered in the clinic MCP server/
  );
});

test('LLM Provider: reports deterministic baseline when no API key is configured', () => {
  const origMistral = process.env.MISTRAL_API_KEY;
  const origLlm = process.env.LLM_API_KEY;
  const origOpenAI = process.env.OPENAI_API_KEY;
  const origAnthropic = process.env.ANTHROPIC_API_KEY;
  const origProvider = process.env.LLM_PROVIDER;

  delete process.env.MISTRAL_API_KEY;
  delete process.env.LLM_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.LLM_PROVIDER;

  try {
    const provider = new LLMProvider(dataStore, toolRegistry);
    const info = provider.getProviderInfo();
    assert.strictEqual(info.isLiveLLM, false);
    assert.strictEqual(info.hasApiKey, false);
    assert.strictEqual(info.provider, 'deterministic');
  } finally {
    if (origMistral !== undefined) process.env.MISTRAL_API_KEY = origMistral;
    if (origLlm !== undefined) process.env.LLM_API_KEY = origLlm;
    if (origOpenAI !== undefined) process.env.OPENAI_API_KEY = origOpenAI;
    if (origAnthropic !== undefined) process.env.ANTHROPIC_API_KEY = origAnthropic;
    if (origProvider !== undefined) process.env.LLM_PROVIDER = origProvider;
  }
});
