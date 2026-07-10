import { NextRequest, NextResponse } from 'next/server'
import { getReadings } from '@/lib/storage'

const RANGE_DAYS: Record<string, number> = {
  '1h': 0,
  '24h': 1,
  '7d': 7,
  '30d': 30,
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sensorId: string }> }
) {
  const { sensorId } = await params
  const range = request.nextUrl.searchParams.get('range') ?? '7d'

  const now = new Date()
  const toDate = now.toISOString().substring(0, 10)
  const days = RANGE_DAYS[range] ?? 7
  const from = new Date(now)
  from.setDate(from.getDate() - days)
  const fromDate = from.toISOString().substring(0, 10)

  let readings = await getReadings(sensorId, fromDate, toDate)

  if (range === '1h') {
    const cutoff = new Date(Date.now() - 3_600_000).toISOString()
    readings = readings.filter((r) => r.timestamp >= cutoff)
  }

  return NextResponse.json(readings)
}
