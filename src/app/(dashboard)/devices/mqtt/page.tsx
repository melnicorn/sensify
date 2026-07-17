import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MqttTopicBrowser } from '@/components/mqtt-topic-browser'

export default function MqttBrowsePage() {
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link
          href="/devices/new"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          Add device
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm text-foreground font-medium">Browse MQTT topics</span>
      </div>
      <div>
        <h1 className="text-lg font-semibold text-foreground">Browse MQTT topics</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Point at a topic filter to see what your devices are publishing to the broker. Useful for
          confirming a device is connected and for discovering the shape of its payloads.
        </p>
      </div>
      <MqttTopicBrowser />
    </div>
  )
}
