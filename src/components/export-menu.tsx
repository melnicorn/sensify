'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Download, ExternalLink, FileJson } from 'lucide-react'
import type { TimeSelection } from './sensor-chart'

const RANGE_LABELS: Record<string, string> = {
  '1h': 'past hour',
  '24h': 'past 24 hours',
  '7d': 'past 7 days',
  '30d': 'past 30 days',
}

interface Props {
  sensorId: string
  range: string
  selection: TimeSelection | null
}

/** One export scope: label plus View / Download actions on the same URL. */
function ExportRow({ label, detail, url }: { label: string; detail: string; url: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{detail}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title="View JSON in a new tab"
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <ExternalLink size={12} />
          View
        </a>
        <a
          href={`${url}${url.includes('?') ? '&' : '?'}download=1`}
          title="Download JSON file"
          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Download size={12} />
          Download
        </a>
      </div>
    </div>
  )
}

export function ExportMenu({ sensorId, range, selection }: Props) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const base = `/api/v1/sensors/${sensorId}/export`
  const fmt = (ts: number) =>
    new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border"
      >
        <FileJson size={14} />
        Export
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-80 rounded-lg border border-border bg-card shadow-lg divide-y divide-border">
          {selection && (
            <ExportRow
              label="Selection"
              detail={`${fmt(selection.from)} – ${fmt(selection.to)}`}
              url={`${base}?from=${encodeURIComponent(new Date(selection.from).toISOString())}&to=${encodeURIComponent(new Date(selection.to).toISOString())}`}
            />
          )}
          <ExportRow
            label="Current view"
            detail={RANGE_LABELS[range] ?? range}
            url={`${base}?range=${range}`}
          />
          <ExportRow label="All data" detail="every recorded reading" url={base} />
          {!selection && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Tip: drag across a chart to select a time frame to export.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
