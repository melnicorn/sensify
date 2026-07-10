// Next.js-facing data access. The 'server-only' guard prevents accidental
// client-bundle inclusion; the poller process imports ./repo directly.
import 'server-only'

export * from './repo'
