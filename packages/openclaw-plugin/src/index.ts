import { Effect, Layer } from 'effect'
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry'
import { MqttClient, MqttClientLive } from './services/MqttClient.js'
import { GatewayDispatch, GatewayDispatchLive } from './services/GatewayDispatch.js'
import {
  BUS_TOPIC, HEARTBEAT_TTL_MS, makeBusMessage,
  agentSendSchema, validate,
  type AgentBusMessage, type AgentSendArgs
} from '@kryptt/agent-bus'

const AGENT_NAME = process.env.AGENT_NAME ?? 'roci'
const AGENT_TYPE = process.env.AGENT_TYPE ?? 'openclaw'
const AGENT_PURPOSE = process.env.AGENT_PURPOSE ?? 'home automation and cluster management'
const AGENT_CAPABILITIES = (process.env.AGENT_CAPABILITIES ?? '').split(',').filter(Boolean)
const AGENT_ID = crypto.randomUUID()

type AppServices = MqttClient | GatewayDispatch

const noopMqttLayer = Layer.succeed(MqttClient, {
  publish: () => Effect.void,
  subscribe: () => Effect.void,
  isConnected: () => false
})

let appLayer = Layer.mergeAll(noopMqttLayer, GatewayDispatchLive)
let mqttReady = false

const run = <A>(effect: Effect.Effect<A, unknown, AppServices>): Promise<A | undefined> =>
  Effect.runPromise(effect.pipe(
    Effect.provide(appLayer),
    Effect.catchAll((err) => { console.error('[openclaw-plugin] effect failed:', err); return Effect.succeed(undefined as A | undefined) })
  ))

let currentMessageId: string | null = null
let taskStartedAt: number | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

function publishToBus (msg: AgentBusMessage): Promise<void | undefined> {
  return run(Effect.gen(function * () {
    const mqtt = yield * MqttClient
    yield * mqtt.publish(BUS_TOPIC, msg as unknown as Record<string, unknown>)
  }))
}

function sendHeartbeat (): void {
  if (!mqttReady) return
  const hb = makeBusMessage('heartbeat', AGENT_NAME, '*', {
    agentId: AGENT_ID,
    agentType: AGENT_TYPE,
    agentPurpose: AGENT_PURPOSE,
    agentCapabilities: AGENT_CAPABILITIES
  })
  publishToBus(hb).catch((err) => console.error('[openclaw-plugin] Heartbeat failed:', err))
}

/** Pick only the defined optional fields from validated send args */
function pickOptional (args: AgentSendArgs): Partial<Pick<AgentSendArgs, 'replyTo' | 'conversationId'>> {
  const opt: Record<string, unknown> = {}
  if (args.replyTo != null) opt.replyTo = args.replyTo
  if (args.conversationId != null) opt.conversationId = args.conversationId
  return opt
}

export default definePluginEntry({
  id: 'openclaw-mqtt-plugin',
  name: 'Agent Bus Bridge',
  description: 'Bridges OpenClaw agent to the shared agent bus (openclaw/agents/bus) for inter-agent communication',
  kind: 'integration',

  register (api) {
    const initMqtt = async (): Promise<void> => {
      const exit = await Effect.runPromiseExit(
        Effect.gen(function * () {
          const mqtt = yield * MqttClient
          if (!mqtt.isConnected()) throw new Error('Not connected after init')
        }).pipe(Effect.provide(MqttClientLive))
      )

      if (exit._tag === 'Success') {
        const safeMqttLayer = Layer.catchAll(MqttClientLive, () => noopMqttLayer)
        appLayer = Layer.mergeAll(safeMqttLayer, GatewayDispatchLive)
        mqttReady = true
        console.log('[openclaw-plugin] MQTT connected, subscribing to agent bus')

        await run(Effect.gen(function * () {
          const mqtt = yield * MqttClient
          yield * mqtt.subscribe(BUS_TOPIC, (topic, payload) => {
            handleBusMessage(payload).catch((err) => console.error('[openclaw-plugin] Bus message error:', err))
          })
        }))

        // Start heartbeat
        sendHeartbeat()
        heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_TTL_MS)
        console.log('[openclaw-plugin] Heartbeat started (15 min interval)')
      } else {
        console.error('[openclaw-plugin] MQTT unavailable, agent bus disabled. Exit:', JSON.stringify(exit))
      }
    }

    async function handleBusMessage (payload: Buffer): Promise<void> {
      let msg: AgentBusMessage
      try { msg = JSON.parse(payload.toString()) } catch { console.error('[openclaw-plugin] Invalid bus message'); return }

      if (msg.to !== AGENT_NAME && msg.to !== '*') return
      if (msg.from === AGENT_NAME) return

      switch (msg.type) {
        case 'task': await handleTask(msg); break
        case 'message': await handleIncomingMessage(msg); break
        // heartbeat, presence, event from others — ingested but no action needed
      }
    }

    async function handleTask (msg: AgentBusMessage & { type: 'task' }): Promise<void> {
      console.log(`[openclaw-plugin] Task ${msg.id} from ${msg.from}: skill=${msg.skill}`)
      await run(Effect.gen(function * () {
        const gateway = yield * GatewayDispatch
        const mqtt = yield * MqttClient

        yield * gateway.chat(`[Task ${msg.id}] Use the ${msg.skill} skill to: ${msg.prompt}`).pipe(
          Effect.flatMap((response) =>
            mqtt.publish(BUS_TOPIC, makeBusMessage('event', AGENT_NAME, msg.from, {
              status: 'completed', summary: response.slice(0, 500),
              data: { taskId: msg.id, skill: msg.skill, ...(msg.conversationId ? { conversationId: msg.conversationId } : {}) }
            }) as unknown as Record<string, unknown>).pipe(Effect.map(() => console.log(`[openclaw-plugin] Task ${msg.id} completed`)))
          ),
          Effect.catchAll((err) => Effect.gen(function * () {
            console.error(`[openclaw-plugin] Task ${msg.id} failed: ${err}`)
            yield * mqtt.publish(BUS_TOPIC, makeBusMessage('event', AGENT_NAME, msg.from, {
              status: 'error', summary: `Task failed: ${err}`,
              data: { taskId: msg.id, skill: msg.skill }
            }) as unknown as Record<string, unknown>)
          }))
        )
      }))
    }

    async function handleIncomingMessage (msg: AgentBusMessage & { type: 'message' }): Promise<void> {
      console.log(`[openclaw-plugin] Message from ${msg.from}: ${msg.body.slice(0, 100)}`)
      await run(Effect.gen(function * () {
        const gateway = yield * GatewayDispatch
        yield * gateway.chat(`[Message from ${msg.from}] ${msg.body}`)
      }))
    }

    // Hook: before_prompt_build — publish event:started
    api.on('before_prompt_build', async (event: any) => {
      if (!mqttReady) return {}
      try {
        let prompt = ''
        const msgs: any[] = event?.messages ?? []
        const userMsgs = msgs.filter((m: any) => m.role === 'user')
        if (userMsgs.length) {
          const last = userMsgs[userMsgs.length - 1]
          const content = last.content
          if (typeof content === 'string') prompt = content
          else if (Array.isArray(content)) prompt = content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ')
        }
        if (!prompt || prompt.length < 5) return {}

        const msg = makeBusMessage('event', AGENT_NAME, '*', { status: 'started', summary: prompt.slice(0, 200) })
        currentMessageId = msg.id
        taskStartedAt = Date.now()
        await publishToBus(msg)
      } catch { /* best-effort */ }
      return {}
    })

    // Hook: agent_end — publish event:completed
    api.on('agent_end', async (event: any) => {
      if (!mqttReady) return {}
      try {
        const msgs: any[] = event?.messages ?? []
        const assistantMsgs = msgs.filter((m: any) => m.role === 'assistant')
        let summary = ''
        if (assistantMsgs.length) {
          const last = assistantMsgs[assistantMsgs.length - 1]
          const content = last.content
          if (typeof content === 'string') summary = content.slice(0, 300)
          else if (Array.isArray(content)) summary = content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join(' ').slice(0, 300)
        }

        await publishToBus(makeBusMessage('event', AGENT_NAME, '*', {
          status: 'completed', summary: summary || 'No summary available',
          data: { replyTo: currentMessageId, duration_ms: taskStartedAt ? Date.now() - taskStartedAt : 0 }
        }))
        currentMessageId = null; taskStartedAt = null
      } catch { /* best-effort */ }
      return {}
    })

    // Tool: agent_comms — send messages on the bus (with zod validation + conversationId)
    api.registerTool({
      name: 'agent_comms',
      label: 'Agent Communications',
      description: 'Send a message on the shared agent bus (openclaw/agents/bus).\n\n' +
        'Message types:\n' +
        '  message — send text to another agent or user\n' +
        '  task    — request another agent to execute a skill\n' +
        '  presence — announce interaction with a human user\n\n' +
        'Addressing:\n' +
        '  to: "claude"        — direct to Claude Code agent\n' +
        '  to: "roci"          — direct to this agent (self)\n' +
        '  to: "user:rodolfo"  — route to human via most-recent agent\n' +
        '  to: "*"             — broadcast to all agents',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['message', 'task', 'presence'], description: 'Message type' },
          to: { type: 'string', description: 'Recipient: agent name, "user:canonical-id", or "*" for broadcast' },
          body: { type: 'string', description: 'Text content (type: message)' },
          skill: { type: 'string', description: 'Skill to invoke (type: task)' },
          prompt: { type: 'string', description: 'Task prompt (type: task)' },
          user: { type: 'string', description: 'Human canonical id (type: presence)' },
          channel: { type: 'string', description: 'Communication channel (type: presence)' },
          replyTo: { type: 'string', description: 'Message id being replied to (optional)' },
          conversationId: { type: 'string', description: 'Groups related messages into a logical thread' }
        },
        required: ['type', 'to']
      },
      async execute (...rawArgs: any[]) {
        const raw = (typeof rawArgs[0] === 'object' && rawArgs[0] !== null ? rawArgs[0] : rawArgs[1] ?? {}) as Record<string, string>

        if (!mqttReady) return { content: [{ type: 'text', text: 'MQTT not connected.' }] }

        const parsed = validate(agentSendSchema, raw)
        if (!parsed.ok) return { content: [{ type: 'text', text: `Validation error: ${parsed.error}` }] }
        const args = parsed.value

        try {
          const opt = pickOptional(args)
          let msg: AgentBusMessage
          switch (args.type) {
            case 'message': msg = makeBusMessage('message', AGENT_NAME, args.to, { body: args.body, ...opt }); break
            case 'task': msg = makeBusMessage('task', AGENT_NAME, args.to, { skill: args.skill, prompt: args.prompt, ...opt }); break
            case 'presence': msg = makeBusMessage('presence', AGENT_NAME, '*', { user: args.user, channel: args.channel, ...opt }); break
          }
          await publishToBus(msg)
          return { content: [{ type: 'text', text: `Sent ${msg.type} to ${msg.to} (id: ${msg.id})` }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `Send failed: ${err}` }] }
        }
      }
    })

    console.log('[openclaw-plugin] Starting MQTT init...')
    initMqtt().catch((err) => console.error('[openclaw-plugin] initMqtt failed:', err))
    console.log('[openclaw-plugin] Agent Bus Bridge registered: 1 tool (agent_comms) + 2 hooks + heartbeat')
  }
})
