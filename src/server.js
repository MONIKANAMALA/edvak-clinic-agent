import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { dataStore } from './data/dataStore.js';
import { toolRegistry } from './mcp/toolRegistry.js';
import { FrontDeskAgent } from './agent/frontDeskAgent.js';
import { Evaluator } from './evaluation/evaluator.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const agent = new FrontDeskAgent(dataStore, toolRegistry);

// Interactive Web Dashboard & API Discovery on GET /
app.get('/', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({
      service: 'Maplewood Family Clinic AI Front-Desk Agent API',
      status: 'online',
      today: dataStore.getToday(),
      endpoints: {
        'GET /': 'Interactive Web Clinical Workstation & API Playground',
        'GET /health': 'System health check and provider info',
        'POST /api/process-message': 'Process a single incoming patient message',
        'POST /api/run-batch': 'Process all 40 sample benchmark messages',
        'GET /api/evaluation': 'Get latest evaluation metrics against labels_sample.json'
      }
    });
  }

  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Maplewood Family Clinic AI Front-Desk Agent',
    today: dataStore.getToday(),
    providerInfo: agent.getProviderInfo()
  });
});

// Process a single message
app.post('/api/process-message', async (req, res) => {
  try {
    const rawMessage = req.body;
    const result = await agent.processMessage(rawMessage);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error: 'Message processing error',
      details: err.message
    });
  }
});

// Run batch processing on all sample messages
app.post('/api/run-batch', async (req, res) => {
  try {
    dataStore.resetAppointments();
    const messagesPath = path.resolve(__dirname, '../edvak_forge_data/messages_sample.json');
    const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));

    const batchResults = [];
    for (const msg of messages) {
      const out = await agent.processMessage(msg);
      batchResults.push(out.output);
    }

    const outputDir = path.resolve(__dirname, '../output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(path.join(outputDir, 'predictions.json'), JSON.stringify(batchResults, null, 2), 'utf8');

    res.json({
      processedCount: batchResults.length,
      sampleResults: batchResults.slice(0, 3)
    });
  } catch (err) {
    res.status(500).json({ error: 'Batch execution error', details: err.message });
  }
});

// Get latest evaluation summary
app.get('/api/evaluation', (req, res) => {
  const evalPath = path.resolve(__dirname, '../output/evaluation.json');
  if (fs.existsSync(evalPath)) {
    const data = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
    return res.json(data);
  }

  // If not generated, compute on the fly
  try {
    const predictionsPath = path.resolve(__dirname, '../output/predictions.json');
    const labelsPath = path.resolve(__dirname, '../edvak_forge_data/labels_sample.json');
    if (!fs.existsSync(predictionsPath) || !fs.existsSync(labelsPath)) {
      return res.status(404).json({ error: 'Predictions or labels not found. Run agent first.' });
    }
    const predictions = JSON.parse(fs.readFileSync(predictionsPath, 'utf8'));
    const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf8'));
    const evaluator = new Evaluator(labels, predictions);
    res.json(evaluator.evaluate());
  } catch (err) {
    res.status(500).json({ error: 'Evaluation failed', details: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

export function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`Maplewood Front-Desk API server running at http://${HOST}:${port}`);
    console.log(`Reference Date: ${dataStore.getToday()}`);
    console.log(`Provider Mode: ${agent.getProviderInfo().isLiveLLM ? agent.getProviderInfo().provider : 'deterministic_baseline'}`);
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startServer();
}

export default app;
