import { type Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  mqttClient, heartbeat, inbox,
  makeBusMessage,
  agentSendSchema, agentEventsSchema, agentRosterSchema, agentInboxSchema, validate,
  type AgentBusMessage, type AgentSendArgs, type AgentEventsArgs, type AgentRosterArgs, type AgentInboxArgs
} from '@kryptt/agent-bus'

/** Pick only the defined optional fields from validated send args */
function pickOptional (args: AgentSendArgs): Partial<Pick<AgentSendArgs, 'replyTo' | 'conversationId'>> {
  const opt: Record<string, unknown> = {}
  if (args.replyTo != null) opt.replyTo = args.replyTo
  if (args.conversationId != null) opt.conversationId = args.conversationId
  return opt
}

export function registerTools (server: Server, agentName: string): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'agent_send',
        description: 'Send a typed message on the shared agent bus (openclaw/agents/bus).\n\n' +
          'Message types:\n' +
          '  message  — text to another agent or user\n' +
          '  task     — request an agent to execute a skill\n' +
          '  presence — announce interaction with a human\n\n' +
          'Addressing:\n' +
          '  to: "roci"          — direct to Roci (OpenClaw agent)\n' +
          '  to: "claude"        — direct to self / another Claude session\n' +
          '  to: "user:rodolfo"  — route to human via most-recent agent\n' +
          '  to: "*"             — broadcast to all agents',
        inputSchema: {
          type: 'object' as const,
          properties: {
            type: { type: 'string', enum: ['message', 'task', 'presence'], description: 'Message type' },
            to: { type: 'string', description: 'Recipient: agent name, "user:<canonical-id>", or "*"' },
            body: { type: 'string', description: 'Text content (type: message)' },
            skill: { type: 'string', description: 'Skill to invoke (type: task)' },
            prompt: { type: 'string', description: 'Task prompt (type: task)' },
            user: { type: 'string', description: 'Human canonical id (type: presence)' },
            channel: { type: 'string', description: 'Channel name (type: presence)' },
            replyTo: { type: 'string', description: 'Message id being replied to' },
            conversationId: { type: 'string', description: 'Groups related messages into a logical thread' }
          },
          required: ['type', 'to']
        }
      },
      {
        name: 'agent_events',
        description: 'Read recent messages from the agent bus. Buffered in memory (last 1000). ' +
          'Use type_filter to narrow by message type, or from_filter to see messages from a specific agent.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            type_filter: { type: 'string', enum: ['task', 'message', 'presence', 'event', 'heartbeat'], description: 'Filter by message type' },
            from_filter: { type: 'string', description: 'Filter by sender agent name' },
            id: { type: 'string', description: 'Find a specific message by id' },
            limit: { type: 'number', minimum: 1, maximum: 100, description: 'Max results (default 20)' },
            since_minutes: { type: 'number', minimum: 1, description: 'Only messages from last N minutes' },
            conversation_id: { type: 'string', description: 'Filter by conversation thread' }
          }
        }
      },
      {
        name: 'agent_roster',
        description: 'Query known agents on the bus. Built from heartbeat messages (15 min TTL). ' +
          'Shows each agent\'s type, purpose, capabilities, and which human they\'re serving. ' +
          'Use to discover who\'s online and resolve which "seat" a human occupies.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            agent_name: { type: 'string', description: 'Filter to a specific agent' },
            include_offline: { type: 'boolean', description: 'Include agents whose heartbeat has expired (default false)' }
          }
        }
      },
      {
        name: 'agent_inbox',
        description: 'Pull mode inbox for agents that cannot receive push notifications. ' +
          'Returns messages addressed to this agent (or broadcast) since the last check. ' +
          'Maintains a watermark so each call returns only new messages. ' +
          'Suggests a next poll interval based on traffic volume (1-10 min). ' +
          'Agents should poll no less than every 1 min and no more than every 15 min.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            limit: { type: 'number', minimum: 1, maximum: 100, description: 'Max messages to return (default 50)' }
          }
        }
      },
      {
        name: 'agent_status',
        description: 'Check agent bus health: MQTT connection, buffer size, online agents.',
        inputSchema: { type: 'object' as const, properties: {} }
      }
    ]
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params
    switch (name) {
      case 'agent_send': return handleAgentSend(args ?? {}, agentName)
      case 'agent_events': return handleAgentEvents(args ?? {})
      case 'agent_roster': return handleAgentRoster(args ?? {})
      case 'agent_inbox': return handleAgentInbox(args ?? {})
      case 'agent_status': return handleAgentStatus(agentName)
      default: return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }] }
    }
  })
}

async function handleAgentSend (rawArgs: Record<string, unknown>, agentName: string): Promise<any> {
  if (!mqttClient.isConnected()) {
    return { content: [{ type: 'text', text: 'Error: MQTT not connected.' }], isError: true }
  }

  const parsed = validate(agentSendSchema, rawArgs)
  if (!parsed.ok) {
    return { content: [{ type: 'text', text: `Validation error: ${parsed.error}` }], isError: true }
  }
  const args: AgentSendArgs = parsed.value

  try {
    const opt = pickOptional(args)

    let msg: AgentBusMessage
    switch (args.type) {
      case 'message':
        msg = makeBusMessage('message', agentName, args.to, { body: args.body, ...opt })
        break
      case 'task':
        msg = makeBusMessage('task', agentName, args.to, { skill: args.skill, prompt: args.prompt, ...opt })
        break
      case 'presence':
        msg = makeBusMessage('presence', agentName, '*', { user: args.user, channel: args.channel, ...opt })
        break
    }

    await mqttClient.publish(msg)
    return { content: [{ type: 'text', text: JSON.stringify({ sent: msg.type, to: msg.to, id: msg.id }, null, 2) }] }
  } catch (err) {
    return { content: [{ type: 'text', text: `Send failed: ${err}` }], isError: true }
  }
}

async function handleAgentEvents (rawArgs: Record<string, unknown>): Promise<any> {
  const parsed = validate(agentEventsSchema, rawArgs)
  if (!parsed.ok) {
    return { content: [{ type: 'text', text: `Validation error: ${parsed.error}` }], isError: true }
  }
  const args: AgentEventsArgs = parsed.value

  let messages = mqttClient.getBuffer().toArray()

  if (args.type_filter) messages = messages.filter((m) => m.type === args.type_filter)
  if (args.from_filter) messages = messages.filter((m) => m.from === args.from_filter)
  if (args.id) messages = messages.filter((m) => m.id === args.id)
  if (args.since_minutes) {
    const cutoff = new Date(Date.now() - args.since_minutes * 60_000).toISOString()
    messages = messages.filter((m) => m.ts >= cutoff)
  }
  if (args.conversation_id) messages = messages.filter((m) => m.conversationId === args.conversation_id)

  const result = messages.reverse().slice(0, args.limit ?? 20)

  if (result.length === 0) {
    const status = mqttClient.isConnected() ? 'connected' : 'disconnected'
    return { content: [{ type: 'text', text: `No messages found. MQTT: ${status}, buffer: ${mqttClient.getBuffer().size}` }] }
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
}

async function handleAgentInbox (rawArgs: Record<string, unknown>): Promise<any> {
  const parsed = validate(agentInboxSchema, rawArgs)
  if (!parsed.ok) {
    return { content: [{ type: 'text', text: `Validation error: ${parsed.error}` }], isError: true }
  }
  const args: AgentInboxArgs = parsed.value

  const result = inbox.pullInbox(args.limit ?? 50)

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        count: result.messages.length,
        nextPollMinutes: result.nextPollMinutes,
        watermark: result.watermark,
        messages: result.messages
      }, null, 2)
    }]
  }
}

async function handleAgentRoster (rawArgs: Record<string, unknown>): Promise<any> {
  const parsed = validate(agentRosterSchema, rawArgs)
  if (!parsed.ok) {
    return { content: [{ type: 'text', text: `Validation error: ${parsed.error}` }], isError: true }
  }
  const args: AgentRosterArgs = parsed.value

  let entries = heartbeat.getRoster(args.include_offline ?? false)
  if (args.agent_name) entries = entries.filter((e) => e.agentName === args.agent_name)

  const humanSeats = new Map<string, string>()
  for (const entry of entries) {
    if (entry.activeHuman && entry.online && !humanSeats.has(entry.activeHuman.id)) {
      const seat = heartbeat.resolveHumanSeat(entry.activeHuman.id)
      if (seat) humanSeats.set(entry.activeHuman.id, seat.agentName)
    }
  }

  const result = { agents: entries, humanSeats: Object.fromEntries(humanSeats) }

  if (entries.length === 0) {
    return { content: [{ type: 'text', text: 'No agents found. Heartbeats may not have been received yet.' }] }
  }

  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
}

async function handleAgentStatus (agentName: string): Promise<any> {
  const roster = heartbeat.getRoster(false)

  const status = {
    mqtt_connected: mqttClient.isConnected(),
    agent_name: agentName,
    buffer_size: mqttClient.getBuffer().size,
    buffer_capacity: mqttClient.getBuffer().capacity,
    last_message_at: mqttClient.lastMessageAt(),
    online_agents: roster.map((e) => ({
      name: e.agentName, type: e.agentType,
      purpose: e.agentPurpose, activeHuman: e.activeHuman?.id
    }))
  }

  return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] }
}
