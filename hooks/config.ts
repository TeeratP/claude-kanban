import type { EngineInterface } from 'claude-code'

import { errorMessage } from './model'
import { S } from './strings'

// Where the board is recorded: these files first, then what they import.
const CONFIG_FILES = ['CLAUDE.md', '.claude/CLAUDE.md', 'AGENTS.md']
const MAX_IMPORTS = 8
const MAX_FILES = 16
// Enough for the longest instruction files seen (about 70 KB) many times over.
const MAX_CHARS = 1_000_000

const FENCE = /^\s*(```|~~~)/
const CODE_SPAN = /`[^`\n]*`/g
// Claude Code's own import syntax: `@path` after whitespace, outside code.
const IMPORT = /(?:^|\s)@([^\s`'"<>()[\]]+)/g

// `docs/a.md` imported from `dir`, as a path under the project; undefined when it leaves the project.
function inProject(dir: string, target: string): string | undefined {
  const parts = dir === '' ? [] : dir.split('/')

  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') {
      parts.push(part)
      continue
    }
    if (parts.pop() === undefined) return undefined
  }

  return parts.length === 0 ? undefined : parts.join('/')
}

/**
 * The files `@path` lines in a Markdown file import, as project-relative paths.
 * Absolute and home paths, paths that leave the project, and mentions
 * (`@someone`, which name no file) are left out; so is anything in code.
 */
export function importsOf(file: string, text: string): string[] {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
  const found: string[] = []
  let isFenced = false

  for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
    if (FENCE.test(line)) {
      isFenced = !isFenced
      continue
    }
    if (isFenced) continue

    for (const match of line.replace(CODE_SPAN, '').matchAll(IMPORT)) {
      const target = (match[1] ?? '').replace(/[.,;:!?]+$/, '')
      if (!/[./]/.test(target) || target.endsWith('/')) continue
      if (/^[/~\\]|\\|^[a-z][a-z0-9+.-]*:/i.test(target)) continue

      const path = inProject(dir, target)
      if (path !== undefined && !found.includes(path)) found.push(path)
    }
  }

  return found
}

/**
 * The text that may say where the board is: CLAUDE.md, .claude/CLAUDE.md and
 * AGENTS.md, then the files they import (one level, each file read once),
 * joined. A file that cannot be read is skipped and logged to the debug log.
 */
export async function readConfigText($: EngineInterface): Promise<string> {
  const texts = new Map<string, string>()
  let size = 0

  const take = async (file: string) => {
    if (texts.has(file) || texts.size >= MAX_FILES || size >= MAX_CHARS) return

    try {
      if (!(await $.fs.exists(file))) return

      const text = (await $.fs.read(file)).slice(0, MAX_CHARS - size)
      texts.set(file, text)
      size += text.length
    } catch (error) {
      $.ui.log(S.configUnreadable(file, errorMessage(error)), { to: 'debug' })
    }
  }

  for (const file of CONFIG_FILES) await take(file)
  for (const file of CONFIG_FILES) {
    const text = texts.get(file)
    if (text === undefined) continue

    for (const target of importsOf(file, text).slice(0, MAX_IMPORTS)) {
      await take(target)
    }
  }

  return [...texts.values()].join('\n\n')
}
