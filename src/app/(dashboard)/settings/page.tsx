import { getConfig } from '@/lib/storage'
import { listChannels } from '@/lib/alerts/repo'

export const dynamic = 'force-dynamic'
import { SettingsForm } from '@/components/settings-form'
import { ChannelsManager } from '@/components/channels-manager'

export default async function SettingsPage() {
  const [config, channels] = await Promise.all([getConfig(), listChannels()])

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Global display and storage preferences.</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <SettingsForm config={config} />
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <ChannelsManager channels={channels} />
      </div>
    </div>
  )
}
