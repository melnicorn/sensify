import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSensorMeta } from '@/lib/storage'
import { PullDeviceWizard } from '@/components/pull-device-wizard'

export default async function EditDevicePage({
  params,
}: {
  params: Promise<{ sensorId: string }>
}) {
  const { sensorId } = await params
  const meta = await getSensorMeta(sensorId)
  if (!meta || meta.type !== 'pull' || !meta.pull) notFound()

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link
          href={`/sensors/${meta.id}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          {meta.name}
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm text-foreground font-medium">Edit device</span>
      </div>
      <div>
        <h1 className="text-lg font-semibold text-foreground">Edit pull device</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Test the connection again to refresh the JSON structure, or edit fields directly.
        </p>
      </div>
      <PullDeviceWizard
        mode="edit"
        sensorId={meta.id}
        initial={{
          name: meta.name,
          url: meta.pull.url,
          pollInterval: meta.pull.pollInterval,
          fields: meta.pull.fields,
          lastSample: meta.pull.lastSample,
        }}
      />
    </div>
  )
}
