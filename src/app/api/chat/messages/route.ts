import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers, Message } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { getAllGatewaySessions } from '@/lib/sessions'
import { eventBus } from '@/lib/event-bus'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

type ForwardInfo = {
  attempted: boolean
  delivered: boolean
  reason?: string
  session?: string
  runId?: string
}

const COORDINATOR_AGENT =
  String(process.env.MC_COORDINATOR_AGENT || process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator').trim() ||
  'coordinator'

function parseGatewayJson(raw: string): any | null {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end < start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

function createChatReply(
  db: ReturnType<typeof getDatabase>,
  workspaceId: number,
  conversationId: string,
  fromAgent: string,
  toAgent: string,
  content: string,
  messageType: 'text' | 'status' = 'status',
  metadata: Record<string, any> | null = null
) {
  const replyInsert = db
    .prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      conversationId,
      fromAgent,
      toAgent,
      content,
      messageType,
      metadata ? JSON.stringify(metadata) : null,
      workspaceId
    )

  const row = db
    .prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?')
    .get(replyInsert.lastInsertRowid, workspaceId) as Message

  eventBus.broadcast('chat.message', {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  })
}

function extractReplyText(waitPayload: any): string | null {
  if (!waitPayload || typeof waitPayload !== 'object') return null

  const directCandidates = [
    waitPayload.text,
    waitPayload.message,
    waitPayload.response,
    waitPayload.output,
    waitPayload.result,
  ]
  for (const value of directCandidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  if (typeof waitPayload.output === 'object' && waitPayload.output) {
    const nested = [
      waitPayload.output.text,
      waitPayload.output.message,
      waitPayload.output.content,
    ]
    for (const value of nested) {
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }

  return null
}

/**
 * GET /api/chat/messages - List messages with filters
 * Query params: conversation_id, from_agent, to_agent, limit, offset, since
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)

    const conversation_id = searchParams.get('conversation_id')
    const from_agent = searchParams.get('from_agent')
    const to_agent = searchParams.get('to_agent')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')
    const since = searchParams.get('since')

    let query = 'SELECT * FROM messages WHERE workspace_id = ?'
    const params: any[] = [workspaceId]

    if (conversation_id) {
      query += ' AND conversation_id = ?'
      params.push(conversation_id)
    }

    if (from_agent) {
      query += ' AND from_agent = ?'
      params.push(from_agent)
    }

    if (to_agent) {
      query += ' AND to_agent = ?'
      params.push(to_agent)
    }

    if (since) {
      query += ' AND created_at > ?'
      params.push(parseInt(since))
    }

    query += ' ORDER BY created_at ASC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    const messages = db.prepare(query).all(...params) as Message[]

    const parsed = messages.map((msg) => ({
      ...msg,
      metadata: msg.metadata ? JSON.parse(msg.metadata) : null
    }))

    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM messages WHERE workspace_id = ?'
    const countParams: any[] = [workspaceId]
    if (conversation_id) {
      countQuery += ' AND conversation_id = ?'
      countParams.push(conversation_id)
    }
    if (from_agent) {
      countQuery += ' AND from_agent = ?'
      countParams.push(from_agent)
    }
    if (to_agent) {
      countQuery += ' AND to_agent = ?'
      countParams.push(to_agent)
    }
    if (since) {
      countQuery += ' AND created_at > ?'
      countParams.push(parseInt(since))
    }
    const countRow = db.prepare(countQuery).get(...countParams) as { total: number }

    return NextResponse.json({ messages: parsed, total: countRow.total, page: Math.floor(offset / limit) + 1, limit })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/chat/messages error')
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 })
  }
}

/**
 * POST /api/chat/messages - Send a new message
 * Body: { from, to, content, message_type, conversation_id, metadata }
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()

    const from = (body.from || '').trim()
    const to = body.to ? (body.to as string).trim() : null
    const content = (body.content || '').trim()
    const message_type = body.message_type || 'text'
    const conversation_id = body.conversation_id || `conv_${Date.now()}`
    const metadata = body.metadata || null

    if (!from || !content) {
      return NextResponse.json(
        { error: '"from" and "content" are required' },
        { status: 400 }
      )
    }

    const stmt = db.prepare(`
      INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, metadata, workspace_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      conversation_id,
      from,
      to,
      content,
      message_type,
      metadata ? JSON.stringify(metadata) : null,
      workspaceId
    )

    const messageId = result.lastInsertRowid as number

    let forwardInfo: ForwardInfo | null = null

    // Log activity
    db_helpers.logActivity(
      'chat_message',
      'message',
      messageId,
      from,
      `Sent ${message_type} message${to ? ` to ${to}` : ' (broadcast)'}`,
      { conversation_id, to, message_type },
      workspaceId
    )

    // Create notification for recipient if specified
    if (to) {
      db_helpers.createNotification(
        to,
        'chat_message',
        `Message from ${from}`,
        content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        'message',
        messageId,
        workspaceId
      )

      // Optionally forward to agent via gateway
      if (body.forward) {
        forwardInfo = { attempted: true, delivered: false }

        const agent = db
          .prepare('SELECT * FROM agents WHERE lower(name) = lower(?) AND workspace_id = ?')
          .get(to, workspaceId) as any

        let sessionKey: string | null = agent?.session_key || null

        // Fallback: derive session from on-disk gateway session stores
        if (!sessionKey) {
          const sessions = getAllGatewaySessions()
          const match = sessions.find(
            (s) => s.agent.toLowerCase() === String(to).toLowerCase()
          )
          sessionKey = match?.key || match?.sessionId || null
        }

        // Prefer configured openclawId when present, fallback to normalized name
        let openclawAgentId: string | null = null
        if (agent?.config) {
          try {
            const cfg = JSON.parse(agent.config)
            if (cfg?.openclawId && typeof cfg.openclawId === 'string') {
              openclawAgentId = cfg.openclawId
            }
          } catch {
            // ignore parse issues
          }
        }
        if (!openclawAgentId && typeof to === 'string') {
          openclawAgentId = to.toLowerCase().replace(/\s+/g, '-')
        }

        if (!sessionKey && !openclawAgentId) {
          forwardInfo.reason = 'no_active_session'

          // For coordinator messages, emit an immediate visible status reply
          if (typeof conversation_id === 'string' && conversation_id.startsWith('coord:')) {
            try {
                createChatReply(
                  db,
                  workspaceId,
                  conversation_id,
                  COORDINATOR_AGENT,
                  from,
                  'I received your message, but my live coordinator session is offline right now. Start/restore the coordinator session and retry.',
                  'status',
                  { status: 'offline', reason: 'no_active_session' }
                )
            } catch (e) {
              logger.error({ err: e }, 'Failed to create offline status reply')
            }
          }
        } else {
          try {
            const isCoordinatorThread =
              typeof conversation_id === 'string' &&
              conversation_id.startsWith('coord:')

            const coordinatorPrompt =
              `You are the Coordinator agent. Reply with a short, direct text answer.\n` +
              `If you delegate, list which agent(s) you will use.\n\n` +
              `From ${from}: ${content}`

            const invokeParams: any = {
              message: isCoordinatorThread ? coordinatorPrompt : `Message from ${from}: ${content}`,
              idempotencyKey: `mc-${messageId}-${Date.now()}`,
              // For coordinator threads, request delivery so we can retrieve output.
              deliver: isCoordinatorThread,
            }
            if (sessionKey) invokeParams.sessionKey = sessionKey
            else invokeParams.agentId = openclawAgentId

            const invokeResult = await runOpenClaw(
              [
                'gateway',
                'call',
                'agent',
                '--timeout',
                '10000',
                '--params',
                JSON.stringify(invokeParams),
                '--json',
              ],
              { timeoutMs: 12000 }
            )
            const acceptedPayload = parseGatewayJson(invokeResult.stdout)
            forwardInfo.delivered = true
            forwardInfo.session = sessionKey || openclawAgentId || undefined
            if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
              forwardInfo.runId = acceptedPayload.runId
            }
          } catch (err) {
            // OpenClaw may return accepted JSON on stdout but still emit a late stderr warning.
            // Treat accepted runs as successful delivery.
            const maybeStdout = String((err as any)?.stdout || '')
            const acceptedPayload = parseGatewayJson(maybeStdout)
            if (maybeStdout.includes('"status": "accepted"') || maybeStdout.includes('"status":"accepted"')) {
              forwardInfo.delivered = true
              forwardInfo.session = sessionKey || openclawAgentId || undefined
              if (typeof acceptedPayload?.runId === 'string' && acceptedPayload.runId) {
                forwardInfo.runId = acceptedPayload.runId
              }
            } else {
              forwardInfo.reason = 'gateway_send_failed'
              logger.error({ err }, 'Failed to forward message via gateway')

              // For coordinator messages, emit visible status when send fails
              if (typeof conversation_id === 'string' && conversation_id.startsWith('coord:')) {
                try {
                  createChatReply(
                    db,
                    workspaceId,
                    conversation_id,
                    COORDINATOR_AGENT,
                    from,
                    'I received your message, but delivery to the live coordinator runtime failed. Please restart the coordinator/gateway session and retry.',
                    'status',
                    { status: 'delivery_failed', reason: 'gateway_send_failed' }
                  )
                } catch (e) {
                  logger.error({ err: e }, 'Failed to create gateway failure status reply')
                }
              }
            }
          }

          // Coordinator mode should always show visible coordinator feedback in thread.
          if (
            typeof conversation_id === 'string' &&
            conversation_id.startsWith('coord:') &&
            forwardInfo.delivered
          ) {
            try {
              createChatReply(
                db,
                workspaceId,
                conversation_id,
                COORDINATOR_AGENT,
                from,
                'Received. I am coordinating downstream agents now.',
                'status',
                { status: 'accepted', runId: forwardInfo.runId || null }
              )
            } catch (e) {
              logger.error({ err: e }, 'Failed to create accepted status reply')
            }

            // Best effort: wait briefly and surface completion/error feedback.
            if (forwardInfo.runId) {
              try {
                const waitResult = await runOpenClaw(
                  [
                    'gateway',
                    'call',
                    'agent.wait',
                    '--timeout',
                    '8000',
                    '--params',
                    JSON.stringify({ runId: forwardInfo.runId, timeoutMs: 6000 }),
                    '--json',
                  ],
                  { timeoutMs: 9000 }
                )

                const waitPayload = parseGatewayJson(waitResult.stdout)
                const waitStatus = String(waitPayload?.status || '').toLowerCase()

                if (waitStatus === 'error') {
                  const reason =
                    typeof waitPayload?.error === 'string'
                      ? waitPayload.error
                      : 'Unknown runtime error'
                  createChatReply(
                    db,
                    workspaceId,
                    conversation_id,
                    COORDINATOR_AGENT,
                    from,
                    `I received your message, but execution failed: ${reason}`,
                    'status',
                    { status: 'error', runId: forwardInfo.runId }
                  )
                } else if (waitStatus === 'timeout') {
                  // Coordinator runs often don't return output via agent.wait; use the reliable openclaw agent fallback.
                  const fallbackPrompt =
                    `You are the Coordinator agent. Reply with a short, direct text answer.\n` +
                    `If you delegate, list which agent(s) you will use.\n\n` +
                    `From ${from}: ${content}`

                  try {
                    const fallbackResult = await runOpenClaw(
                      ['agent', '--agent', COORDINATOR_AGENT, '--message', fallbackPrompt, '--json'],
                      { timeoutMs: 60000 }
                    )

                    let fallbackText = ''
                    try {
                      const parsed = JSON.parse(String(fallbackResult.stdout || '{}'))
                      fallbackText = String(parsed?.result?.payloads?.[0]?.text || '').trim()
                    } catch {
                      fallbackText = String(fallbackResult.stdout || '').trim()
                    }

                    if (fallbackText) {
                      createChatReply(
                        db,
                        workspaceId,
                        conversation_id,
                        COORDINATOR_AGENT,
                        from,
                        fallbackText,
                        'text',
                        { status: 'completed', runId: forwardInfo.runId, source: 'timeout-fallback-openclaw-agent' }
                      )
                    } else {
                      createChatReply(
                        db,
                        workspaceId,
                        conversation_id,
                        COORDINATOR_AGENT,
                        from,
                        'I received your message and attempted a fallback execution, but no text payload was returned.',
                        'status',
                        { status: 'processing', runId: forwardInfo.runId, source: 'timeout-fallback-openclaw-agent' }
                      )
                    }
                  } catch (err) {
                    createChatReply(
                      db,
                      workspaceId,
                      conversation_id,
                      COORDINATOR_AGENT,
                      from,
                      'I received your message and I am still processing it. (Fallback execution failed.)',
                      'status',
                      { status: 'processing', runId: forwardInfo.runId, source: 'timeout-fallback-openclaw-agent' }
                    )
                  }
                } else {
                  const replyText = extractReplyText(waitPayload)
                  if (replyText) {
                    createChatReply(
                      db,
                      workspaceId,
                      conversation_id,
                      COORDINATOR_AGENT,
                      from,
                      replyText,
                      'text',
                      { status: waitStatus || 'completed', runId: forwardInfo.runId }
                    )
                  } else {
                    // Fallback: if the gateway runtime didn't return text, try a direct system event that expects a final response.
                    // This is coordinator-thread-only behavior.
                    const fallbackPrompt =
                      `You are the Coordinator agent. Reply with a short, direct text answer.\n` +
                      `If you delegate, list which agent(s) you will use.\n\n` +
                      `From ${from}: ${content}`

                    let postedFallbackReply = false

                    try {
                      // Use `openclaw agent` to run the coordinator agent and capture a real textual reply.
                      const fallbackResult = await runOpenClaw(
                        ['agent', '--agent', COORDINATOR_AGENT, '--message', fallbackPrompt, '--json'],
                        { timeoutMs: 60000 }
                      )

                      let fallbackText = ''
                      try {
                        const parsed = parseGatewayJson(fallbackResult.stdout) || JSON.parse(String(fallbackResult.stdout || '{}'))
                        fallbackText = String(
                          parsed?.text ||
                          parsed?.message ||
                          parsed?.response ||
                          parsed?.output?.text ||
                          parsed?.result?.payloads?.[0]?.text ||
                          ''
                        ).trim()
                      } catch {
                        fallbackText = String(fallbackResult.stdout || '').trim()
                      }

                      if (fallbackText) {
                        postedFallbackReply = true
                        createChatReply(
                          db,
                          workspaceId,
                          conversation_id,
                          COORDINATOR_AGENT,
                          from,
                          fallbackText,
                          'text',
                          { status: 'completed', runId: forwardInfo.runId, source: 'fallback-openclaw-agent' }
                        )
                      } else if (process.env.NODE_ENV !== 'production') {
                        createChatReply(
                          db,
                          workspaceId,
                          conversation_id,
                          COORDINATOR_AGENT,
                          from,
                          `Fallback openclaw agent returned no text. stdout excerpt: ${String(fallbackResult.stdout || '').slice(0, 800)}`,
                          'status',
                          { status: 'fallback_empty', runId: forwardInfo.runId, source: 'fallback-openclaw-agent' }
                        )
                      }
                    } catch (fallbackErr: any) {
                      if (process.env.NODE_ENV !== 'production') {
                        const msg = String(fallbackErr?.message || fallbackErr)
                        const stderr = String(fallbackErr?.stderr || '')
                        createChatReply(
                          db,
                          workspaceId,
                          conversation_id,
                          COORDINATOR_AGENT,
                          from,
                          `Fallback openclaw agent failed: ${msg}\n${stderr}`.slice(0, 1200),
                          'status',
                          { status: 'fallback_error', runId: forwardInfo.runId, source: 'fallback-openclaw-agent' }
                        )
                      }
                    }

                    if (!postedFallbackReply) {
                      const debugPayload =
                        process.env.NODE_ENV === 'production'
                          ? ''
                          : `\n\n(wait payload excerpt) ${JSON.stringify(waitPayload).slice(0, 800)}`

                      createChatReply(
                        db,
                        workspaceId,
                        conversation_id,
                        COORDINATOR_AGENT,
                        from,
                        'Execution accepted and completed. No textual response payload was returned by the runtime.' + debugPayload,
                        'status',
                        { status: waitStatus || 'completed', runId: forwardInfo.runId }
                      )
                    }
                  }
                }
              } catch (waitErr) {
                const maybeWaitStdout = String((waitErr as any)?.stdout || '')
                const maybeWaitStderr = String((waitErr as any)?.stderr || '')
                const waitPayload = parseGatewayJson(maybeWaitStdout)
                const reason =
                  typeof waitPayload?.error === 'string'
                    ? waitPayload.error
                    : (maybeWaitStderr || maybeWaitStdout || 'Unable to read completion status from coordinator runtime.').trim()

                createChatReply(
                  db,
                  workspaceId,
                  conversation_id,
                  COORDINATOR_AGENT,
                  from,
                  `I received your message, but I could not retrieve completion output yet: ${reason}`,
                  'status',
                  { status: 'unknown', runId: forwardInfo.runId }
                )
              }
            }
          }
        }
      }
    }

    const created = db.prepare('SELECT * FROM messages WHERE id = ? AND workspace_id = ?').get(messageId, workspaceId) as Message
    const parsedMessage = {
      ...created,
      metadata: created.metadata ? JSON.parse(created.metadata) : null
    }

    // Broadcast to SSE clients
    eventBus.broadcast('chat.message', parsedMessage)

    return NextResponse.json({ message: parsedMessage, forward: forwardInfo }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/chat/messages error')
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}
