import { NextRequest, NextResponse } from 'next/server'
import { getSensorMeta, getReadings } from '@/lib/storage'
import type { SensorMeta } from '@/lib/types'

const RANGE_HOURS: Record<string, number> = {
  '1h': 1,
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30,
}

// Values are exported as stored: temperature in °C, humidity in %, pull
// metrics in whatever unit their field mapping declares.
function unitFor(meta: SensorMeta, metric: string): string | null {
  if (meta.type === 'push') {
    if (metric === 'temperature') return 'C'
    if (metric === 'humidity') return '%'
    return null
  }
  return meta.pull?.fields.find((f) => f.metric === metric)?.unit ?? null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sensorId: string }> }
) {
  const { sensorId } = await params
  const meta = await getSensorMeta(sensorId)
  if (!meta) {
    return NextResponse.json({ error: 'Sensor not found' }, { status: 404 })
  }

  const sp = request.nextUrl.searchParams
  let from: string | null = null
  let to: string | null = null
  let scope = 'all'

  const range = sp.get('range')
  if (range) {
    const hours = RANGE_HOURS[range]
    if (!hours) {
      return NextResponse.json(
        { error: `Unknown range; expected one of ${Object.keys(RANGE_HOURS).join(', ')}` },
        { status: 400 }
      )
    }
    const now = new Date()
    from = new Date(now.getTime() - hours * 3_600_000).toISOString()
    to = now.toISOString()
    scope = range
  } else if (sp.get('from') || sp.get('to')) {
    for (const key of ['from', 'to'] as const) {
      const raw = sp.get(key)
      if (!raw) continue
      const parsed = Date.parse(raw)
      if (isNaN(parsed)) {
        return NextResponse.json(
          { error: `Invalid ${key} timestamp; expected ISO 8601` },
          { status: 400 }
        )
      }
      if (key === 'from') from = new Date(parsed).toISOString()
      else to = new Date(parsed).toISOString()
    }
    scope = 'selection'
  }

  const readings = await getReadings(sensorId, from ?? undefined, to ?? undefined)

  // One time series per metric, in the same stable order the charts use:
  // pull field order if configured, else alphabetical
  const byMetric = new Map<string, { ts: string; value: number }[]>()
  for (const r of readings) {
    const list = byMetric.get(r.metric)
    if (list) list.push({ ts: r.ts, value: r.value })
    else byMetric.set(r.metric, [{ ts: r.ts, value: r.value }])
  }
  const fieldOrder = meta.pull?.fields.map((f) => f.metric) ?? []
  const metrics = [...byMetric.keys()].sort((a, b) => {
    const ai = fieldOrder.indexOf(a)
    const bi = fieldOrder.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })

  const doc = {
    sensor: { id: meta.id, name: meta.name, type: meta.type },
    exportedAt: new Date().toISOString(),
    scope,
    from,
    to,
    series: metrics.map((metric) => {
      const points = byMetric.get(metric)!
      return { metric, unit: unitFor(meta, metric), count: points.length, points }
    }),
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
  }
  if (sp.get('download') === '1') {
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    headers['content-disposition'] = `attachment; filename="${meta.id}-${scope}-${stamp}.json"`
  }
  return new NextResponse(JSON.stringify(doc, null, 2), { headers })
}
