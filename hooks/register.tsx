import type { Register } from 'claude-code'

import { readUi } from './atoms'
import { bootstrap, inBackground, openBoard, refreshAfter } from './board'
import { S } from './strings'
import { TOOL_SPECS, runTool } from './tools'
import {
  handleBoardMessage,
  handleBoardScroll,
  renderBoard,
} from './view-board'
import { renderDetail } from './view-detail'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'kanban',
      description: S.commandDescription,
    })
    for (const spec of TOOL_SPECS) await $.tool.register(spec)
    inBackground($, bootstrap($))

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

    return view.mode === 'board' ? renderBoard($, e) : renderDetail($, e, view)
  })

  on('ui.scroll', { requestId: 'kanban' }, async ($, e, next) =>
    (await handleBoardScroll($, e)) ? {} : next(e),
  ).catch(($, e, next) => next(e))

  // A click on a row or a card dropped on a header, posted by the board's Client.
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

  // A card file Claude wrote or edited shows on the board at once.
  on('tool.call', { tool: 'Write' }, ($, e, next) =>
    refreshAfter($, e.file_path, next(e)),
  ).catch(($, e, next) => next(e))
  on('tool.call', { tool: 'Edit' }, ($, e, next) =>
    refreshAfter($, e.file_path, next(e)),
  ).catch(($, e, next) => next(e))
}
