import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Rule } from './types'

// Settings → Trading Tools & Strategies. See supabase/migrations/20261123000000_trading_tools.sql.

export type LabelKind = 'setup' | 'mistake'

export interface Label { id: string; kind: LabelKind; name: string; color: string; bias_rules?: Rule[]; entry_rules?: Rule[] }
export interface TagCategory { id: string; name: string; color: string; tags: string[] }
export interface Strategy { id: string; name: string; description: string | null; rules: string[]; color: string }

export const COLORS = ['#3fd0b0', '#7c8cff', '#f5b14c', '#ff7a6b', '#e879f9', '#38bdf8', '#a3e635', '#94a3b8']

/** Trades store custom tags as "Category: tag". */
export const customTag = (category: string, tag: string) => `${category}: ${tag}`

function check<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

/** Loads all Trading Tools data; `reload` refetches after a change. */
export function useTradingTools() {
  const [labels, setLabels] = useState<Label[]>([])
  const [categories, setCategories] = useState<TagCategory[]>([])
  const [strategies, setStrategies] = useState<Strategy[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  // True until supabase/migrations/20261126000000_setup_rules.sql has been run.
  const [rulesMissing, setRulesMissing] = useState(false)

  const reload = useCallback(() => {
    const labels = async () => {
      const res = await supabase.from('trade_labels').select('id,kind,name,color,bias_rules,entry_rules').order('name')
      const missing = Boolean(res.error && /bias_rules|entry_rules/.test(res.error.message))
      setRulesMissing(missing)
      return missing ? supabase.from('trade_labels').select('id,kind,name,color').order('name') : res
    }
    Promise.all([
      labels(),
      supabase.from('tag_categories').select('id,name,color,tags').order('name'),
      supabase.from('strategies').select('id,name,description,rules,color').order('name'),
    ])
      .then(([l, c, s]) => {
        setLabels(check(l) as Label[])
        setCategories(check(c) as TagCategory[])
        setStrategies(check(s) as Strategy[])
        setError('')
      })
      .catch((e: Error) => setError(/does not exist|schema cache/i.test(e.message)
        ? 'Settings tables are missing. Run supabase/migrations/20261123000000_trading_tools.sql.'
        : e.message))
      .finally(() => setLoaded(true))
  }, [])
  useEffect(reload, [reload])

  return { labels, categories, strategies, error, loaded, rulesMissing, reload }
}

// ---------- setups & mistakes ----------

export async function addLabel(kind: LabelKind, name: string, color: string) {
  check(await supabase.from('trade_labels').insert({ kind, name: name.trim(), color }))
}

/** Saves a label definition and renames it on every trade that uses the old name. */
export async function saveLabel(kind: LabelKind, oldName: string, name: string, color: string, id?: string) {
  name = name.trim()
  if (id) check(await supabase.from('trade_labels').update({ name, color }).eq('id', id))
  else check(await supabase.from('trade_labels').upsert({ kind, name, color }, { onConflict: 'user_id,kind,name' }))
  if (name !== oldName) await renameOnTrades(kind === 'setup' ? 'tags' : 'mistakes', oldName, name)
}

/** Deletes a label and removes it from every trade. */
export async function deleteLabel(kind: LabelKind, name: string, id?: string) {
  if (id) check(await supabase.from('trade_labels').delete().eq('id', id))
  await renameOnTrades(kind === 'setup' ? 'tags' : 'mistakes', name, null)
}

async function renameOnTrades(col: 'tags' | 'mistakes' | 'custom_tags', oldValue: string, newValue: string | null) {
  check(await supabase.rpc('rename_trade_value', { col, old_value: oldValue, new_value: newValue }))
}

/** Saves a setup's Bias and Entry rules, creating the setup definition if it was only used on trades. */
export async function saveSetupRules(setup: { id?: string; name: string; color: string }, bias: Rule[], entry: Rule[]) {
  const clean = (list: Rule[]) => list.map((r) => ({ id: r.id, text: r.text.trim() })).filter((r) => r.text)
  const rules = { bias_rules: clean(bias), entry_rules: clean(entry) }
  if (setup.id) check(await supabase.from('trade_labels').update(rules).eq('id', setup.id))
  else check(await supabase.from('trade_labels').upsert({ kind: 'setup', name: setup.name, color: setup.color, ...rules }, { onConflict: 'user_id,kind,name' }))
}

export const RULES_MIGRATION_MSG = 'Trading rules need a database update. Run supabase/migrations/20261126000000_setup_rules.sql.'

// ---------- custom tag categories ----------

export async function addCategory(name: string, color: string) {
  check(await supabase.from('tag_categories').insert({ name: name.trim(), color }))
}

export async function saveCategory(cat: TagCategory, name: string, color: string) {
  name = name.trim()
  check(await supabase.from('tag_categories').update({ name, color }).eq('id', cat.id))
  if (name !== cat.name) check(await supabase.rpc('rename_tag_category', { old_name: cat.name, new_name: name }))
}

export async function deleteCategory(cat: TagCategory) {
  check(await supabase.from('tag_categories').delete().eq('id', cat.id))
  check(await supabase.rpc('rename_tag_category', { old_name: cat.name, new_name: null }))
}

export async function setCategoryTags(cat: TagCategory, tags: string[]) {
  check(await supabase.from('tag_categories').update({ tags }).eq('id', cat.id))
}

/** Removes or renames one tag inside a category, on the category and on trades. */
export async function changeCategoryTag(cat: TagCategory, oldTag: string, newTag: string | null) {
  const next = newTag == null ? cat.tags.filter((t) => t !== oldTag) : cat.tags.map((t) => (t === oldTag ? newTag : t))
  await setCategoryTags(cat, [...new Set(next)])
  await renameOnTrades('custom_tags', customTag(cat.name, oldTag), newTag == null ? null : customTag(cat.name, newTag))
}

// ---------- strategies ----------

export async function saveStrategy(s: Omit<Strategy, 'id'> & { id?: string }) {
  const row = { name: s.name.trim(), description: s.description?.trim() || null, rules: s.rules.map((r) => r.trim()).filter(Boolean), color: s.color }
  if (s.id) check(await supabase.from('strategies').update(row).eq('id', s.id))
  else check(await supabase.from('strategies').insert(row))
}

/** Trades that used it keep everything else; their strategy is cleared by the database. */
export async function deleteStrategy(id: string) {
  check(await supabase.from('strategies').delete().eq('id', id))
}

export function friendlyNameError(err: unknown) {
  const msg = (err as Error)?.message ?? String(err)
  if (/duplicate key|unique/i.test(msg)) return 'That name already exists.'
  if (/check constraint/i.test(msg)) return 'Name is empty, too long, or contains ":".'
  if (/bias_rules|entry_rules/.test(msg)) return RULES_MIGRATION_MSG
  return msg
}
