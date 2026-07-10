'use client'

import { useState, useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Modal } from '@heroui/react'
import { deleteSensorAction } from '@/app/actions'

export function DeleteSensorButton({ sensorId, sensorName }: { sensorId: string; sensorName: string }) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    startTransition(() => deleteSensorAction(sensorId))
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => setOpen(true)}
        className="text-destructive hover:bg-destructive/10"
      >
        <Trash2 size={14} className="mr-1.5" />
        Delete all data
      </Button>

      <Modal isOpen={open} onOpenChange={setOpen}>
        <Modal.Backdrop isDismissable={!isPending}>
          <Modal.Container size="sm">
            <Modal.Dialog>
              <Modal.Header>
                <Modal.Heading>Delete sensor data?</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm text-foreground">
                  All readings and metadata for{' '}
                  <span className="font-semibold">{sensorName}</span> will be permanently deleted.
                  This cannot be undone.
                </p>
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  isDisabled={isPending}
                  onPress={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  isDisabled={isPending}
                  onPress={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isPending ? 'Deleting…' : 'Delete'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  )
}
