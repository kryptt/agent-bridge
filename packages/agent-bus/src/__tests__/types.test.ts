import { describe, it, expect } from 'vitest'
import { RingBuffer } from '../ring-buffer.js'
import { makeBusMessage, BUS_TOPIC, type AgentBusMessage } from '../types.js'

describe('bus message filtering logic', () => {
  let buffer: RingBuffer<AgentBusMessage>

  function pushMessages (): void {
    buffer.push(makeBusMessage('event', 'roci', '*', { status: 'started', summary: 'Starting task' }))
    buffer.push(makeBusMessage('message', 'roci', 'claude', { body: 'Hello', conversationId: 'conv-1' }))
    buffer.push(makeBusMessage('task', 'claude', 'roci', { skill: 'home-auto', prompt: 'lights off', conversationId: 'conv-1' }))
    buffer.push(makeBusMessage('presence', 'roci', '*', { user: 'rodolfo', channel: 'telegram' }))
    buffer.push(makeBusMessage('event', 'roci', '*', { status: 'completed', summary: 'Done' }))
  }

  it('filters by type, from, and id', () => {
    buffer = new RingBuffer<AgentBusMessage>(100)
    pushMessages()
    expect(buffer.filter((m) => m.type === 'event')).toHaveLength(2)
    expect(buffer.filter((m) => m.from === 'claude')).toHaveLength(1)
    const target = buffer.toArray()[1]!
    expect(buffer.filter((m) => m.id === target.id)).toHaveLength(1)
  })

  it('filters by conversationId and combines filters', () => {
    buffer = new RingBuffer<AgentBusMessage>(100)
    pushMessages()
    expect(buffer.filter((m) => m.conversationId === 'conv-1')).toHaveLength(2)
    expect(buffer.filter((m) => m.type === 'event' && m.from === 'roci')).toHaveLength(2)
  })

  it('buffers heartbeat messages', () => {
    buffer = new RingBuffer<AgentBusMessage>(100)
    buffer.push(makeBusMessage('heartbeat', 'roci', '*', {
      agentId: 'test-id', agentType: 'openclaw',
      agentPurpose: 'home automation', agentCapabilities: ['home-auto']
    }))
    expect(buffer.filter((m) => m.type === 'heartbeat')).toHaveLength(1)
  })
})
