import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Chart screenshots live in a private Supabase Storage bucket, one folder per user:
//   charts/<user_id>/<random>.<ext>
// The trade row stores the object paths in its `charts` column.
const BUCKET = 'charts'
const MAX_BYTES = 10 * 1024 * 1024
const URL_TTL = 60 * 60 // signed URLs last an hour

/** Returns an error message if the file can't be used as a chart, else null. */
export function checkChartFile(file: File): string | null {
  if (!file.type.startsWith('image/')) return `${file.name || 'File'} is not an image.`
  if (file.size > MAX_BYTES) return `${file.name || 'Image'} is larger than 10 MB.`
  return null
}

export async function uploadChart(file: File): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('You need to be signed in to upload charts.')
  const ext = (file.name.split('.').pop() || file.type.split('/')[1] || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${userId}/${crypto.randomUUID()}.${ext || 'png'}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type })
  if (error) throw error
  return path
}

export async function removeCharts(paths: string[]) {
  if (paths.length === 0) return
  const { error } = await supabase.storage.from(BUCKET).remove(paths)
  if (error) throw error
}

/** Resolves storage paths to temporary viewable URLs. */
export function useChartUrls(paths: string[]) {
  const key = paths.join('|')
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    const list = key ? key.split('|') : []
    if (list.length === 0) return
    let cancelled = false
    supabase.storage
      .from(BUCKET)
      .createSignedUrls(list, URL_TTL)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) return setError(error.message)
        const map: Record<string, string> = {}
        for (const item of data ?? []) if (item.path && item.signedUrl) map[item.path] = item.signedUrl
        setUrls(map)
      })
    return () => {
      cancelled = true
    }
  }, [key])

  return { urls, error }
}
