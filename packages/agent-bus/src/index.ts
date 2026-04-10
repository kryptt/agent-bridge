// Types and message factory
export {
  type MessageBase,
  type TaskMessage,
  type ChatMessage,
  type PresenceMessage,
  type EventMessage,
  type HeartbeatMessage,
  type AgentBusMessage,
  BUS_TOPIC,
  HEARTBEAT_TTL_MS,
  makeBusMessage
} from './types.js'

// Ring buffer
export { RingBuffer } from './ring-buffer.js'

// Zod schemas and validation
export {
  agentSendSchema,
  agentEventsSchema,
  agentRosterSchema,
  agentInboxSchema,
  validate,
  type AgentSendArgs,
  type AgentEventsArgs,
  type AgentRosterArgs,
  type AgentInboxArgs
} from './schemas.js'

// MQTT client
export * as mqttClient from './mqtt-client.js'
export type { MqttConfig } from './mqtt-client.js'

// Heartbeat and roster
export * as heartbeat from './heartbeat.js'
export type { HeartbeatConfig, RosterEntry } from './heartbeat.js'

// Pull-mode inbox
export * as inbox from './inbox.js'
