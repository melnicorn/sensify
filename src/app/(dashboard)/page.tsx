import Link from 'next/link'
import { Plus } from 'lucide-react'
import { listSensors, getLatestMetrics, getConfig } from '@/lib/storage'

export const dynamic = 'force-dynamic'
import { SensorCard } from '@/components/sensor-card'

export default async function DashboardPage() {
  const [sensors, config] = await Promise.all([listSensors(), getConfig()])
  const withLatest = await Promise.all(
    sensors.map(async (meta) => ({ meta, latest: await getLatestMetrics(meta.id) }))
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-foreground">Sensors</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{sensors.length} registered</span>
          <Link
            href="/devices/new"
            className="flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            Add device
          </Link>
        </div>
      </div>

      {sensors.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">No sensors yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            <Link href="/devices/new" className="underline hover:no-underline">
              Add a pull device
            </Link>{' '}
            to poll a network endpoint, or POST a reading to{' '}
            <code className="font-mono bg-muted px-1 rounded">/api/v1/readings</code>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {withLatest.map(({ meta, latest }) => (
            <SensorCard key={meta.id} meta={meta} latest={latest} config={config} />
          ))}
        </div>
      )}
    </div>
  )
}
