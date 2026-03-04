import { NextRequest, NextResponse } from 'next/server'
import { getDatabase, db_helpers } from '@/lib/db'
import { runOpenClaw } from '@/lib/command'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const resolvedParams = await params
    const agentId = resolvedParams.id
    const workspaceId = auth.user.workspace_id ?? 1;
    const body = await request.json().catch(() => ({}))
    const customMessage =
      typeof body?.message === 'string' ? body.message.trim() : ''

    const db = getDatabase()
    const agent: any = isNaN(Number(agentId))
      ? db.prepare('SELECT * FROM agents WHERE name = ? AND workspace_id = ?').get(agentId, workspaceId)
      : db.prepare('SELECT * FROM agents WHERE id = ? AND workspace_id = ?').get(Number(agentId), workspaceId)

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    if (!agent.session_key) {
      return NextResponse.json(
        { error: 'Agent has no session key configured' },
        { status: 400 }
      )
    }

    const message =
      customMessage ||
      `Wake up check-in for ${agent.name}. Please review assigned tasks and notifications.`

    // Use 'openclaw system event' for manual wake (documented approach)
    const { stdout, stderr } = await runOpenClaw(
      ['system', 'event', '--text', message, '--mode', 'now'],
      { timeoutMs: 15000 }
    )

    if (stderr && stderr.includes('error')) {
      return NextResponse.json(
        { error: stderr.trim() || 'Failed to wake agent' },
        { status: 500 }
      )
    }

    db_helpers.updateAgentStatus(agent.name, 'idle', 'Manual wake', workspaceId)

    return NextResponse.json({
      success: true,
      session_key: agent.session_key,
      stdout: stdout.trim()
    })
  } catch (error: any) {
    logger.error({ err: error }, 'POST /api/agents/[id]/wake error')

    // Return details to the client in dev to speed up local troubleshooting.
    const details =
      process.env.NODE_ENV === 'production'
        ? undefined
        : {
            message: String(error?.message ?? error),
            code: error?.code,
            stderr: error?.stderr,
            stdout: error?.stdout
          }

    return NextResponse.json(
      { error: 'Failed to wake agent', details },
      { status: 500 }
    )
  }
}
