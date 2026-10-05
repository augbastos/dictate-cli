// The text sent: what was typed before recording, then the transcript.
// Empty transcript sends nothing (null).
export function merge(base: string, transcript: string): string | null {
  const spoken = transcript.trim()
  if (spoken === '') return null
  if (base.trim() === '') return spoken
  return /\s$/.test(base) ? base + spoken : `${base} ${spoken}`
}
