import mqtt, { type MqttClient as MqttClientType } from 'mqtt'
import { RingBuffer } from './ring-buffer.js'
import { BUS_TOPIC, type AgentBusMessage } from './types.js'
import { ingestHeartbeat } from './heartbeat.js'

export interface MqttConfig {
  url: string
  user?: string
  pass?: string
  clientId: string
  reconnectMs?: number
  bufferSize?: number
  agentName: string
}

let client: MqttClientType | null = null
let messageBuffer: RingBuffer<AgentBusMessage>
let agentName: string
let onBusMessage: ((msg: AgentBusMessage) => void) | null = null

export function setMessageHandler (handler: (msg: AgentBusMessage) => void): void {
  onBusMessage = handler
}

export function getBuffer (): RingBuffer<AgentBusMessage> {
  return messageBuffer
}

export function isConnected (): boolean {
  return client?.connected ?? false
}

export function lastMessageAt (): string | null {
  const messages = messageBuffer.toArray()
  if (messages.length === 0) return null
  return messages[messages.length - 1]!.ts
}

export async function publish (msg: AgentBusMessage): Promise<void> {
  if (!client?.connected) {
    throw new Error('MQTT not connected')
  }
  return new Promise((resolve, reject) => {
    client!.publish(BUS_TOPIC, JSON.stringify(msg), { qos: 1 }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

export function connect (config: MqttConfig): Promise<void> {
  agentName = config.agentName
  messageBuffer = new RingBuffer<AgentBusMessage>(config.bufferSize ?? 1000)

  return new Promise((resolve, reject) => {
    client = mqtt.connect(config.url, {
      clientId: config.clientId,
      username: config.user || undefined,
      password: config.pass || undefined,
      reconnectPeriod: config.reconnectMs ?? 5000,
      clean: true
    })

    client.on('connect', () => {
      console.error('[agent-bus] Connected to MQTT broker')
      client!.subscribe(BUS_TOPIC, { qos: 1 }, (err) => {
        if (err) {
          console.error('[agent-bus] Subscribe error:', err.message)
          reject(err)
        } else {
          console.error(`[agent-bus] Subscribed to ${BUS_TOPIC}`)
          resolve()
        }
      })
    })

    client.on('message', (_topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString()) as AgentBusMessage
        messageBuffer.push(msg)
        ingestHeartbeat(msg)
        // Only push notifications for messages from others, addressed to us or broadcast, skip heartbeats
        if (msg.from !== agentName && msg.type !== 'heartbeat' && (msg.to === agentName || msg.to === '*')) {
          onBusMessage?.(msg)
        }
      } catch {
        console.error('[agent-bus] Failed to parse bus message')
      }
    })

    client.on('error', (err) => {
      console.error('[agent-bus] MQTT error:', err.message)
    })

    client.on('reconnect', () => {
      console.error('[agent-bus] Reconnecting to MQTT broker...')
    })

    setTimeout(() => {
      if (!client?.connected) {
        console.error('[agent-bus] MQTT connection timeout, starting in degraded mode')
        resolve()
      }
    }, 10_000)
  })
}
