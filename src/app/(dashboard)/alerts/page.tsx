import { listRules, listRecentEvents } from '@/lib/alerts/repo'
import { buildRuleViews } from '@/lib/alerts/views'
import { getDb } from '@/lib/db'
import { AlertRulesList } from '@/components/alert-rules-list'

export const dynamic = 'force-dynamic'

function fmtDuration(fromIso: string, toIso: string): string {
  const mins = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export default async function AlertsPage() {
  const rules = await listRules()
  const [views, events] = await Promise.all([buildRuleViews(rules), listRecentEvents(50)])
  const ruleName = new Map(rules.map((r) => [r.id, r.name]))
  const db = getDb()
  const sensorNameForRule = new Map(
    rules.map((r) => {
      const sensor = db.prepare('SELECT name FROM sensors WHERE id = ?').get(r.sensorId) as
        | { name: string }
        | undefined
      return [r.id, sensor?.name ?? r.sensorId]
    })
  )

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">Alerts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Alert rules across all sensors, and recent events they detected.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground mb-2">Rules</h2>
        <AlertRulesList rules={views} showSensor />
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground mb-3">Recent events</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No events recorded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="pb-2 pr-4 font-medium">Rule</th>
                <th className="pb-2 pr-4 font-medium">Sensor</th>
                <th className="pb-2 pr-4 font-medium">Started</th>
                <th className="pb-2 pr-4 font-medium">Duration</th>
                <th className="pb-2 font-medium">Peak</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((e) => (
                <tr key={e.id} className="text-foreground">
                  <td className="py-2 pr-4">{ruleName.get(e.ruleId) ?? '(deleted rule)'}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {sensorNameForRule.get(e.ruleId) ?? ''}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {new Date(e.startedAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-4 tabular-nums">
                    {e.endedAt ? fmtDuration(e.startedAt, e.endedAt) : 'ongoing'}
                  </td>
                  <td className="py-2 tabular-nums">{e.stats ? e.stats.max : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
