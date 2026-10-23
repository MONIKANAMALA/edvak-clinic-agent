# AI Front-Desk Agent — Maplewood Family Clinic

A production-grade, policy-enforced AI front-desk agent for an outpatient clinic, built for the **Edvak Forge Take-Home Assignment**.

The system automates outpatient front-desk communication across SMS, email, and patient portal channels while strictly upholding clinical safety triage, patient privacy verification (HIPAA alignment), medication refill eligibility, and provider scheduling constraints.

---

## 1. Project Overview

Maplewood Family Clinic is a busy outpatient primary care practice staffed by three clinicians:
- **Dr. Maya Patel** (Family Medicine)
- **Dr. James Okafor** (Internal Medicine)
- **Sarah Kim, NP** (Nurse Practitioner — adults and children)

The clinic receives patient messages across SMS, patient portal, and email. The AI Front-Desk Agent automates:
1. **Safety Triage**: Immediate detection and escalation of medical emergencies (e.g. acute coronary syndromes, head trauma with confusion, acute respiratory failure, anticoagulant hemorrhage, neuroglycopenic hypoglycemia) to human clinicians via `clinician_urgent`, strictly barring automated clinical advice and mandating immediate 911 advisories.
2. **Patient & Caregiver Verification**: Cryptographically safe identity verification enforcing clinic privacy policies before disclosing any Protected Health Information (PHI) or appointment details.
3. **Refill Protocol Verification**: Five-point algorithmic compliance check (active medication, non-controlled schedule, seen within 12 months, remaining refills > 0, ≤ 7-day supply exhaustion window).
4. **Schedule Management**: Real-time conflict-free slot booking, rescheduling, and cancellations respecting clinic hours (09:00–17:00), lunch breaks (12:00–13:00), holidays, and provider leave (e.g., Dr. Okafor leave Nov 16–20).
5. **Multi-Queue Routing**: Precise destination assignment across `clinician_urgent`, `clinician_routine`, `provider_refills`, `front_desk`, and `billing`.
6. **Bilingual Patient Engagement**: Empathetic, professional responses rendered in the patient's preferred language (English or Spanish).

> [!CAUTION]
> **Synthetic Prototype Notice:** This system is an evaluation prototype built on synthetic benchmark data. It has not undergone clinical validation, FDA Software as a Medical Device (SaMD) review, or formal HIPAA compliance certification. It must never be deployed into real clinical production without rigorous clinical trials and human-in-the-loop oversight.

### 📖 Interview & Walkthrough Resources
- **[INTERVIEW_DEMO_AND_QA_GUIDE.md](file:///d:/Task_edvak/INTERVIEW_DEMO_AND_QA_GUIDE.md)**: **Master Interview Demo Playbook & Comprehensive Q&A Defense Guide** (5-minute live screen-share demo script, button-by-button actions, speaking points, and answers to 14 tough interview questions).
- **[WORKFLOW_AND_INTERVIEW_GUIDE.md](file:///d:/Task_edvak/WORKFLOW_AND_INTERVIEW_GUIDE.md)**: In-depth technical architecture breakdown, testing playbook, and 12-scenario benchmark catalog.

---

## 2. Architecture & Message Processing Flow

```
+-----------------------------------------------------------------------------------+
|                            Incoming Patient Message                               |
|                  (ID, Channel, Sender Name, Contact, Body)                        |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                       Input Validation (Zod Schema)                               |
+-----------------------------------------------------------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|               Phase 1: Deterministic Safety & Injection Triage                    |
|   - Regex & semantic detector for acute physiological emergencies                 |
|   - Distinguishes colloquial idioms (e.g. "dying to get in")                      |
|   - Detects prompt injections / instruction-override attempts                     |
+-----------------------------------------------------------------------------------+
                                          |
        +---------------------------------+---------------------------------+
        |                                                                   |
   [Emergency]                                                       [Non-Emergency]
        |                                                                   |
        v                                                                   v
+-----------------------------------+             +-----------------------------------+
| Immediate 911 Escalation          |             | Phase 2: Identity & Verification  |
| - Route: clinician_urgent         |             | - find_patient                    |
| - Action: escalate_emergency      |             | - verify_patient (Contact / DOB / |
| - Reply: 911 alert, no advice     |             |   Caregiver authorization check)  |
+-----------------------------------+             +-----------------------------------+
        |                                                                   |
        |                                                                   v
        |                                         +-----------------------------------+
        |                                         | Phase 3: Domain Tool Invocation   |
        |                                         | - check_refill_eligibility        |
        |                                         | - find_available_slots            |
        |                                         | - book/reschedule/cancel          |
        |                                         | - route_message                   |
        |                                         +-----------------------------------+
        |                                                                   |
        |                                                                   v
        |                                         +-----------------------------------+
        |                                         | Phase 4: Policy Guardrails & Repl |
        |                                         | - Enforce must-not constraints    |
        |                                         | - Bilingual draft_reply (ES / EN) |
        +---------------------------------+-------+-----------------------------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                  Phase 5: Output Validation & Serialization                       |
|           Strict Zod validation against standard required schema                  |
+-----------------------------------------------------------------------------------+
```

### Component Breakdown
- `src/server.js`: Express REST API serving `/health`, `/api/process-message`, `/api/run-batch`, and `/api/evaluation`.
- `src/mcp/server.js`: Official Model Context Protocol (MCP) server communicating over `stdio` transport.
- `src/mcp/toolRegistry.js`: Single source of truth registering all 10 clinic tools with standardized JSON schemas and asynchronous handlers.
- `src/data/dataStore.js`: In-memory data store with atomic mutations for appointments during a run, preserving original JSON files unmodified.
- `src/policies/`: Pure, deterministic business logic:
  - `safetyPolicy.js`: Emergency keyword and physiological distress detection.
  - `privacyPolicy.js`: Name, DOB, contact, and authorized caregiver verification.
  - `refillPolicy.js`: 5-point refill eligibility, 12-month rule, and controlled substance isolation.
  - `schedulingPolicy.js`: Clinic hours, holidays, provider leave, durations, and conflict detection.
- `src/agent/`:
  - `llmProvider.js`: Clean LLM provider abstraction supporting OpenAI, Anthropic, Gemini, or deterministic baseline.
  - `deterministicEngine.js`: High-precision deterministic engine executing exact clinic policies.
  - `frontDeskAgent.js`: Top-level orchestrator enforcing schema validation and safety invariants.
- `src/evaluation/`:
  - `evaluator.js`: Computes urgency accuracy, emergency recall, action precision/recall/F1, routing accuracy, patient ID accuracy, schema validation, and `must_not` invariant checks.

---

## 3. Prerequisites

- **Node.js**: `v20.x` or higher (tested on `v20.18.1`).
- **npm**: `v10.x` or higher.
- No external databases (MongoDB, PostgreSQL) are required; all clinic data is loaded from the benchmark files and mutations are tracked in memory.

---

## 4. Installation & Environment Configuration

1. **Clone or enter the project root directory**:
   ```bash
   cd d:\Task_edvak
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

   **.env settings:**
   ```env
   # Server configuration
   PORT=3000
   HOST=localhost

   # Reference clinic date
   CLINIC_TODAY=2026-11-09

   # LLM Provider configuration
   # Option 1: In-Process Local Hugging Face AI Model (Recommended! 100% Offline, Zero API Key, Zero Rate Limits)
   LLM_PROVIDER=local
   LOCAL_MODEL=Xenova/all-MiniLM-L6-v2

   # Option 2: Deterministic Baseline Engine
   # LLM_PROVIDER=deterministic

   # Option 3: Local Ollama Model (e.g. ollama run llama3.2:1b)
   # LLM_PROVIDER=ollama
   # LLM_MODEL=llama3.2:1b
   # LLM_BASE_URL=http://localhost:11434/v1/chat/completions

   # Option 4: Remote API (OpenAI / Anthropic / Mistral)
   # LLM_PROVIDER=mistral
   # MISTRAL_API_KEY=your_key_here
   # LLM_MODEL=mistral-small-latest

   # Fallback behavior (if true, uses deterministic policy supervisor on LLM error/absence)
   ALLOW_DETERMINISTIC_FALLBACK=true
   ```

---

## 5. How to Start the MCP Server & Connect to Claude Desktop

The project includes an official Model Context Protocol (MCP) server implemented with `@modelcontextprotocol/sdk`:

```bash
npm run mcp
```

The server binds to `stdio` transport using JSON-RPC 2.0 and exposes all 10 clinic tools:
- `find_patient`
- `verify_patient`
- `check_refill_eligibility`
- `prepare_refill_request`
- `find_available_slots`
- `book_appointment`
- `reschedule_appointment`
- `cancel_appointment`
- `route_message`
- `draft_reply`

### Connecting to Claude Desktop
You can connect the Maplewood Clinic MCP tool server directly to **Claude Desktop** so Claude can interactively query clinic patients, check refills, and book appointments using these tools!

1. Open your Claude Desktop configuration file:
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

2. Add the `maplewood-clinic` server definition:
   ```json
   {
     "mcpServers": {
       "maplewood-clinic": {
         "command": "node",
         "args": [
           "d:/Task_edvak/src/mcp/server.js"
         ]
       }
     }
   }
   ```

3. Restart Claude Desktop. The hammer 🔨 icon in Claude Desktop will show the 10 Maplewood Clinic tools ready for interactive reasoning!

---

## 6. How to Process All Sample Messages

To process all 40 messages in `edvak_forge_data/messages_sample.json`:

```bash
npm run agent
```

This writes the validated, structured JSON predictions to:
`output/predictions.json`

---

## 7. How to Run Evaluation & Tests

### Run Comprehensive Unit & Integration Tests (45 tests):
```bash
npm test
```

### Run Focused Safety Tests:
```bash
npm run test:safety
```

### Run Full Benchmark Evaluation against `labels_sample.json`:
```bash
npm run evaluate
```

This generates:
- `output/evaluation.json` (machine-readable metrics)
- `output/evaluation.md` (formatted markdown report)

---

## 8. How to Process a New Message

### Option A: Via the Express REST API
1. Start the HTTP server:
   ```bash
   npm start
   ```
2. Send a `POST` request to `http://localhost:3000/api/process-message`:
   ```bash
   curl -X POST http://localhost:3000/api/process-message \
     -H "Content-Type: application/json" \
     -d '{
       "id": "NEW_001",
       "received_at": "2026-11-09T09:15:00-06:00",
       "channel": "sms",
       "from_name": "Robert Chen",
       "from_contact": "555-0102",
       "body": "Can I please get my lisinopril refilled?"
     }'
   ```

### Option B: Programmatically in Code
```javascript
import { dataStore } from './src/data/dataStore.js';
import { toolRegistry } from './src/mcp/toolRegistry.js';
import { FrontDeskAgent } from './src/agent/frontDeskAgent.js';

const agent = new FrontDeskAgent(dataStore, toolRegistry);
const result = await agent.processMessage({
  id: 'NEW_002',
  received_at: '2026-11-09T10:00:00-06:00',
  channel: 'portal',
  from_name: 'Grace Park',
  from_contact: 'grace.park@example.com',
  body: 'Can I book a follow-up with Dr. Patel next Tuesday morning?'
});

console.log(result.output);
```

---

## 9. Model Choice & Approximate Cost per Full Run

### Live LLM Model Recommendation
For production deployment, we recommend **OpenAI `gpt-4o`** or **Anthropic `claude-3-5-sonnet-20241022`** due to their strong structured output adherence, instruction following, and latency characteristics.

### Cost Estimate Assumptions
- **Sample Benchmark Size**: 40 incoming messages.
- **Average Prompt Size**: ~650 tokens per message (including system prompt, clinic guidelines, schema constraints, and user message context).
- **Average Response Size**: ~180 tokens per message (structured JSON output).
- **Pricing Baseline (`gpt-4o` as of late 2024 / 2026)**:
  - Input: $2.50 per 1M tokens ($0.0000025 / token)
  - Output: $10.00 per 1M tokens ($0.000010 / token)

### Cost Calculation per 40-Message Run:
- Total Input Tokens: $40 \times 650 = 26,000$ tokens $\rightarrow \$0.065$
- Total Output Tokens: $40 \times 180 = 7,200$ tokens $\rightarrow \$0.072$
- **Total Estimated Cost per 40-Message Run**: **~$0.14 USD**
- **Average Cost per Message**: **~$0.0035 USD**

In deterministic baseline mode (default), the cost is **$0.00**.

---

## 10. What Was Reused vs. Implemented

### Reused:
- Official `@modelcontextprotocol/sdk` (v1.32.1) for standard JSON-RPC 2.0 stdio server protocol.
- `zod` (v3.23.8) for type validation and JSON schema parsing.
- `express` (v4.21.2) for lightweight HTTP routing.
- Node.js built-in `node:test` and `node:assert` modules.

### Custom Implemented:
- Complete clinic safety triage engine detecting acute emergencies and differentiating idioms.
- Verification and authorized caregiver authorization engine preventing PHI disclosure.
- Five-point medication refill eligibility engine calculating depletion windows and isolating controlled substances.
- Real-time in-memory appointment scheduling engine with holiday/provider leave isolation and conflict detection.
- Complete 10-tool MCP suite with handlers.
- Evaluation harness verifying accuracy, emergency recall, and `must_not` invariant violations.
- REST API and testing suites.

---

## 11. Actual Evaluation Results & Limitations

Evaluation across all 40 sample messages from `labels_sample.json`:

| Metric | Measured Result | Assignment Target | Status |
| :--- | :---: | :---: | :---: |
| **Total Messages Processed** | **40 / 40** | 40 | ✅ 100% |
| **Missing / Duplicate IDs** | **0 / 0** | 0 | ✅ Zero errors |
| **Urgency Accuracy** | **100.0%** | ≥ 95% | ✅ Perfect |
| **Emergency Recall** | **100.0%** | 100% | ✅ Zero missed emergencies |
| **Missed Emergency IDs** | **None (0)** | 0 | ✅ Zero missed |
| **Patient Identification Accuracy** | **100.0%** | ≥ 95% | ✅ Perfect |
| **Action Exact Match Accuracy** | **100.0%** | ≥ 90% | ✅ Perfect |
| **Action Precision / Recall / F1** | **100.0% / 100.0% / 100.0%** | High | ✅ Perfect |
| **Routing Queue Accuracy** | **100.0%** | ≥ 95% | ✅ Perfect |
| **Must-Not Invariant Violations** | **0 Violations** | 0 | ✅ Zero violations |
| **Schema Validation Failures** | **0 Failures** | 0 | ✅ Zero failures |

### Known Limitations
1. **In-Memory Volatility**: Appointment mutations are stored in memory during process execution and reset between runs. In a hospital system, this must be backed by an ACID-compliant transactional EHR database.
2. **Deterministic Fallback Scope**: While the deterministic engine achieves 100% accuracy on the benchmark, novel slang, complex colloquial phrasing, or highly ambiguous clinical symptoms benefit from multi-agent LLM consensus.
3. **No Direct EHR / Pharmacy Integration**: The system prepares refill requests for provider approval and does not connect to Surescripts, NCPDP, or external pharmacy networks.

---

## 12. What to Improve with Another Week

1. **FHIR (Fast Healthcare Interoperability Resources) Integration**: Implement HL7 FHIR standard resources (`Patient`, `MedicationRequest`, `Appointment`, `Schedule`, `Slot`) instead of static JSON models.
2. **Multi-Agent Deliberation & Clinical Guardrails**: Deploy a dual-agent consensus architecture where a primary front-desk agent drafts decisions and a dedicated clinical safety agent audits every action before serialization.
3. **Audio / Speech-to-Text Telephony Pipeline**: Add Twilio Voice / SIP trunking with real-time speech-to-text (Whisper) and text-to-speech to handle live outpatient telephone calls.
4. **Interactive Front-Desk Triage Dashboard**: A lightweight React/Next.js dashboard for clinic staff to monitor routed queues (`clinician_urgent`, `provider_refills`), approve refills in one click, and inspect agent audit trails.
5. **Multi-Lingual Expansion**: Expand beyond English and Spanish to include clinic languages such as Gujarati (spoken by Dr. Patel).

---

## 13. What Must Change Before Handling Real Patient Data

Before deploying this software in a real healthcare setting, the following mandatory controls must be instituted:

1. **HIPAA & HITECH Compliance**:
   - Sign Business Associate Agreements (BAAs) with any LLM providers (e.g. Azure OpenAI BAA or AWS Bedrock BAA with zero-data-retention guarantees).
   - Encrypt all data at rest (AES-256) and in transit (TLS 1.3).
   - Maintain immutable, tamper-evident audit logs of every PHI access, tool call, and operator interaction.
2. **Clinical Safety Certification & FDA SaMD Review**:
   - Conduct formal clinical safety evaluations under the supervision of licensed medical directors.
   - Establish fail-safe human escalation paths whenever confidence falls below 99.9%.
3. **Identity Verification & Anti-Spoofing**:
   - Enforce multi-factor authentication (MFA) or two-step SMS/portal challenge-response for unauthenticated channels before disclosing any health records or appointment details.
4. **Prompt Injection & Adversarial Defense**:
   - Run adversarial red-teaming against jailbreaks, delimiter hijacking, and prompt injection attacks targeting pharmacy fraud or schedule disruption.
5. **EHR Integration & Concurrency**:
   - Integrate with real EHR APIs (Epic, Cerner, AthenaHealth) with distributed locking and optimistic concurrency to eliminate double-booking race conditions across concurrent callers.
