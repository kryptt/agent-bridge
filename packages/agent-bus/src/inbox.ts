import * as mqttClient from './mqtt-client.js'
import { HEARTBEAT_TTL_MS, type AgentBusMessage } from './types.js'

const MIN_POLL_MS = 60_000      // 1 minute
const MAX_POLL_MS = HEARTBEAT_TTL_MS // 15 minutes

let lastCheckTs: string | null = null
let inboxAgentName: string = ''

/** Initialize inbox with the agent's name */
export function init (agentName: string): void {
  inboxAgentName = agentName
}

/** Validate a poll interval in minutes, clamping to [1, 15] */
export function clampPollMinutes (minutes: number): number {
  const ms = minutes * 60_000
  return Math.max(MIN_POLL_MS, Math.min(MAX_POLL_MS, ms)) / 60_000
}

/**
 * Pull inbox: returns messages addressed to this agent or broadcast since last check.
 * Filters out heartbeats and own messages.
 * Updates the watermark so the next call only returns new messages.
 */
export function pullInbox (limit: number = 50): { messages: AgentBusMessage[], nextPollMinutes: number, watermark: string } {
  const cutoff = lastCheckTs ?? new Date(0).toISOString()
  const now = new Date().toISOString()

  const messages = mqttClient.getBuffer()
    .filter((m) =>
      m.ts > cutoff &&
      m.from !== inboxAgentName &&
      m.type !== 'heartbeat' &&
      (m.to === inboxAgentName || m.to === '*')
    )
    .reverse()
    .slice(0, limit)

  lastCheckTs = now

  const suggestedMinutes = messages.length > 10 ? 1 : messages.length > 0 ? 5 : 10

  return {
    messages,
    nextPollMinutes: suggestedMinutes,
    watermark: now
  }
}

/** Reset watermark (e.g., on reconnect) */
export function resetWatermark (): void {
  lastCheckTs = null
}
