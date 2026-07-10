import { NextRequest, NextResponse } from 'next/server'
import { ReadingInputSchema } from '@/lib/schemas'
import { saveReading, getConfig } from '@/lib/storage'

export async function POST(request: NextRequest) {
  const { apiToken: expectedToken } = await getConfig()

  const auth = request.headers.get('authorization')
  if (!auth || auth !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const result = ReadingInputSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: result.error.flatten() },
      { status: 422 }
    )
  }

  const callerIp =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  const { id, timestamp, desiredConfig } = await saveReading(result.data, callerIp)

  const responseBody: Record<string, unknown> = {
    id,
    timestamp,
  }
  if (desiredConfig) {
    responseBody.config = desiredConfig
  }

  return NextResponse.json(responseBody, { status: 201 })
}
