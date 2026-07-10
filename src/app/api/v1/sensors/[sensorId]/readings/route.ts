import { NextRequest, NextResponse } from 'next/server'
import { getReadings } from '@/lib/storage'

const RANGE_HOURS: Record<string, number> = {
  '1h': 1,
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sensorId: string }> }
) {
  const { sensorId } = await params
  const range = request.nextUrl.searchParams.get('range') ?? '7d'
  const hours = RANGE_HOURS[range] ?? RANGE_HOURS['7d']!

  const now = new Date()
  const from = new Date(now.getTime() - hours * 3_600_000)

  const readings = await getReadings(sensorId, from.toISOString(), now.toISOString())
  return NextResponse.json(readings)
}
