'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@heroui/react'
import { Radio } from 'lucide-react'

interface Props {
  desiredInterval: number | null | undefined
  setAction: (
    prev: { error?: string; success?: boolean } | null,
    formData: FormData
  ) => Promise<{ error?: string; success?: boolean }>
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" isDisabled={pending}>
      {pending ? 'Saving…' : 'Set'}
    </Button>
  )
}

export function SensorIntervalForm({ desiredInterval, setAction }: Props) {
  const [state, formAction] = useActionState(setAction, null)

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Radio size={14} className="text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">Remote config</h2>
      </div>

      <form action={formAction} className="space-y-3">
        <div className="space-y-1">
          <label htmlFor="interval" className="text-xs font-medium text-foreground">
            Reporting interval (seconds)
          </label>
          <div className="flex items-center gap-2">
            <input
              id="interval"
              name="interval"
              type="number"
              min={5}
              max={86400}
              defaultValue={desiredInterval ?? ''}
              placeholder="e.g. 60"
              className="w-28 rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <SubmitButton />
            {desiredInterval != null && (
              <span className="text-xs text-muted-foreground">currently set to {desiredInterval}s</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Delivered to the device on its next successful POST. Leave blank to let the device use its own default.
          </p>
        </div>
        {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
        {state?.success && <p className="text-xs text-green-600 dark:text-green-400">Saved — device will pick it up on next reading.</p>}
      </form>
    </div>
  )
}
