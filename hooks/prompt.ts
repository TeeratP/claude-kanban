import type { EngineInterface } from 'claude-code'

import type { KanbanCard, KanbanPrompt, KanbanSetup } from '../types'
import { noteCardPrompt } from './activity'
import { errorMessage } from './model'
import { S } from './strings'

function promptFor(prompt: KanbanPrompt, card: KanbanCard): string {
  switch (prompt) {
    case 'work':
      return S.workPrompt(card.number, card.title)
    case 'resume':
      return S.resumePrompt(card.number)
    case 'answer':
      return S.answerPrompt(card.number)
  }
}

/** Asks Claude to take up a card: to work on it, to resume it after feedback, or to go on after an answer. */
export function submitPrompt(
  $: EngineInterface,
  card: KanbanCard,
  prompt: KanbanPrompt,
): void {
  const text = promptFor(prompt, card)
  // The turn this prompt starts belongs to the card.
  noteCardPrompt(card.id, text)
  $.prompt
    .submit({ text })
    .catch((error: unknown) => $.ui.log(S.promptFailed(errorMessage(error))))
}

/** Asks Claude to set GitHub up for the board: what `setup` says is missing, and what else may be. */
export function askSetup($: EngineInterface, setup: KanbanSetup): void {
  $.prompt
    .submit({ text: S.setupPrompt(setup.step, setup.reason) })
    .then(() => $.ui.toast(S.setupAsked))
    .catch((error: unknown) => $.ui.log(S.promptFailed(errorMessage(error))))
}
