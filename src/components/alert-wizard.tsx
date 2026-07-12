'use client'

// Create-alert wizard: fits level-rule parameters from the user's chart drag
// (fit.ts, running client-side on already-loaded readings), presents them as
// an editable sentence, and previews the rule with a 7-day backtest strip
// before saving. Fitting is UI sugar — the saved artifact is plain rule JSON.
import { useState, useEffect, useMemo, useRef, useTransition } from 'react'
import { Button, Modal } from '@heroui/react'
import { AlertTriangle } from 'lucide-react'
import { fitLevelRule, backtestRule, type BacktestEvent } from '@/lib/alerts/fit'
import {
  PATTERNS,
  derivePatternRule,
  type PatternId,
  type Sensitivity,
} from '@/lib/alerts/patterns'
import type { RuleDefinition, Agg, Op, NotifyWindow } from '@/lib/alerts/schemas'
import { hourLabel } from '@/lib/alerts/notify-window'
import type { SignalPoint } from '@/lib/alerts/machine'
import { createRuleAction } from '@/app/alerts-actions'
import { getReadingsAction } from '@/app/actions'
import type { Channel } from '@/lib/alerts/repo'
import type { MetricReading, SensorMeta, AppConfig } from '@/lib/types'
import type { TimeSelection } from './sensor-chart'
import { convertTemperature, metricDisplayInfo, metricLabel } from '@/lib/units'

const BACKTEST_RANGE = '7d'
const BACKTEST_MS = 7 * 24 * 3_600_000
const HOURS = Array.from({ length: 24 }, (_, h) => h)

interface Params {
  agg: Agg
  windowS: number
  startOp: Op
  startValue: number
  startHoldS: number
  endOp: Op
  endValue: number
  endHoldS: number
  cooldownS: number
}

interface Props {
  meta: SensorMeta
  config: AppConfig
  channels: Channel[]
  readings: MetricReading[]
  selection: TimeSelection | null // null = manual creation, no fitting
  open: boolean
  onClose: () => void
}

const selectClass =
  'rounded-md border border-input bg-card px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const numClass = `${selectClass} w-20 tabular-nums`

// Left-to-right slider order: the further right, the more easily it fires
const SENSITIVITIES: Sensitivity[] = ['low', 'medium', 'high']
const SENSITIVITY_LABEL: Record<Sensitivity, string> = {
  low: 'Low — only extreme deviations',
  medium: 'Medium',
  high: 'High — fires on small deviations',
}

const GLYPHS: Record<PatternId, string> = {
  pulse: '0,34 40,34 44,10 52,14 60,8 70,15 80,9 92,13 100,8 108,12 112,34 160,34',
  spike: '0,28 30,26 50,29 66,27 76,8 86,5 96,9 106,26 130,28 160,27',
  dip: '0,12 30,14 50,11 66,13 76,32 86,35 96,31 106,14 130,12 160,13',
  'rise-hold': '0,34 60,34 66,10 100,9 130,11 160,10',
  'fall-hold': '0,10 60,9 66,33 100,34 130,33 160,34',
}

function PatternGlyph({ id }: { id: PatternId }) {
  return (
    <svg viewBox="0 0 160 40" className="w-full text-primary" aria-hidden="true">
      <polyline fill="none" stroke="currentColor" strokeWidth={2.5} points={GLYPHS[id]} />
    </svg>
  )
}

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60_000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export function AlertWizard({ meta, config, channels, readings, selection, open, onClose }: Props) {
  const metrics = useMemo(() => [...new Set(readings.map((r) => r.metric))].sort(), [readings])
  // Default to the metric where the selection stands out most from baseline
  const [metric, setMetric] = useState(() => {
    let best = metrics[0] ?? ''
    if (!selection) return best
    let bestScore = -Infinity
    for (const m of metrics) {
      const pts = readings
        .filter((r) => r.metric === m)
        .map((r) => ({ tsMs: Date.parse(r.ts), value: r.value }))
      const fit = fitLevelRule(pts, { fromMs: selection.from, toMs: selection.to }, m)
      if ('error' in fit) continue
      const { baselineLevel, activeLevel } = fit.diagnostics
      const score = Math.abs(activeLevel - baselineLevel) / Math.max(Math.abs(baselineLevel), 1e-6)
      if (score > bestScore) {
        bestScore = score
        best = m
      }
    }
    return best
  })
  const [params, setParams] = useState<Params | null>(null)
  const [fitError, setFitError] = useState<string | null>(null)
  const [pattern, setPattern] = useState<PatternId | null>(null)
  const [sensitivity, setSensitivity] = useState<Sensitivity>('medium')
  const [derivedThreshold, setDerivedThreshold] = useState<number | null>(null)
  const [notifyStart, setNotifyStart] = useState(true)
  const [notifyEnd, setNotifyEnd] = useState(true)
  const [name, setName] = useState('')
  const [onStart, setOnStart] = useState('')
  const [onEnd, setOnEnd] = useState('')
  const [selectedChannels, setSelectedChannels] = useState<string[]>([])
  const [windowMode, setWindowMode] = useState<'always' | NotifyWindow['mode']>('always')
  const [windowFromH, setWindowFromH] = useState(22)
  const [windowToH, setWindowToH] = useState(7)
  const [history, setHistory] = useState<SignalPoint[] | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Temperatures are stored °C; the wizard edits values in the display unit
  const { isTemp, unit: unitLabel } = metricDisplayInfo(meta, config, metric)
  const toDisplay = (v: number) =>
    parseFloat((isTemp ? convertTemperature(v, 'C', config.temperatureUnit) : v).toFixed(2))
  const fromDisplay = (v: number) => (isTemp ? convertTemperature(v, config.temperatureUnit, 'C') : v)

  const points = useMemo<SignalPoint[]>(
    () =>
      readings
        .filter((r) => r.metric === metric)
        .map((r) => ({ tsMs: Date.parse(r.ts), value: r.value })),
    [readings, metric]
  )

  // Seed parameters once per (metric, selection, pattern, sensitivity) while
  // open: fit from the dragged example, derive from a chosen pattern, or fall
  // back to plain defaults. Keyed so live chart refreshes can't clobber the
  // user's in-progress edits.
  const seededKey = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      seededKey.current = null
      return
    }
    if (!metric) return
    const key = selection
      ? `sel:${metric}:${selection.from}:${selection.to}`
      : `pat:${metric}:${pattern ?? 'none'}:${sensitivity}`
    if (seededKey.current === key) return
    seededKey.current = key
    setDerivedThreshold(null)

    if (selection) {
      const fit = fitLevelRule(points, { fromMs: selection.from, toMs: selection.to }, metric)
      if ('error' in fit) {
        setFitError(fit.error)
        setParams(null)
        return
      }
      setFitError(null)
      setParams({
        agg: fit.trigger.signal.agg,
        windowS: fit.trigger.signal.windowS,
        startOp: fit.trigger.start.op,
        startValue: fit.trigger.start.value,
        startHoldS: fit.trigger.start.holdS,
        endOp: fit.trigger.end!.op,
        endValue: fit.trigger.end!.value,
        endHoldS: fit.trigger.end!.holdS,
        cooldownS: fit.cooldownS,
      })
      setName(`${metricLabel(metric)} event`)
      return
    }

    if (pattern) {
      const spec = PATTERNS.find((p) => p.id === pattern)!
      const derived = derivePatternRule(points, pattern, sensitivity, metric)
      if ('error' in derived) {
        setFitError(derived.error)
        setParams(null)
        return
      }
      setFitError(null)
      setDerivedThreshold(derived.diagnostics.threshold)
      setParams({
        agg: derived.trigger.signal.agg,
        windowS: derived.trigger.signal.windowS,
        startOp: derived.trigger.start.op,
        startValue: derived.trigger.start.value,
        startHoldS: derived.trigger.start.holdS,
        endOp: derived.trigger.end!.op,
        endValue: derived.trigger.end!.value,
        endHoldS: derived.trigger.end!.holdS,
        cooldownS: derived.cooldownS,
      })
      setNotifyEnd(derived.notifyEnd)
      setName(`${metricLabel(metric)} ${spec.label.toLowerCase()}`)
      return
    }

    const latest = points[points.length - 1]?.value ?? 0
    setFitError(null)
    setParams({
      agg: 'avg',
      windowS: 60,
      startOp: '>',
      startValue: parseFloat(latest.toFixed(1)),
      startHoldS: 60,
      endOp: '<=',
      endValue: parseFloat(latest.toFixed(1)),
      endHoldS: 120,
      cooldownS: 300,
    })
    setName(`${metricLabel(metric)} threshold`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, metric, points, selection?.from, selection?.to, pattern, sensitivity])

  // 7-day history for the backtest strip, fetched once per metric
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setHistory(null)
    getReadingsAction(meta.id, BACKTEST_RANGE)
      .then((data) => {
        if (cancelled) return
        setHistory(
          data
            .filter((r) => r.metric === metric)
            .map((r) => ({ tsMs: Date.parse(r.ts), value: r.value }))
        )
      })
      .catch(() => !cancelled && setHistory([]))
    return () => {
      cancelled = true
    }
  }, [open, meta.id, metric])

  const definition = useMemo<RuleDefinition | null>(() => {
    if (!params) return null
    return {
      v: 1,
      trigger: {
        kind: 'level',
        metric,
        signal: { agg: params.agg, windowS: params.windowS },
        start: { op: params.startOp, value: params.startValue, holdS: params.startHoldS },
        end: { op: params.endOp, value: params.endValue, holdS: params.endHoldS },
      },
      cooldownS: params.cooldownS,
      notify: {
        ...(notifyStart ? (onStart.trim() ? { onStart: onStart.trim() } : {}) : { onStart: null }),
        ...(notifyEnd ? (onEnd.trim() ? { onEnd: onEnd.trim() } : {}) : { onEnd: null }),
      },
      ...(windowMode !== 'always'
        ? { notifyWindow: { mode: windowMode, fromH: windowFromH, toH: windowToH } }
        : {}),
    }
  }, [params, metric, onStart, onEnd, notifyStart, notifyEnd, windowMode, windowFromH, windowToH])

  const backtest = useMemo<BacktestEvent[] | null>(() => {
    if (!definition || history === null) return null
    return backtestRule(definition, history)
  }, [definition, history])

  function save() {
    if (!definition) return
    setSaveError(null)
    startTransition(async () => {
      const result = await createRuleAction({
        sensorId: meta.id,
        name,
        definition,
        channelIds: selectedChannels,
      })
      if (result.error) setSaveError(result.error)
      else onClose()
    })
  }

  const set = (patch: Partial<Params>) => setParams((p) => (p ? { ...p, ...patch } : p))

  return (
    <Modal isOpen={open} onOpenChange={(v) => !v && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          {/* max-h-full lets the dialog shrink to the viewport so the body's
              built-in scroll-inside behavior engages on small screens */}
          <Modal.Dialog className="max-h-full">
            <Modal.Header>
              <Modal.Heading>{selection ? 'New alert from selection' : 'New alert'}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="space-y-4">
              <div className="flex items-center gap-2">
                <label className="text-sm text-muted-foreground">Metric</label>
                <select value={metric} onChange={(e) => setMetric(e.target.value)} className={selectClass}>
                  {metrics.map((m) => (
                    <option key={m} value={m}>
                      {metricLabel(m)}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">
                  {selection
                    ? `fitted from ${new Date(selection.from).toLocaleString()} – ${new Date(selection.to).toLocaleString()}`
                    : 'tip: drag on the chart first and Sensify will fit these values for you'}
                </span>
              </div>

              {!selection && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                    {PATTERNS.map((spec) => (
                      <button
                        key={spec.id}
                        onClick={() => setPattern(spec.id)}
                        title={spec.blurb}
                        className={`rounded-md border p-2 text-left transition-colors ${
                          pattern === spec.id
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-primary/60'
                        }`}
                      >
                        <PatternGlyph id={spec.id} />
                        <span className="block text-xs text-foreground mt-1 leading-tight">
                          {spec.label}
                        </span>
                      </button>
                    ))}
                  </div>
                  {pattern && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground shrink-0">Sensitivity</span>
                      <input
                        type="range"
                        min={0}
                        max={2}
                        step={1}
                        value={SENSITIVITIES.indexOf(sensitivity)}
                        onChange={(e) =>
                          setSensitivity(SENSITIVITIES[parseInt(e.target.value, 10)]!)
                        }
                        className="flex-1"
                        aria-label="Sensitivity"
                      />
                      <span className="text-xs text-foreground shrink-0">
                        {SENSITIVITY_LABEL[sensitivity]}
                        {derivedThreshold !== null &&
                          ` · fires ${params?.startOp === '<' || params?.startOp === '<=' ? 'below' : 'above'} ${toDisplay(derivedThreshold)}${unitLabel ? ` ${unitLabel}` : ''}`}
                      </span>
                    </div>
                  )}
                  {pattern && (
                    <p className="text-xs text-muted-foreground">
                      Derived from this sensor’s recorded history (median + k·MAD). Fine-tune below
                      and check the backtest.
                    </p>
                  )}
                </div>
              )}

              {fitError && (
                <p className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={14} className="shrink-0" /> {fitError}
                </p>
              )}

              {params && (
                <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2 text-sm leading-8">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground">Start when</span>
                    <select
                      value={params.agg}
                      onChange={(e) => set({ agg: e.target.value as Agg })}
                      className={selectClass}
                    >
                      <option value="avg">average</option>
                      <option value="min">minimum</option>
                      <option value="max">maximum</option>
                      <option value="last">latest value</option>
                    </select>
                    <span className="text-muted-foreground">over</span>
                    <select
                      value={params.windowS}
                      onChange={(e) => set({ windowS: parseInt(e.target.value, 10) })}
                      className={selectClass}
                    >
                      <option value={0}>single reading</option>
                      <option value={30}>30 s</option>
                      <option value={60}>1 min</option>
                      <option value={120}>2 min</option>
                      <option value={180}>3 min</option>
                      <option value={300}>5 min</option>
                    </select>
                    <span className="text-muted-foreground">is</span>
                    <select
                      value={params.startOp}
                      onChange={(e) => set({ startOp: e.target.value as Op })}
                      className={selectClass}
                    >
                      <option value=">">&gt;</option>
                      <option value=">=">&ge;</option>
                      <option value="<">&lt;</option>
                      <option value="<=">&le;</option>
                    </select>
                    <input
                      type="number"
                      step="any"
                      value={toDisplay(params.startValue)}
                      onChange={(e) => set({ startValue: fromDisplay(parseFloat(e.target.value) || 0) })}
                      className={numClass}
                    />
                    {unitLabel && <span className="text-muted-foreground">{unitLabel}</span>}
                    <span className="text-muted-foreground">holding for</span>
                    <input
                      type="number"
                      min={0}
                      value={params.startHoldS}
                      onChange={(e) => set({ startHoldS: parseInt(e.target.value, 10) || 0 })}
                      className={numClass}
                    />
                    <span className="text-muted-foreground">s</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-muted-foreground">End when it stays</span>
                    <select
                      value={params.endOp}
                      onChange={(e) => set({ endOp: e.target.value as Op })}
                      className={selectClass}
                    >
                      <option value=">">&gt;</option>
                      <option value=">=">&ge;</option>
                      <option value="<">&lt;</option>
                      <option value="<=">&le;</option>
                    </select>
                    <input
                      type="number"
                      step="any"
                      value={toDisplay(params.endValue)}
                      onChange={(e) => set({ endValue: fromDisplay(parseFloat(e.target.value) || 0) })}
                      className={numClass}
                    />
                    {unitLabel && <span className="text-muted-foreground">{unitLabel}</span>}
                    <span className="text-muted-foreground">for</span>
                    <input
                      type="number"
                      min={0}
                      value={params.endHoldS}
                      onChange={(e) => set({ endHoldS: parseInt(e.target.value, 10) || 0 })}
                      className={numClass}
                    />
                    <span className="text-muted-foreground">s · re-arm after</span>
                    <input
                      type="number"
                      min={0}
                      value={params.cooldownS}
                      onChange={(e) => set({ cooldownS: parseInt(e.target.value, 10) || 0 })}
                      className={numClass}
                    />
                    <span className="text-muted-foreground">s</span>
                  </div>
                </div>
              )}

              {params && (
                <div className="space-y-1">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Backtest · last 7 days</span>
                    {backtest === null ? (
                      <span className="text-xs text-muted-foreground">loading…</span>
                    ) : (
                      <span
                        className={`text-xs ${backtest.length === 0 || backtest.length > 20 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}
                      >
                        {backtest.length === 0
                          ? 'would not have fired — check the threshold'
                          : `${backtest.length} event${backtest.length === 1 ? '' : 's'}${
                              backtest.length > 20 ? ' — this may be noisy' : ''
                            } · ${backtest
                              .filter((e) => e.endMs)
                              .map((e) => fmtDuration(e.endMs! - e.startMs))
                              .slice(0, 6)
                              .join(', ')}`}
                      </span>
                    )}
                  </div>
                  <svg viewBox="0 0 600 14" className="w-full h-3.5" preserveAspectRatio="none">
                    <rect x="0" y="4" width="600" height="6" rx="3" className="fill-muted" />
                    {(backtest ?? []).map((e, i) => {
                      const now = Date.now()
                      const x = Math.max(0, ((e.startMs - (now - BACKTEST_MS)) / BACKTEST_MS) * 600)
                      const w = Math.max(
                        3,
                        (((e.endMs ?? now) - e.startMs) / BACKTEST_MS) * 600
                      )
                      return (
                        <rect key={i} x={x} y="2" width={Math.min(w, 600 - x)} height="10" rx="2" className="fill-primary" />
                      )
                    })}
                  </svg>
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Alert name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={128}
                  className={`${selectClass} w-full`}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={notifyStart}
                      onChange={(e) => setNotifyStart(e.target.checked)}
                    />
                    Start message
                  </label>
                  <input
                    value={onStart}
                    onChange={(e) => setOnStart(e.target.value)}
                    placeholder="▶ {metric} is {value} on {sensor}"
                    maxLength={500}
                    disabled={!notifyStart}
                    className={`${selectClass} w-full ${notifyStart ? '' : 'opacity-50'}`}
                  />
                </div>
                <div className="space-y-1">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <input
                      type="checkbox"
                      checked={notifyEnd}
                      onChange={(e) => setNotifyEnd(e.target.checked)}
                    />
                    End message
                  </label>
                  <input
                    value={onEnd}
                    onChange={(e) => setOnEnd(e.target.value)}
                    placeholder="✅ Finished after {duration} — {metric} peaked at {max}"
                    maxLength={500}
                    disabled={!notifyEnd}
                    className={`${selectClass} w-full ${notifyEnd ? '' : 'opacity-50'}`}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Variables: {'{sensor} {metric} {value} {min} {max} {avg} {duration} {started_at}'}
              </p>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Notify</label>
                {channels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No channels configured — add one in Settings. The alert will still log events.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {channels.map((c) => (
                      <label key={c.id} className="flex items-center gap-1.5 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={selectedChannels.includes(c.id)}
                          onChange={(e) =>
                            setSelectedChannels((ids) =>
                              e.target.checked ? [...ids, c.id] : ids.filter((i) => i !== c.id)
                            )
                          }
                        />
                        {c.name}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Delivery hours</label>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={windowMode}
                    onChange={(e) => setWindowMode(e.target.value as typeof windowMode)}
                    className={selectClass}
                  >
                    <option value="always">Send any time</option>
                    <option value="allow">Send only between</option>
                    <option value="block">Don&apos;t send between</option>
                  </select>
                  {windowMode !== 'always' && (
                    <>
                      <select
                        value={windowFromH}
                        onChange={(e) => setWindowFromH(parseInt(e.target.value, 10))}
                        className={selectClass}
                        aria-label="From hour"
                      >
                        {HOURS.map((h) => (
                          <option key={h} value={h}>
                            {hourLabel(h)}
                          </option>
                        ))}
                      </select>
                      <span className="text-sm text-muted-foreground">and</span>
                      <select
                        value={windowToH}
                        onChange={(e) => setWindowToH(parseInt(e.target.value, 10))}
                        className={selectClass}
                        aria-label="To hour"
                      >
                        {HOURS.map((h) => (
                          <option key={h} value={h}>
                            {hourLabel(h)}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
                {windowMode !== 'always' && (
                  <p className="text-xs text-muted-foreground">
                    Server time{windowToH <= windowFromH ? ', spanning midnight' : ''}. Events are
                    still detected and logged outside these hours — only notifications are held
                    back.
                  </p>
                )}
              </div>
            </Modal.Body>
            <Modal.Footer className="flex items-center justify-end gap-2">
              {saveError && <span className="text-sm text-destructive mr-auto">{saveError}</span>}
              <Button variant="ghost" size="sm" onPress={onClose} isDisabled={isPending}>
                Cancel
              </Button>
              <Button size="sm" onPress={save} isDisabled={isPending || !definition || !name.trim()}>
                {isPending ? 'Saving…' : 'Save alert'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
