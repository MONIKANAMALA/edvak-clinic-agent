import { createPatientTools } from '../tools/patientTools.js';
import { createRefillTools } from '../tools/refillTools.js';
import { createAppointmentTools } from '../tools/appointmentTools.js';
import { createRoutingTools } from '../tools/routingTools.js';
import { createReplyTools } from '../tools/replyTools.js';
import { dataStore } from '../data/dataStore.js';

export class ToolRegistry {
  constructor(store = dataStore) {
    this.store = store;
    this.tools = new Map();
    this.registerAll();
  }

  registerAll() {
    const patientTools = createPatientTools(this.store);
    const refillTools = createRefillTools(this.store);
    const appointmentTools = createAppointmentTools(this.store);
    const routingTools = createRoutingTools();
    const replyTools = createReplyTools();

    const all = {
      ...patientTools,
      ...refillTools,
      ...appointmentTools,
      ...routingTools,
      ...replyTools
    };

    for (const [name, def] of Object.entries(all)) {
      this.tools.set(name, def);
    }
  }

  getToolDefinitions() {
    const list = [];
    for (const [name, def] of this.tools.entries()) {
      list.push({
        name,
        description: def.description,
        inputSchema: {
          type: def.parameters.type || 'object',
          properties: def.parameters.properties || {},
          required: def.parameters.required || []
        }
      });
    }
    return list;
  }

  async executeTool(name, args = {}) {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" is not registered in the clinic MCP server.`);
    }
    return await tool.handler(args);
  }
}

export const toolRegistry = new ToolRegistry();
