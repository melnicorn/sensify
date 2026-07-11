import { NextResponse } from 'next/server'
import { getLatestMetrics } from '@/lib/storage'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sensorId: string }> }
) {
  const { sensorId } = await params
  const latest = await getLatestMetrics(sensorId)
  return NextResponse.json(latest)
}
