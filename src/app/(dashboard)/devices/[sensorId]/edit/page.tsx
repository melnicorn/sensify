import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getSensorMeta, getLatestMetrics } from '@/lib/storage'
import { PullDeviceWizard } from '@/components/pull-device-wizard'
import { MqttTopicBrowser } from '@/components/mqtt-topic-browser'

export default async function EditDevicePage({
  params,
}: {
  params: Promise<{ sensorId: string }>
}) {
  const { sensorId } = await params
  const meta = await getSensorMeta(sensorId)
  // Push sensors have no editable ingest config — their device drives everything
  if (!meta || (meta.type !== 'pull' && meta.type !== 'mqtt')) notFound()

  const isMqtt = meta.type === 'mqtt'
  // Existing metric series, so the editor can warn about any left without a source
  const latest = isMqtt ? await getLatestMetrics(meta.id) : []

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
        <h1 className="text-lg font-semibold text-foreground">
          {isMqtt ? 'Edit MQTT sensor' : 'Edit pull device'}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {isMqtt
            ? 'Change which fields are recorded, or the topics this sensor uses. The tree shows the last payload received — click Listen to refresh it from live traffic.'
            : 'Test the connection again to refresh the JSON structure, or edit fields directly.'}
        </p>
      </div>

      {isMqtt ? (
        <MqttTopicBrowser
          mode="edit"
          sensorId={meta.id}
          initialName={meta.name}
          initialTopic={meta.mqtt!.topic}
          initialAvailabilityTopic={meta.mqtt!.availabilityTopic}
          initialConfigTopic={meta.mqtt!.configTopic}
          initialSample={meta.mqtt!.lastSample}
          existingFields={meta.mqtt!.fields}
          existingMetrics={latest.map((m) => m.metric)}
        />
      ) : (
        <PullDeviceWizard
          mode="edit"
          sensorId={meta.id}
          initial={{
            name: meta.name,
            url: meta.pull!.url,
            pollInterval: meta.pull!.pollInterval,
            fields: meta.pull!.fields,
            lastSample: meta.pull!.lastSample,
          }}
        />
      )}
    </div>
  )
}
