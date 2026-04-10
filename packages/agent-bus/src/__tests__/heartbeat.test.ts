import { describe, it, expect } from 'vitest'
import { ingestHeartbeat, getRoster, resolveHumanSeat } from '../heartbeat.js'
import { makeBusMessage, HEARTBEAT_TTL_MS, type HeartbeatMessage } from '../types.js'

function makeHeartbeat (from: string, overrides: Partial<HeartbeatMessage> = {}): HeartbeatMessage {
  return makeBusMessage('heartbeat', from, '*', {
    agentId: overrides.agentId ?? crypto.randomUUID(),
    agentType: overrides.agentType ?? 'claudecode',
    agentPurpose: overrides.agentPurpose ?? 'testing',
    agentCapabilities: overrides.agentCapabilities ?? ['test'],
    ...(overrides.activeHuman ? { activeHuman: overrides.activeHuman } : {})
  })
}

describe('heartbeat roster', () => {
  it('ingests heartbeats and updates on newer data', () => {
    ingestHeartbeat(makeHeartbeat('test-agent-1', { agentPurpose: 'first' }))
    const found1 = getRoster(true).find((e) => e.agentName === 'test-agent-1')
    expect(found1).toBeDefined()
    expect(found1!.agentPurpose).toBe('first')
    expect(found1!.online).toBe(true)

    ingestHeartbeat(makeHeartbeat('test-agent-1', { agentPurpose: 'updated' }))
    const found2 = getRoster(true).find((e) => e.agentName === 'test-agent-1')
    expect(found2!.agentPurpose).toBe('updated')
  })

  it('marks agents as offline after TTL', () => {
    const hb = makeHeartbeat('test-agent-stale')
    ;(hb as any).ts = new Date(Date.now() - HEARTBEAT_TTL_MS - 1000).toISOString()
    ingestHeartbeat(hb)

    expect(getRoster(false).find((e) => e.agentName === 'test-agent-stale')).toBeUndefined()
    const stale = getRoster(true).find((e) => e.agentName === 'test-agent-stale')
    expect(stale).toBeDefined()
    expect(stale!.online).toBe(false)
  })

  it('tracks activeHuman in roster entries', () => {
    ingestHeartbeat(makeHeartbeat('test-agent-human', {
      activeHuman: { id: 'rodolfo', lastInteraction: new Date().toISOString() }
    }))
    const found = getRoster(true).find((e) => e.agentName === 'test-agent-human')
    expect(found!.activeHuman?.id).toBe('rodolfo')
  })
})

describe('resolveHumanSeat', () => {
  it('resolves human to the most recently interacted agent', () => {
    const now = new Date()
    ingestHeartbeat(makeHeartbeat('seat-agent-1', {
      activeHuman: { id: 'seat-test-user', lastInteraction: new Date(now.getTime() - 60_000).toISOString() }
    }))
    ingestHeartbeat(makeHeartbeat('seat-agent-2', {
      activeHuman: { id: 'seat-test-user', lastInteraction: now.toISOString() }
    }))

    const seat = resolveHumanSeat('seat-test-user')
    expect(seat?.agentName).toBe('seat-agent-2')
  })

  it('returns undefined for unknown human', () => {
    expect(resolveHumanSeat('nobody-here')).toBeUndefined()
  })
})
