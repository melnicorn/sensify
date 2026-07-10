'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@heroui/react'
import { updateConfigAction } from '@/app/actions'
import type { AppConfig } from '@/lib/types'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" isDisabled={pending} size="sm">
      {pending ? 'Saving…' : 'Save Settings'}
    </Button>
  )
}

export function SettingsForm({ config }: { config: AppConfig }) {
  const [state, formAction] = useActionState(updateConfigAction, null)

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-1.5">
        <label htmlFor="temperatureUnit" className="text-sm font-medium text-foreground">
          Temperature unit
        </label>
        <select
          id="temperatureUnit"
          name="temperatureUnit"
          defaultValue={config.temperatureUnit}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="F">Fahrenheit (°F)</option>
          <option value="C">Celsius (°C)</option>
          <option value="K">Kelvin (K)</option>
        </select>
        <p className="text-xs text-muted-foreground">
          All temperature values will be displayed in this unit regardless of how they were submitted.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="truncationDays" className="text-sm font-medium text-foreground">
          Data retention (days)
        </label>
        <input
          id="truncationDays"
          name="truncationDays"
          type="number"
          min={1}
          max={365}
          defaultValue={config.truncationDays}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <p className="text-xs text-muted-foreground">
          Readings older than this many days are deleted on the next write from that sensor.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
        {state?.success && (
          <span className="text-sm text-green-600 dark:text-green-400">Settings saved.</span>
        )}
        {state?.error && <span className="text-sm text-destructive">{state.error}</span>}
      </div>
    </form>
  )
}
