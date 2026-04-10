import { z } from 'zod'

// ── agent_send ──────────────────────────────────────────────────────────

const sendBase = {
  to: z.string().min(1, 'to is required'),
  replyTo: z.string().uuid().optional(),
  conversationId: z.string().optional()
}

const sendMessageSchema = z.object({
  type: z.literal('message'),
  ...sendBase,
  body: z.string().min(1, 'body is required for message type')
})

const sendTaskSchema = z.object({
  type: z.literal('task'),
  ...sendBase,
  skill: z.string().min(1, 'skill is required for task type'),
  prompt: z.string().min(1, 'prompt is required for task type')
})

const sendPresenceSchema = z.object({
  type: z.literal('presence'),
  ...sendBase,
  user: z.string().min(1, 'user is required for presence type'),
  channel: z.string().min(1)
})

export const agentSendSchema = z.discriminatedUnion('type', [
  sendMessageSchema,
  sendTaskSchema,
  sendPresenceSchema
])

export type AgentSendArgs = z.infer<typeof agentSendSchema>

// ── agent_events ────────────────────────────────────────────────────────

export const agentEventsSchema = z.object({
  type_filter: z.enum(['task', 'message', 'presence', 'event', 'heartbeat']).optional(),
  from_filter: z.string().optional(),
  id: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
  since_minutes: z.number().min(1).optional(),
  conversation_id: z.string().optional()
})

export type AgentEventsArgs = z.infer<typeof agentEventsSchema>

// ── agent_roster ────────────────────────────────────────────────────────

export const agentRosterSchema = z.object({
  agent_name: z.string().optional(),
  include_offline: z.boolean().optional()
})

export type AgentRosterArgs = z.infer<typeof agentRosterSchema>

// ── agent_inbox (pull mode) ─────────────────────────────────────────────

export const agentInboxSchema = z.object({
  limit: z.number().int().min(1).max(100).optional()
})

export type AgentInboxArgs = z.infer<typeof agentInboxSchema>

// ── Validation helper ───────────────────────────────────────────────────

export function validate<T> (schema: z.ZodType<T>, data: unknown): { ok: true, value: T } | { ok: false, error: string } {
  const result = schema.safeParse(data)
  if (result.success) return { ok: true, value: result.data }
  const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  return { ok: false, error: issues }
}
