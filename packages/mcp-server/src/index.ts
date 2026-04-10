#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { mqttClient, heartbeat, inbox, type AgentBusMessage } from '@kryptt/agent-bus'
import { registerTools } from './tools.js'

// ── Configuration (env vars with defaults) ──────────────────────────────

const AGENT_NAME = process.env.AGENT_NAME ?? 'claude'
const MQTT_URL = process.env.MQTT_URL ?? 'mqtt://mqtt.hr-home.xyz:1883'
const MQTT_USER = process.env.MQTT_USER ?? ''
const MQTT_PASS = process.env.MQTT_PASS ?? ''
const AGENT_TYPE = process.env.AGENT_TYPE ?? 'claudecode'
const AGENT_PURPOSE = process.env.AGENT_PURPOSE ?? 'general-purpose software engineering assistant'
const AGENT_CAPABILITIES = (process.env.AGENT_CAPABILITIES ?? '').split(',').filter(Boolean)
const AGENT_ID = crypto.randomUUID()

// ── Channel notification formatting ─────────────────────────────────────

function formatChannelContent (msg: AgentBusMessage): string {
  switch (msg.type) {
    case 'task':
      return `[task from=${msg.from} skill=${msg.skill}] ${msg.prompt}`
    case 'message':
      return `[message from=${msg.from}] ${msg.body}`
    case 'presence':
      return `[presence] ${msg.from} interacted with ${msg.user} via ${msg.channel}`
    case 'event':
      return `[event from=${msg.from} status=${msg.status}] ${msg.summary}`
    case 'heartbeat':
      return `[heartbeat from=${msg.from} type=${msg.agentType}] ${msg.agentPurpose}`
  }
}

function formatChannelMeta (msg: AgentBusMessage): Record<string, string> {
  const meta: Record<string, string> = {
    id: msg.id, type: msg.type, from: msg.from, to: msg.to, ts: msg.ts
  }
  if (msg.replyTo) meta.reply_to = msg.replyTo
  if (msg.conversationId) meta.conversation_id = msg.conversationId
  if (msg.type === 'task') meta.skill = msg.skill
  if (msg.type === 'presence') { meta.user = msg.user; meta.channel = msg.channel }
  if (msg.type === 'event') meta.status = msg.status
  if (msg.type === 'heartbeat') { meta.agent_id = msg.agentId; meta.agent_type = msg.agentType }
  return meta
}

// ── Main ────────────────────────────────────────────────────────────────

async function main (): Promise<void> {
  const server = new Server(
    { name: 'agent-bridge', version: '0.3.0' },
    {
      capabilities: {
        experimental: { 'claude/channel': {} },
        tools: {}
      },
      instructions:
        `Agent Bridge — connects this Claude Code session to the shared agent bus (openclaw/agents/bus).\n` +
        `Your agent name is "${AGENT_NAME}". Messages from other agents (like Roci) arrive as <channel> events.\n\n` +
        `Inbound events appear as <channel source="agent-bridge" type="..." from="..." ...>content</channel>.\n` +
        `Use the agent_send tool to send messages back. Use agent_events to read buffered history.\n\n` +
        `Message types: task (skill requests), message (text), presence (user interaction heartbeat), event (lifecycle), heartbeat (agent identification).\n` +
        `Addressing: "roci" for OpenClaw agent, "user:<name>" for humans, "*" for broadcast.\n\n` +
        `Use agent_roster to discover who's online. Use agent_inbox for pull-based message retrieval.\n` +
        `Messages support conversationId to group related exchanges into threads.`
    }
  )

  registerTools(server, AGENT_NAME)

  // Connect MQTT
  console.error('[agent-bridge] Connecting to MQTT...')
  await mqttClient.connect({
    url: MQTT_URL,
    user: MQTT_USER || undefined,
    pass: MQTT_PASS || undefined,
    clientId: `agent-bridge-${crypto.randomUUID().slice(0, 8)}`,
    agentName: AGENT_NAME
  })

  // Initialize inbox
  inbox.init(AGENT_NAME)

  // Start heartbeat
  heartbeat.start({
    agentName: AGENT_NAME,
    agentId: AGENT_ID,
    agentType: AGENT_TYPE,
    agentPurpose: AGENT_PURPOSE,
    agentCapabilities: AGENT_CAPABILITIES
  })
  console.error('[agent-bridge] Heartbeat started (15 min interval)')

  // Push inbound messages to Claude Code as channel notifications
  mqttClient.setMessageHandler((msg) => {
    server.notification({
      method: 'notifications/claude/channel',
      params: { content: formatChannelContent(msg), meta: formatChannelMeta(msg) }
    }).catch((err) => {
      console.error('[agent-bridge] Failed to push notification:', err)
    })
  })

  // Connect stdio transport
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`[agent-bridge] Channel ready (agent: ${AGENT_NAME})`)
}

main().catch((err) => {
  console.error('[agent-bridge] Fatal error:', err)
  process.exit(1)
})
