import type { Register } from 'claude-code'

import { restoreActivity, watchSpawn, watchStep } from './activity'
import { readUi } from './atoms'
import { backendMode } from './backend'
import { describeBackend, guardBackend } from './backend-config'
import {
  applyMode,
  bootstrap,
  inBackground,
  noteClosed,
  openBoard,
  refreshAfter,
} from './board'
import { guardEdit, guardWrite } from './guard'
import { backlogSection } from './guide'
import { applyQueue, claudeLimit } from './queue'
import { dropUnfinishedAdds } from './quick-add'
import { followSettings, resumeSettings } from './settings'
import {
  reconcileOn,
  reconcileToolCall,
  reconcileTurnEnd,
  reconcileTurnStart,
} from './reconcile'
import { S } from './strings'
import { restoreSuggestions, withSuggestSection } from './suggest'
import { resumePendingSyncs } from './sync'
import { TOOL_SPECS, runTool } from './tools'
import {
  handleBoardMessage,
  handleBoardScroll,
  renderBoard,
} from './view-board'
import { renderDetail } from './view-detail'
import { renderSettings } from './view-settings'

export const register: Register = (on, options) => {
  const mode = backendMode(options.backend)
  const limit = claudeLimit(options.claudeLimit)
  let isReconciling = reconcileOn(options.reconcile)
  // The Settings view's change counts at once; the reload it causes carries the same value.
  followSettings((field, value) => {
    if (field === 'reconcile') isReconciling = reconcileOn(value)
  })

  // Watching Claude work on a card never alters what it watches. These stand
  // first, so they wrap the tools below and see their results.
  on('tool.call', ($, e, next) =>
    reconcileToolCall($, e, next, isReconciling),
  ).catch(($, e, next) => next(e))
  on('agent.spawn', watchSpawn).catch(($, e, next) => next(e))
  on('turn.start', ($, e, next) =>
    reconcileTurnStart($, e, next, isReconciling),
  ).catch(($, e, next) => next(e))
  on('turn.step', watchStep).catch(async function* ($, e, next) {
    return yield* next(e)
  })
  on('turn.complete', ($, e, next) =>
    reconcileTurnEnd($, e, next, isReconciling),
  ).catch(($, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    await applyMode($, mode)
    await applyQueue($, mode, limit)
    await dropUnfinishedAdds($)
    await $.command.register({
      name: 'kanban',
      description: S.commandDescription,
    })
    for (const spec of TOOL_SPECS) await $.tool.register(spec)
    inBackground($, bootstrap($))
    inBackground($, resumePendingSyncs($))
    inBackground($, restoreActivity($))
    inBackground($, restoreSuggestions($))
    inBackground($, resumeSettings($))

    return next(e)
  })

  on('command.run', { command: 'kanban' }, async $ => {
    const opened = await $.ui.open({
      id: 'kanban',
      title: S.paneTitle,
      rows: 30,
      columns: 44,
    })
    inBackground($, openBoard($))

    return { text: opened.isPlaced ? S.opened : S.notPlaced(opened.reason) }
  })

  on('ui.render', { component: 'Pane', requestId: 'kanban' }, async ($, e) => {
    const { view } = await readUi($)

    if (view.mode === 'board') return renderBoard($, e)

    return view.mode === 'settings'
      ? renderSettings($, e)
      : renderDetail($, e, view)
  })

  // A close is counted before it passes on, so a retitle under way sees it.
  on('ui.close', { id: 'kanban' }, ($, e, next) => {
    noteClosed()

    return next(e)
  })

  on('ui.scroll', { requestId: 'kanban' }, async ($, e, next) =>
    (await handleBoardScroll($, e)) ? {} : next(e),
  ).catch(($, e, next) => next(e))

  // A click on a row, or a card dropped on a section or moved a place, posted by the board's Client.
  on('ui.message', { requestId: 'kanban', element: 'board' }, async ($, e) => {
    await handleBoardMessage($, e.data)

    return {}
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'mcp__kanban__kanban_list' }, ($, e) =>
    runTool($, 'kanban_list', e),
  ).catch(($, e, next) =>
    next.called ? next(e) : { deny: S.toolFailed('kanban_list') },
  )
  on('tool.call', { tool: 'mcp__kanban__kanban_move' }, ($, e) =>
    runTool($, 'kanban_move', e),
  ).catch(($, e, next) =>
    next.called ? next(e) : { deny: S.toolFailed('kanban_move') },
  )
  on('tool.call', { tool: 'mcp__kanban__kanban_show' }, ($, e) =>
    runTool($, 'kanban_show', e),
  ).catch(($, e, next) =>
    next.called ? next(e) : { deny: S.toolFailed('kanban_show') },
  )
  on('tool.call', { tool: 'mcp__kanban__kanban_handoff' }, ($, e) =>
    runTool($, 'kanban_handoff', e),
  ).catch(($, e, next) =>
    next.called ? next(e) : { deny: S.toolFailed('kanban_handoff') },
  )
  on('tool.call', { tool: 'mcp__kanban__kanban_create' }, ($, e) =>
    runTool($, 'kanban_create', e),
  ).catch(($, e, next) =>
    next.called ? next(e) : { deny: S.toolFailed('kanban_create') },
  )

  on('tool.call', { tool: 'mcp__kanban__kanban_ask' }, ($, e) =>
    runTool($, 'kanban_ask', e),
  ).catch(($, e, next) =>
    next.called ? next(e) : { deny: S.toolFailed('kanban_ask') },
  )

  on('tool.call', { tool: 'mcp__kanban__kanban_suggest' }, ($, e) =>
    runTool($, 'kanban_suggest', e),
  ).catch(($, e, next) =>
    next.called ? next(e) : { deny: S.toolFailed('kanban_suggest') },
  )

  // Tells Claude the board is the backlog and asks it to suggest follow-ups as
  // cards, in two short sections.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const sections = withSuggestSection(composed.sections, e.traits)

    return { sections: await backlogSection($, sections, e.traits) }
  }).catch(($, e, next) => next(e))

  // The GitHub backend cannot be chosen in /config while gh is missing or signed
  // out. No key is matched: a marketplace install spells the row
  // `kanban@<marketplace>.backend`, so these tell it from the rest themselves.
  on('config.set', guardBackend).catch(($, e, next) => next(e))
  on('config.describe', describeBackend).catch(($, e, next) => next(e))

  // A card file Claude wrote or edited shows on the board at once, unless the
  // edit would put a card in Human without a handoff; a guard that breaks lets
  // the edit through.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const deny = await guardWrite($, e)

    return deny === undefined ? refreshAfter($, e.file_path, next(e)) : { deny }
  }).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const deny = await guardEdit($, e)

    return deny === undefined ? refreshAfter($, e.file_path, next(e)) : { deny }
  }).catch(($, e, next) => next(e))
}
