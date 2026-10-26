import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { KanbanBoard } from '../types'
import { readBoard, readSettings } from './atoms'
import { KANBAN_DIR, cellWidth } from './model'
import { S } from './strings'
import {
  boardAction,
  changeBoardFromSettings,
  closeSettings,
  isDefault,
  optionsOf,
  setSetting,
  settingsOf,
  stepped,
  valueText,
} from './settings'
import type { Setting } from './settings'
import { localNote } from './view-board'
import { dotted, packRows, separatorWidth } from './view-parts'

// Cells a setting's controls and help stand in from its name.
const INDENT = 2

// The board the mod reads, as two short lines: where it is, then which.
function boardLines(board: KanbanBoard): [string, string | undefined] {
  const { backend, mode } = board
  if (backend === null) return [S.loading, undefined]

  const kind = S.backendLabel(mode, backend.kind, true)
  if (backend.kind === 'local') {
    return [`${kind}${S.dot}${KANBAN_DIR}/`, localNote(backend)]
  }

  return [
    `${kind}${S.dot}${backend.repo}`,
    backend.title === undefined
      ? `#${backend.projectNumber}`
      : S.boardName(backend.projectNumber, backend.title),
  ]
}

/** The Settings view: each of the mod's /config rows with its value and a way to change it, then the board. */
export async function renderSettings(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
) {
  const { Box, Button, Text } = $.ui.resolve(e)
  const settings = await readSettings($)
  const board = await readBoard($)
  const columns = e.props.bodyColumns
  const room = columns - INDENT

  // Options as plain links with the current one marked; the default one says so.
  const optionsRow = (setting: Setting) => {
    const { field, row } = setting
    const items = optionsOf(setting).map(({ text, value }) => {
      const mark = isDefault(setting, value) ? S.settingDefault : ''
      const isCurrent = value === row.value
      const label = `${isCurrent ? `${S.settingCurrent} ` : ''}${text}`

      return {
        key: text,
        width: cellWidth(label + mark),
        node: isCurrent ? (
          <Text key={`now:${field}:${text}`}>
            <Text weight="bold">{label}</Text>
            <Text dimColor>{mark}</Text>
          </Text>
        ) : (
          <Button
            key={`set:${field}:${text}`}
            plain
            onPress={() => setSetting($, row.key, value)}
          >
            <Text color="suggestion">{label}</Text>
            <Text dimColor>{mark}</Text>
          </Button>
        ),
      }
    })

    return packRows(
      items,
      one => one.width,
      room,
      separatorWidth(e.surface),
    ).map(line => (
      <Box key={`line:${field}:${line.map(one => one.key).join(':')}`}>
        {dotted(
          $,
          e,
          line.map(one => one.node),
        )}
      </Box>
    ))
  }

  // `−` and `+` around the number; `−` rests at 0.
  const numberRow = (setting: Setting) => {
    const { field, row } = setting
    const value = typeof row.value === 'number' ? row.value : 0
    const less = stepped(value, -1)
    const more = stepped(value, 1)
    const fallback =
      setting.fallback === '' ? '' : S.settingDefaultIs(setting.fallback)

    return (
      <Box key={`number:${field}`} flexDirection="row">
        {less === undefined ? (
          <Text dimColor>{`${S.settingLess} `}</Text>
        ) : (
          <Button
            key={`less:${field}`}
            plain
            label={S.settingLess}
            onPress={() => setSetting($, row.key, less)}
          >
            <Text color="suggestion">{`${S.settingLess} `}</Text>
          </Button>
        )}
        <Text weight="bold">{String(value)}</Text>
        {more !== undefined && (
          <Button
            key={`more:${field}`}
            plain
            label={S.settingMore}
            onPress={() => setSetting($, row.key, more)}
          >
            <Text color="suggestion">{` ${S.settingMore} `}</Text>
          </Button>
        )}
        <Text dimColor>{fallback}</Text>
      </Box>
    )
  }

  const settingBlock = (setting: Setting) => {
    const { field, row } = setting
    const denied = settings.denied[row.key]
    const controls = row.isLocked ? (
      <Text key={`value:${field}`} weight="bold">
        {valueText(row.value)}
      </Text>
    ) : row.kind === 'number' ? (
      numberRow(setting)
    ) : (
      <Box key={`options:${field}`} flexDirection="column">
        {optionsRow(setting)}
      </Box>
    )

    return (
      <Box key={`setting:${field}`} flexDirection="column">
        <Text wrap="truncate-end">{setting.name}</Text>
        <Box flexDirection="column" paddingLeft={INDENT}>
          {controls}
          <Text dimColor wrap="wrap">
            {S.settingHelp[field]}
          </Text>
          {row.isLocked && (
            <Text dimColor wrap="wrap">
              {S.settingLocked}
            </Text>
          )}
          {denied !== undefined && (
            <Text key={`denied:${field}`} color="error" wrap="wrap">
              {S.settingDenied(denied)}
            </Text>
          )}
        </Box>
      </Box>
    )
  }

  const boardBlock = () => {
    const [where, which] = boardLines(board)
    const action = boardAction(board)

    return (
      <Box key="board" flexDirection="column">
        <Text>{S.boardHeading}</Text>
        <Box flexDirection="column" paddingLeft={INDENT}>
          <Text wrap="truncate-end">{where}</Text>
          {which !== undefined && (
            <Text dimColor wrap="truncate-end">
              {which}
            </Text>
          )}
          {action !== undefined && (
            <Button
              key="board:change"
              plain
              label={S.changeBoardLink}
              onPress={() => changeBoardFromSettings($)}
            >
              <Text color="suggestion">{S.changeBoardLink}</Text>
            </Button>
          )}
          {action === undefined &&
            board.backend?.kind === 'github' &&
            board.backend.isDetected !== true && (
              <Text dimColor wrap="wrap">
                {S.boardFromConfig}
              </Text>
            )}
        </Box>
      </Box>
    )
  }

  const listed = settingsOf(settings.rows)
  const body: RenderElement[] = !settings.isLoaded
    ? [<Text dimColor>{S.settingsLoading}</Text>]
    : settings.error !== undefined
      ? [
          <Text color="error" wrap="wrap">
            {S.settingsFailed(settings.error)}
          </Text>,
        ]
      : listed.length === 0
        ? [
            <Text dimColor wrap="wrap">
              {S.settingsNone}
            </Text>,
          ]
        : listed.map(settingBlock)

  return (
    <Box flexDirection="column" gap={1}>
      <Button
        key="back"
        plain
        hotkey="b"
        label={S.back}
        onPress={() => closeSettings($)}
      />
      <Text weight="bold">{S.settings}</Text>
      {body}
      {boardBlock()}
      <Text dimColor>{S.settingsFooter}</Text>
    </Box>
  )
}
