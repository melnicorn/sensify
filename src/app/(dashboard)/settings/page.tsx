import { getConfig } from '@/lib/storage'

export const dynamic = 'force-dynamic'
import { SettingsForm } from '@/components/settings-form'

export default async function SettingsPage() {
  const config = await getConfig()

  return (
    <div className="max-w-md space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Global display and storage preferences.</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-6">
        <SettingsForm config={config} />
      </div>
    </div>
  )
}
