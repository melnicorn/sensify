import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSensorMeta, getLatestMetrics } from '@/lib/storage'
import { MqttTopicBrowser } from '@/components/mqtt-topic-browser'

export default async function ConvertToMqttPage({
  params,
}: {
  params: Promise<{ sensorId: string }>
}) {
  const { sensorId } = await params
  const meta = await getSensorMeta(sensorId)
  if (!meta || meta.type === 'mqtt') notFound()

  // Existing metric series, so the UI can warn about any left without a source
  const latest = await getLatestMetrics(meta.id)

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
        <span className="text-sm text-foreground font-medium">Switch to MQTT</span>
      </div>
      <div>
        <h1 className="text-lg font-semibold text-foreground">Switch to MQTT</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Move <span className="text-foreground">{meta.name}</span> from{' '}
          {meta.type === 'pull' ? 'polling' : 'the push API'} to MQTT. This edits the existing
          sensor in place — its readings, alert rules and metadata are kept, so charts stay
          continuous. Pick the topic it now publishes to and confirm the fields.
        </p>
      </div>
      <MqttTopicBrowser
        mode="convert"
        sensorId={meta.id}
        initialName={meta.name}
        existingFields={meta.pull?.fields ?? []}
        existingMetrics={latest.map((m) => m.metric)}
      />
    </div>
  )
}
