import * as mqttClient from './mqtt-client.js'
import { makeBusMessage, HEARTBEAT_TTL_MS, type HeartbeatMessage, type AgentBusMessage } from './types.js'

export interface HeartbeatConfig {
  agentName: string
  agentId: string
  agentType: string
  agentPurpose: string
  agentCapabilities: string[]
}

let timer: ReturnType<typeof setInterval> | null = null
let config: HeartbeatConfig | null = null
let activeHuman: { id: string, lastInteraction: string } | undefined

/** Call when a human interacts with the agent */
export function touchHuman (humanId: string): void {
  activeHuman = { id: humanId, lastInteraction: new Date().toISOString() }
}

export function buildHeartbeat (): HeartbeatMessage {
  if (!config) throw new Error('Heartbeat not configured — call start() first')
  return makeBusMessage('heartbeat', config.agentName, '*', {
    agentId: config.agentId,
    agentType: config.agentType,
    agentPurpose: config.agentPurpose,
    agentCapabilities: config.agentCapabilities,
    ...(activeHuman ? { activeHuman } : {})
  })
}

async function sendHeartbeat (): Promise<void> {
  if (!mqttClient.isConnected()) return
  try {
    await mqttClient.publish(buildHeartbeat())
  } catch (err) {
    console.error('[agent-bus] Failed to send heartbeat:', err)
  }
}

/** Start the heartbeat timer. Sends immediately, then every 15 min. */
export function start (cfg: HeartbeatConfig): void {
  if (timer) return
  config = cfg
  sendHeartbeat()
  timer = setInterval(sendHeartbeat, HEARTBEAT_TTL_MS)
}

export function stop (): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

// ── Roster: track other agents from their heartbeats ────────────────────

export interface RosterEntry {
  agentName: string
  agentId: string
  agentType: string
  agentPurpose: string
  agentCapabilities: string[]
  activeHuman?: { id: string, lastInteraction: string }
  lastSeen: string
  online: boolean
}

const roster = new Map<string, RosterEntry>()

/** Process an inbound heartbeat and update the roster */
export function ingestHeartbeat (msg: AgentBusMessage): void {
  if (msg.type !== 'heartbeat') return
  roster.set(msg.from, {
    agentName: msg.from,
    agentId: msg.agentId,
    agentType: msg.agentType,
    agentPurpose: msg.agentPurpose,
    agentCapabilities: msg.agentCapabilities,
    activeHuman: msg.activeHuman,
    lastSeen: msg.ts,
    online: true
  })
}

/** Get the current roster, marking stale entries as offline */
export function getRoster (includeOffline: boolean = false): RosterEntry[] {
  const now = Date.now()
  const entries: RosterEntry[] = []

  for (const entry of roster.values()) {
    const age = now - new Date(entry.lastSeen).getTime()
    const online = age < HEARTBEAT_TTL_MS
    if (online || includeOffline) {
      entries.push({ ...entry, online })
    }
  }

  return entries.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
}

/** Resolve which agent a human is currently using (most recent heartbeat wins) */
export function resolveHumanSeat (humanId: string): RosterEntry | undefined {
  let best: RosterEntry | undefined
  const now = Date.now()

  for (const entry of roster.values()) {
    if (!entry.activeHuman || entry.activeHuman.id !== humanId) continue
    const age = now - new Date(entry.lastSeen).getTime()
    if (age >= HEARTBEAT_TTL_MS) continue
    if (!best || entry.activeHuman.lastInteraction > best.activeHuman!.lastInteraction) {
      best = entry
    }
  }

  return best
}
