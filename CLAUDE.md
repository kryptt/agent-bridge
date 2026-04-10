# CLAUDE.md

## Overview

Agent Bridge — npm workspace monorepo with 3 packages for inter-agent communication over MQTT.

## Structure

```
packages/
  agent-bus/        # @kryptt/agent-bus — shared protocol library
  mcp-server/       # @kryptt/mcp-server — Claude Code MCP adapter
  openclaw-plugin/  # @kryptt/openclaw-plugin — OpenClaw plugin adapter
```

## Commands

```bash
# From repo root:
npm install                   # install all workspace deps
npm run build                 # build all packages (tsc -b)
npm test                      # test all packages
npm run typecheck             # type-check all packages

# Per-package:
cd packages/agent-bus && npx vitest run     # run shared lib tests
cd packages/mcp-server && npx tsc --noEmit  # type-check MCP server
cd packages/openclaw-plugin && npx tsc --noEmit  # type-check plugin
```

## Package Dependencies

- `@kryptt/mcp-server` depends on `@kryptt/agent-bus` + `@modelcontextprotocol/sdk`
- `@kryptt/openclaw-plugin` depends on `@kryptt/agent-bus` + `effect`
- `@kryptt/agent-bus` depends on `mqtt` + `zod`

## Key Design Decisions

- **Single MQTT topic**: All messages go through `openclaw/agents/bus`. Filtering is done in-process.
- **Heartbeat TTL**: 15 minutes. Agents are considered offline after this.
- **Config is injectable**: `agent-bus` accepts config objects, not env vars directly. Each adapter reads its own env vars.
- **No shared MQTT connection**: Each adapter manages its own MQTT connection. The `agent-bus` package provides one for the MCP server; the OpenClaw plugin uses its own Effect-based MQTT client.
- **Tests live in agent-bus**: All protocol tests are in the shared library. Adapters have no standalone tests — they're thin wrappers.

## Message Protocol

Single topic: `openclaw/agents/bus`, QoS 1.

Types: `message`, `task`, `presence`, `event`, `heartbeat`.

All messages have: `id` (UUID), `ts` (ISO 8601), `from`, `to`, `replyTo?`, `conversationId?`.

Addressing: agent name (`"claude"`, `"roci"`), user routing (`"user:rodolfo"`), or broadcast (`"*"`).

## Adding a New Agent Adapter

1. Create `packages/your-adapter/`
2. Depend on `@kryptt/agent-bus`
3. Import types, schemas, and either use the provided `mqttClient` or bring your own MQTT connection
4. Send heartbeats on connect and every 15 min
5. Include `conversationId` when threading messages
