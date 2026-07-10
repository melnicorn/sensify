'use client'

import { useState, useEffect, useActionState } from 'react'
import { Pencil, MapPin, Tag, Cpu, FileText } from 'lucide-react'
import { Button, Modal } from '@heroui/react'
import type { SensorMeta } from '@/lib/types'

interface Props {
  meta: SensorMeta
  editAction: (
    prev: { error?: string; success?: boolean } | null,
    formData: FormData
  ) => Promise<{ error?: string; success?: boolean }>
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  )
}

export function SensorMetaPanel({ meta, editAction }: Props) {
  const [open, setOpen] = useState(false)
  const [state, formAction, isPending] = useActionState(editAction, null)

  useEffect(() => {
    if (state?.success) setOpen(false)
  }, [state?.success])

  const locationParts = [meta.location, meta.zone].filter(Boolean)
  const hasAnyMeta = locationParts.length > 0 || meta.floor != null || meta.hardware || meta.description || (meta.tags?.length ?? 0) > 0

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Details</h2>
        <Button variant="ghost" size="sm" isIconOnly aria-label="Edit metadata" onPress={() => setOpen(true)}>
          <Pencil size={14} />
        </Button>
      </div>

      {hasAnyMeta ? (
        <dl className="space-y-2">
          {locationParts.length > 0 && (
            <div className="flex items-start gap-2">
              <MapPin size={13} className="text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <dd className="text-sm text-foreground">{locationParts.join(' · ')}</dd>
                {meta.floor != null && (
                  <dd className="text-xs text-muted-foreground">Floor {meta.floor}</dd>
                )}
              </div>
            </div>
          )}
          {meta.hardware && (
            <div className="flex items-start gap-2">
              <Cpu size={13} className="text-muted-foreground mt-0.5 shrink-0" />
              <dd className="text-sm text-foreground">{meta.hardware}</dd>
            </div>
          )}
          {meta.description && (
            <div className="flex items-start gap-2">
              <FileText size={13} className="text-muted-foreground mt-0.5 shrink-0" />
              <dd className="text-sm text-foreground">{meta.description}</dd>
            </div>
          )}
          {(meta.tags?.length ?? 0) > 0 && (
            <div className="flex items-start gap-2">
              <Tag size={13} className="text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex flex-wrap gap-1">
                {meta.tags!.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">No details configured — click the edit button to add.</p>
      )}

      <Modal isOpen={open} onOpenChange={setOpen}>
        <Modal.Backdrop isDismissable={!isPending}>
          <Modal.Container size="sm">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Edit sensor details</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <form id="meta-form" action={formAction} className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground" htmlFor="name">Display name</label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      required
                      defaultValue={meta.name}
                      className="w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground" htmlFor="location">Location</label>
                      <input
                        id="location"
                        name="location"
                        type="text"
                        defaultValue={meta.location ?? ''}
                        placeholder="Living Room"
                        className="w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-foreground" htmlFor="floor">Floor</label>
                      <input
                        id="floor"
                        name="floor"
                        type="number"
                        defaultValue={meta.floor ?? ''}
                        placeholder="1"
                        className="w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground" htmlFor="zone">Zone</label>
                    <input
                      id="zone"
                      name="zone"
                      type="text"
                      defaultValue={meta.zone ?? ''}
                      placeholder="Indoor, HVAC, Garage…"
                      className="w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground" htmlFor="hardware">Hardware</label>
                    <input
                      id="hardware"
                      name="hardware"
                      type="text"
                      defaultValue={meta.hardware ?? ''}
                      placeholder="Pico W + DHT22"
                      className="w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground" htmlFor="description">Notes</label>
                    <textarea
                      id="description"
                      name="description"
                      rows={2}
                      defaultValue={meta.description ?? ''}
                      placeholder="Near north window…"
                      className="w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground" htmlFor="tags">Tags</label>
                    <input
                      id="tags"
                      name="tags"
                      type="text"
                      defaultValue={meta.tags?.join(', ') ?? ''}
                      placeholder="climate, hvac-zone-1"
                      className="w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <p className="text-xs text-muted-foreground">Comma-separated</p>
                  </div>
                  {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
                </form>
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" isDisabled={isPending} onPress={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" form="meta-form" size="sm" isDisabled={isPending}>
                  {isPending ? 'Saving…' : 'Save'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  )
}
