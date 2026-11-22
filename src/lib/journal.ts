import { supabase } from './supabase'

// Mirrors the `journal_notes` table (see README "Journal").
// kind 'daily': one note per calendar day (`day` set, title unused).
// kind 'general': free-form notes with a title.
export interface JournalNote {
  id: string
  user_id: string
  kind: 'daily' | 'general'
  day: string | null // YYYY-MM-DD, local calendar day
  title: string | null
  body: string | null
  created_at: string
  updated_at: string
}

export async function fetchJournalNotes(): Promise<JournalNote[]> {
  const { data, error } = await supabase.from('journal_notes').select('*').order('updated_at', { ascending: false })
  if (error) throw error
  return data as JournalNote[]
}

/** Creates or replaces the daily note for a day. */
export async function saveDailyNote(day: string, body: string | null) {
  const { data, error } = await supabase
    .from('journal_notes')
    .upsert({ kind: 'daily', day, body, updated_at: new Date().toISOString() }, { onConflict: 'user_id,kind,day' })
    .select()
    .single()
  if (error) throw error
  return data as JournalNote
}

export async function createGeneralNote(title: string) {
  const { data, error } = await supabase.from('journal_notes').insert({ kind: 'general', title, body: null }).select().single()
  if (error) throw error
  return data as JournalNote
}

export async function updateJournalNote(id: string, patch: { title?: string | null; body?: string | null }) {
  const { error } = await supabase.from('journal_notes').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function deleteJournalNote(id: string) {
  const { error } = await supabase.from('journal_notes').delete().eq('id', id)
  if (error) throw error
}

/** Points at the README SQL when the table hasn't been created yet. */
export function journalError(err: unknown) {
  const msg = (err as Error)?.message ?? String(err)
  return /journal_notes/.test(msg) && /does not exist|schema cache|relation/i.test(msg)
    ? 'The journal_notes table is missing. Run the SQL under "Journal" in the README once in the Supabase SQL Editor.'
    : msg
}
