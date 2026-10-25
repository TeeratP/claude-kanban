import type { EngineInterface } from 'claude-code'

import type { KanbanCard } from '../types'
import { updateQuickAdd, updateSync, updateUi } from './atoms'
import { createCard } from './backend'
import { ensureBackend, inBackground, refresh, setBoard } from './board'
import { sectionList } from './layout'
import { EMPTY_QUICK_ADD, errorMessage, withCard } from './model'
import { S } from './strings'
import { ensureTicker, expireLater } from './sync'

// A card shown before its backend has made it has no number or file yet.
const PENDING_PREFIX = 'new:'
let added = 0

type Field = 'title' | 'spec'

/** Opens the add-a-card form, or closes it when it is open. */
export function toggleQuickAdd($: EngineInterface) {
  return updateQuickAdd($, form =>
    form.isOpen ? EMPTY_QUICK_ADD : { ...EMPTY_QUICK_ADD, isOpen: true },
  )
}

export function closeQuickAdd($: EngineInterface) {
  return updateQuickAdd($, () => EMPTY_QUICK_ADD)
}

export function showQuickAddDetails($: EngineInterface) {
  return updateQuickAdd($, form => ({ ...form, hasDetails: true }))
}

/** Keeps what has been typed, so a redraw does not lose it. */
export function typeInQuickAdd(
  $: EngineInterface,
  field: Field,
  value: string,
) {
  return updateQuickAdd($, form =>
    form.isOpen ? { ...form, [field]: value } : form,
  )
}

/** The title on one line: a card title never wraps. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * Adds the card the form describes: Enter in `field`, whose whole text is
 * `value`. The form closes and the card shows at once, marked ⟳ until the
 * backend has made it. An empty title is refused and the form stays open.
 */
export async function submitQuickAdd(
  $: EngineInterface,
  field: Field,
  value: string,
): Promise<void> {
  // Read and closed in one step, so a second Enter cannot add the card twice.
  const seen = { isOpen: false, title: '', spec: '' }
  await updateQuickAdd($, form => {
    const typed = { title: form.title, spec: form.spec, [field]: value }
    seen.isOpen = form.isOpen
    seen.title = oneLine(typed.title)
    seen.spec = typed.spec.trim()

    return form.isOpen && seen.title !== '' ? EMPTY_QUICK_ADD : form
  })
  if (!seen.isOpen) return

  if (seen.title === '') {
    $.ui.toast(S.addNeedsTitle)

    return
  }
  await addCard($, seen.title, seen.spec)
}

async function addCard(
  $: EngineInterface,
  title: string,
  spec: string,
): Promise<void> {
  const now = await $.clock.now()
  added += 1
  const id = `${PENDING_PREFIX}${now}-${added}`
  const at = new Date(now).toISOString()
  const pending: KanbanCard = {
    id,
    number: 0,
    title,
    column: 'backlog',
    order: 0,
    createdAt: at,
    updatedAt: at,
  }

  await updateSync($, sync => ({
    ...sync,
    [id]: {
      cardId: id,
      from: 'backlog',
      to: 'backlog',
      phase: 'pending',
      attempts: 1,
    },
  }))
  ensureTicker($)
  const board = await setBoard($, current => ({
    ...current,
    cards: withCard(current.cards, pending),
  }))
  // The card goes last in Backlog: open the section and scroll it into view.
  const total = sectionList(board.cards, 'backlog').length
  await updateUi($, ui => ({
    ...ui,
    collapsed: { ...ui.collapsed, backlog: false },
    offsets: { ...ui.offsets, backlog: total },
  }))

  let created: KanbanCard
  try {
    created = await createCard(
      $,
      await ensureBackend($),
      title,
      spec,
      'backlog',
    )
  } catch (error) {
    await snapOut($, id, { title, spec }, errorMessage(error))

    return
  }

  const settledAt = await $.clock.now()
  await setBoard($, current => ({
    ...current,
    cards: withCard(current.cards, created, id),
  }))
  await updateSync($, sync => {
    const { [id]: _pending, ...rest } = sync

    return {
      ...rest,
      [created.id]: {
        cardId: created.id,
        from: 'backlog',
        to: 'backlog',
        phase: 'ok',
        attempts: 1,
        settledAt,
      },
    }
  })
  expireLater($, created.id, settledAt, settledAt)
  // A load in flight may have read before the card existed.
  inBackground($, refresh($))
}

// The backend refused: the card goes, the reason is told, and what was typed
// comes back in the form unless the person has opened it again meanwhile.
async function snapOut(
  $: EngineInterface,
  id: string,
  typed: { title: string; spec: string },
  reason: string,
): Promise<void> {
  await setBoard($, board => ({
    ...board,
    cards: board.cards.filter(one => one.id !== id),
  }))
  await updateSync($, sync => {
    const { [id]: _pending, ...rest } = sync

    return rest
  })
  await updateQuickAdd($, form =>
    form.isOpen
      ? form
      : { ...typed, isOpen: true, hasDetails: typed.spec !== '' },
  )
  $.ui.toast(S.addFailed(reason))
  // An issue may have been made before the failure: show what is really there.
  inBackground($, refresh($))
}

/**
 * Drops the cards a reload left waiting for a backend that is no longer being
 * asked: their request died with the old copy. A load shows any that were made.
 */
export async function dropUnfinishedAdds($: EngineInterface): Promise<void> {
  const gone = new Set<string>()
  await updateSync($, sync => {
    gone.clear()
    const kept: typeof sync = {}
    for (const [id, entry] of Object.entries(sync)) {
      if (id.startsWith(PENDING_PREFIX) && entry.phase === 'pending')
        gone.add(id)
      else kept[id] = entry
    }

    return gone.size === 0 ? sync : kept
  })
  if (gone.size === 0) return

  await setBoard($, board => ({
    ...board,
    cards: board.cards.filter(one => !gone.has(one.id)),
  }))
  inBackground($, refresh($))
}
