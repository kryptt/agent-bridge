import { describe, it, expect } from 'vitest'
import { agentSendSchema, agentEventsSchema, agentRosterSchema, agentInboxSchema, validate } from '../schemas.js'

describe('agentSendSchema', () => {
  it('accepts valid message, task, and presence payloads', () => {
    expect(validate(agentSendSchema, { type: 'message', to: 'roci', body: 'hello' }).ok).toBe(true)
    expect(validate(agentSendSchema, {
      type: 'message', to: 'roci', body: 'hello',
      conversationId: 'c1', replyTo: '550e8400-e29b-41d4-a716-446655440000'
    }).ok).toBe(true)
    expect(validate(agentSendSchema, { type: 'task', to: 'roci', skill: 'home-auto', prompt: 'lights off' }).ok).toBe(true)
    expect(validate(agentSendSchema, { type: 'presence', to: '*', user: 'rodolfo', channel: 'mcp' }).ok).toBe(true)
  })

  it('rejects payloads with missing or invalid fields', () => {
    expect(validate(agentSendSchema, { type: 'message', to: 'roci' }).ok).toBe(false)
    expect(validate(agentSendSchema, { type: 'task', to: 'roci', prompt: 'do stuff' }).ok).toBe(false)
    expect(validate(agentSendSchema, { type: 'unknown', to: 'roci' }).ok).toBe(false)
    expect(validate(agentSendSchema, { type: 'message', to: '', body: 'hi' }).ok).toBe(false)
  })
})

describe('agentEventsSchema', () => {
  it('accepts empty args and full filter set', () => {
    expect(validate(agentEventsSchema, {}).ok).toBe(true)
    expect(validate(agentEventsSchema, {
      type_filter: 'heartbeat', from_filter: 'roci',
      limit: 50, since_minutes: 5, conversation_id: 'conv-1'
    }).ok).toBe(true)
  })

  it('rejects out-of-range limit', () => {
    expect(validate(agentEventsSchema, { limit: 0 }).ok).toBe(false)
    expect(validate(agentEventsSchema, { limit: 200 }).ok).toBe(false)
  })
})

describe('agentRosterSchema + agentInboxSchema', () => {
  it('accepts valid inputs and rejects invalid inbox limit', () => {
    expect(validate(agentRosterSchema, {}).ok).toBe(true)
    expect(validate(agentRosterSchema, { agent_name: 'roci', include_offline: true }).ok).toBe(true)
    expect(validate(agentInboxSchema, {}).ok).toBe(true)
    expect(validate(agentInboxSchema, { limit: 10 }).ok).toBe(true)
    expect(validate(agentInboxSchema, { limit: 200 }).ok).toBe(false)
  })
})
