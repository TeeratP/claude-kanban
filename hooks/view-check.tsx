import type { EngineInterface, RenderInput } from 'claude-code'

import type { KanbanCard, KanbanSection } from '../types'
import { readCheck, readTick } from './atoms'
import {
  attachRun,
  canAttach,
  currentCheck,
  durationLabel,
  extractCheckCommands,
  isLost,
  resultLine,
  startCheck,
  summary,
} from './check'
import { ageLabel, cellWidth, truncate } from './model'
import { S } from './strings'

// The result and the Buttons sit under the heading, set in this far.
const INDENT = 2
// The `[ ` and ` ]` a Button is drawn with on the terminal.
const CHROME = 4

/**
 * The Check block of a card's detail: a Run button per command in the newest handoff's
 * Check, each showing the exact command, then the card's latest run. Null with no command.
 */
export async function renderCheck(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  card: KanbanCard,
  sections: readonly KanbanSection[],
  now: number,
) {
  const commands = extractCheckCommands(currentCheck(sections))
  if (commands.length === 0) return null

  const { Box, Button, Code, Text } = $.ui.resolve(e)
  // Read so the pane redraws each beat of a run and shows its elapsed time.
  await readTick($)
  const run = (await readCheck($))[card.id]
  const isLostRun = run !== undefined && isLost(run, now)
  const isRunning = run?.outcome === 'running' && !isLostRun
  // A button is one row: the command on it is cut to the width, and shown whole above it.
  const room = e.props.bodyColumns - INDENT - CHROME - cellWidth(S.runCheck(''))
  const named = (command: string) => truncate(summary(command), room)

  return (
    <Box key="check" flexDirection="column">
      <Text weight="bold">{S.checkHeading}</Text>
      <Box flexDirection="column" paddingLeft={INDENT}>
        {isRunning ? (
          <Text color="warning">
            {S.checkRunning(
              summary(run.command),
              durationLabel(now - run.startedAt),
            )}
          </Text>
        ) : (
          commands.map((command, index) => (
            <Box key={`check:cmd:${index}`} flexDirection="column">
              {named(command) !== command && (
                <Code source={command} language="sh" />
              )}
              <Button
                key={`check:run:${index}`}
                label={S.runCheck(named(command))}
                onPress={() => startCheck($, card, command)}
              />
            </Box>
          ))
        )}
        {run !== undefined && run.outcome !== 'running' && (
          <Box flexDirection="column">
            <Text color={run.outcome === 'passed' ? 'success' : 'error'}>
              {`${resultLine(run)} · ${S.checkRan(ageLabel(run.startedAt, now))}`}
            </Text>
            {run.omitted > 0 && (
              <Text dimColor>{S.checkEarlier(run.omitted)}</Text>
            )}
            {run.output !== '' && (
              <Code key="check:output" source={run.output} />
            )}
            {run.isCut && <Text dimColor>{S.checkCapped}</Text>}
            {run.record === 'saving' && <Text dimColor>{S.checkSaving}</Text>}
            {run.record === 'saved' && <Text dimColor>{S.checkSaved}</Text>}
            {run.record === 'failed' && (
              <Text color="error">{S.checkSaveFailed(run.error)}</Text>
            )}
            {canAttach(run) && (
              <Button
                key="check:attach"
                label={S.attachToCard}
                onPress={() => attachRun($, card)}
              />
            )}
          </Box>
        )}
        {isLostRun && <Text color="error">{S.checkLost}</Text>}
      </Box>
    </Box>
  )
}
