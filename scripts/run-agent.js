import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { dataStore } from '../src/data/dataStore.js';
import { toolRegistry } from '../src/mcp/toolRegistry.js';
import { FrontDeskAgent } from '../src/agent/frontDeskAgent.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('====================================================');
  console.log(' Maplewood Family Clinic - AI Front-Desk Agent Runner');
  console.log('====================================================');

  // Reset in-memory appointment mutations for a clean run
  dataStore.resetAppointments();

  const messagesPath = path.resolve(__dirname, '../edvak_forge_data/messages_sample.json');
  if (!fs.existsSync(messagesPath)) {
    console.error(`Messages file not found at: ${messagesPath}`);
    process.exit(1);
  }

  const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
  console.log(`Loaded ${messages.length} sample messages from ${messagesPath}`);

  const agent = new FrontDeskAgent(dataStore, toolRegistry);
  const info = agent.getProviderInfo();
  console.log(`Execution Mode: ${info.isLiveLLM ? `Live LLM (${info.provider} - ${info.model})` : 'Deterministic Baseline Engine'}`);
  console.log(`Clinic Reference Date: ${dataStore.getToday()}`);
  console.log('----------------------------------------------------');

  const predictions = [];
  const executionMeta = [];
  const startTime = Date.now();

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    process.stdout.write(`Processing [${i + 1}/${messages.length}] ${msg.id}... `);
    const itemStart = Date.now();
    try {
      const res = await agent.processMessage(msg);
      predictions.push(res.output);
      executionMeta.push(res.meta);
      const elapsed = Date.now() - itemStart;
      console.log(`OK (${elapsed}ms) -> urgency=${res.output.urgency}, actions=[${res.output.actions.join(', ')}]`);
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      process.exit(1);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('----------------------------------------------------');
  console.log(`Processed all ${predictions.length} messages in ${totalTime}s.`);

  // Write output/predictions.json
  const outputDir = path.resolve(__dirname, '../output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const predictionsPath = path.join(outputDir, 'predictions.json');
  fs.writeFileSync(predictionsPath, JSON.stringify(predictions, null, 2), 'utf8');
  console.log(`Predictions successfully saved to: ${predictionsPath}`);
}

main().catch(err => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
