import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { toolRegistry } from './toolRegistry.js';

export function createMcpServer() {
  const server = new Server(
    {
      name: 'maplewood-clinic-mcp-server',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Handle tools list request
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolRegistry.getToolDefinitions()
    };
  });

  // Handle tool execution request
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await toolRegistry.executeTool(name, args || {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error executing tool "${name}": ${err.message}`
          }
        ]
      };
    }
  });

  return server;
}

export async function runMcpServer() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Maplewood Clinic MCP Server connected to stdio transport.');
}

// Direct invocation check
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  runMcpServer().catch(err => {
    console.error('MCP server failed:', err);
    process.exit(1);
  });
}
