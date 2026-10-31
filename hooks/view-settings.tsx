import type { EngineInterface, RenderElement, RenderInput } from 'claude-code'

import type { KanbanBoard } from '../types'
import { readBoard, readSettings } from './atoms'
import { cellWidth } from './model'
import { S } from './strings'
import { nameOf } from './people'
import {
  boardAction,
  changeBoardFromSettings,
  closeNameField,
  closeSettings,
  isDefault,
  openNameField,
  optionsOf,
  setSetting,
  settingsOf,
  submitName,
  typeName,
  valueText,
} from './settings'
import type { Setting } from './settings'
import { dotted, packRows, separatorWidth } from './view-parts'

// Cells a setting's controls and help stand in from its name.
const INDENT = 2

// The board the mod reads, as two short lines: where it is, then which.
function boardLines(board: KanbanBoard): [string, string | undefined] {
  const { backend } = board
  if (backend === null) {
    return board.setup === undefined
      ? [S.loading, undefined]
      : [S.backendName, S.setupNeeded]
  }

  return [
    `${S.backendName}${S.dot}${backend.repo}`,
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

  const settingBlock = (setting: Setting) => {
    const { field, row } = setting
    const denied = settings.denied[row.key]
    const controls = row.isLocked ? (
      <Text key={`value:${field}`} weight="bold">
        {valueText(row.value)}
      </Text>
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
            board.backend !== null &&
            board.backend.isDetected !== true && (
              <Text dimColor wrap="wrap">
                {S.boardFromConfig}
              </Text>
            )}
        </Box>
      </Box>
    )
  }

  // The name the person goes by on the board: shown, and changed in a field
  // where the surface has one.
  const nameBlock = () => {
    const { viewer, people } = board
    // The mobile app draws no field yet, though its element table names Input.
    const els = $.ui.resolve(e)
    const Input =
      e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
    const canType = Input !== undefined
    const draft = settings.nameDraft
    if (viewer === undefined) {
      return (
        <Box key="name" flexDirection="column">
          <Text>{S.yourName}</Text>
          <Box paddingLeft={INDENT}>
            <Text dimColor wrap="wrap">
              {S.nameUnknown}
            </Text>
          </Box>
        </Box>
      )
    }

    const shown = nameOf(people, viewer)
    const field =
      draft !== undefined && Input !== undefined ? (
        <Box flexDirection="column">
          <Input
            key="name:field"
            autoFocus
            label={S.yourName}
            placeholder={viewer}
            submitLabel={S.nameSave}
            value={draft}
            onInput={value => typeName($, value)}
            onSubmit={value => submitName($, value)}
          />
          <Button
            key="name:cancel"
            plain
            label={S.nameCancel}
            onPress={() => closeNameField($)}
          >
            <Text color="suggestion">{S.nameCancel}</Text>
          </Button>
        </Box>
      ) : (
        <Box flexDirection="row">
          <Text weight="bold" wrap="truncate-end">
            {shown}
          </Text>
          {canType && <Text>{S.dot}</Text>}
          {canType && (
            <Button
              key="name:change"
              plain
              label={S.nameChange}
              onPress={() => openNameField($)}
            >
              <Text color="suggestion">{S.nameChange}</Text>
            </Button>
          )}
        </Box>
      )

    return (
      <Box key="name" flexDirection="column">
        <Text>{S.yourName}</Text>
        <Box flexDirection="column" paddingLeft={INDENT}>
          {field}
          <Text dimColor wrap="wrap">
            {S.yourNameHelp(viewer)}
          </Text>
          {settings.nameError !== undefined && (
            <Text color="error" wrap="wrap">
              {settings.nameError}
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
      {nameBlock()}
      {boardBlock()}
      <Text dimColor>{S.settingsFooter}</Text>
    </Box>
  )
}
