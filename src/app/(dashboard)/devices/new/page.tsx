import Link from 'next/link'
import { ArrowLeft, Radio } from 'lucide-react'
import { PullDeviceWizard } from '@/components/pull-device-wizard'

export default function NewDevicePage() {
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} />
          Sensors
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm text-foreground font-medium">Add pull device</span>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Add pull device</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sensify polls the device&apos;s HTTP endpoint on a schedule and records the JSON fields
            you select.
          </p>
        </div>
        <Link
          href="/devices/mqtt"
          className="flex shrink-0 items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <Radio size={14} />
          Browse MQTT topics
        </Link>
      </div>
      <PullDeviceWizard mode="create" />
    </div>
  )
}
