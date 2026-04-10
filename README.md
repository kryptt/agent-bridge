# Agent Bridge

A shared agent bus for inter-agent communication over MQTT. Enables AI agents (Claude Code, OpenClaw, etc.) to discover each other, exchange messages, delegate tasks, and track presence — all through a single MQTT topic.

## Architecture

```
┌──────────────────────┐     ┌──────────────────────┐
│  @kryptt/mcp-server  │     │ @kryptt/openclaw-     │
│  (Claude Code)       │     │  plugin (Roci)        │
│                      │     │                       │
│  MCP tools:          │     │  OpenClaw tools:      │
│  - agent_send        │     │  - agent_comms        │
│  - agent_events      │     │                       │
│  - agent_roster      │     │  Hooks:               │
│  - agent_inbox       │     │  - before_prompt_build│
│  - agent_status      │     │  - agent_end          │
└──────────┬───────────┘     └──────────┬────────────┘
           │                            │
           └──────────┬─────────────────┘
                      │
           ┌──────────▼───────────┐
           │  @kryptt/agent-bus   │
           │  (shared library)    │
           │                     │
           │  - Message types    │
           │  - MQTT client      │
           │  - Ring buffer      │
           │  - Heartbeat/roster │
           │  - Inbox (pull)     │
           │  - Zod schemas      │
           └──────────┬──────────┘
                      │ MQTT (QoS 1)
           ┌──────────▼──────────┐
           │   MQTT Broker       │
           │   openclaw/agents/  │
           │   bus               │
           └─────────────────────┘
```

## Packages

### `@kryptt/agent-bus`

Shared library — the agent bus protocol. Message types, MQTT client, ring buffer, heartbeat/roster system, pull-mode inbox, and zod validation schemas.

### `@kryptt/mcp-server`

MCP server for Claude Code. Connects via stdio, exposes 5 tools (`agent_send`, `agent_events`, `agent_roster`, `agent_inbox`, `agent_status`), and pushes inbound messages as channel notifications.

### `@kryptt/openclaw-plugin`

OpenClaw plugin. Registers `agent_comms` tool and lifecycle hooks (`before_prompt_build`, `agent_end`). Dispatches inbound tasks to the OpenClaw gateway via WebSocket.

## Message Types

| Type | Purpose |
|------|---------|
| `message` | Free-form text between agents |
| `task` | Request an agent to execute a skill |
| `presence` | Announce interaction with a human on a channel |
| `event` | Lifecycle events (started, completed, error) |
| `heartbeat` | Agent identification — sent every 15 min |

All messages carry `id`, `ts`, `from`, `to`, and optional `replyTo` + `conversationId` fields.

## Agent Discovery

Agents broadcast a `heartbeat` every 15 minutes containing:

- `agentId` — stable session UUID
- `agentType` — `claudecode`, `openclaw`, etc.
- `agentPurpose` — what the agent does
- `agentCapabilities` — available skills/commands
- `activeHuman` — who is using this agent and when they last interacted

Agents not seen for 15 minutes are considered offline. Use `agent_roster` to query the live roster.

## Pull Mode

Agents that cannot subscribe to MQTT push (e.g., those behind MCP without channel support) can use `agent_inbox` for watermark-based polling. The tool returns only new messages since the last check and suggests a poll interval (1-10 min) based on traffic volume.

## Setup

### Claude Code (MCP Server)

Add to your `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-bridge": {
      "type": "stdio",
      "command": "node",
      "args": ["packages/mcp-server/dist/index.js"],
      "env": {
        "MQTT_URL": "mqtt://your-broker:1883",
        "MQTT_USER": "...",
        "MQTT_PASS": "...",
        "AGENT_NAME": "claude"
      }
    }
  }
}
```

### OpenClaw Plugin

Add to your OpenClaw configuration:

```json
{
  "openclaw": {
    "extensions": ["@kryptt/openclaw-plugin/src/index.ts"]
  }
}
```

## Environment Variables

| Variable | Default | Package | Description |
|----------|---------|---------|-------------|
| `MQTT_URL` | `mqtt://mqtt.hr-home.xyz:1883` | mcp-server | MQTT broker URL |
| `MQTT_USER` | — | both | MQTT username |
| `MQTT_PASS` | — | both | MQTT password |
| `AGENT_NAME` | `claude` / `roci` | both | This agent's name on the bus |
| `AGENT_TYPE` | `claudecode` / `openclaw` | both | Agent type identifier |
| `AGENT_PURPOSE` | varies | both | What this agent does |
| `AGENT_CAPABILITIES` | — | both | Comma-separated skill list |
| `OPENCLAW_GATEWAY_URL` | `http://localhost:18789` | openclaw-plugin | OpenClaw gateway |
| `OPENCLAW_GATEWAY_TOKEN` | — | openclaw-plugin | Gateway auth token |

## Development

```bash
npm install                  # install all workspace deps
npm run build                # build all packages
npm test                     # test all packages
npm run typecheck             # type-check all packages
```

## License

MIT
