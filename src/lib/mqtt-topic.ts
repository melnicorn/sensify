// Shared MQTT topic helpers used by the browse SSE stream and (later) the
// ingest field mapping: topic-filter validation and payload parsing.

export interface MqttBrowseMessage {
  topic: string
  retain: boolean
  payload: unknown // parsed JSON, or the raw string when the payload isn't JSON
  raw: string
  isJson: boolean
}

export const MQTT_MAX_PAYLOAD_CHARS = 65_536

/** Whether a string is a legal MQTT topic *filter* (may contain + and # wildcards). */
export function isValidTopicFilter(filter: string): boolean {
  if (filter.length === 0 || filter.length > 65_535) return false
  // Reject spaces, control chars and DEL. Hyphens, dots, colons etc. are all
  // valid in topic levels, so this only rejects code points <= 0x20 and 0x7f.
  for (let i = 0; i < filter.length; i++) {
    const code = filter.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f) return false
  }
  const levels = filter.split('/')
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i]!
    // '#' is multi-level: it must stand alone and be the final level
    if (level.includes('#') && (level !== '#' || i !== levels.length - 1)) return false
    // '+' is single-level: it must occupy the whole level
    if (level.includes('+') && level !== '+') return false
  }
  return true
}

/** Parse an MQTT payload as JSON, falling back to the raw string. */
export function parseMqttPayload(raw: string): { payload: unknown; isJson: boolean } {
  try {
    return { payload: JSON.parse(raw), isJson: true }
  } catch {
    return { payload: raw, isJson: false }
  }
}
