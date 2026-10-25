import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

export const NOW = Date.parse('2026-10-25T12:00:00Z')

export type Files = Record<string, string>

// mtimes never repeat across tests, so the local backend's cache cannot go stale.
let mtime = 1_000

export function card(
  id: number,
  fields: {
    status?: string
    title?: string
    updated?: string
    order?: number
  } = {},
  body = 'Spec text.',
): string {
  return [
    '---',
    `id: ${id}`,
    `title: ${fields.title ?? `Card ${id}`}`,
    `status: ${fields.status ?? 'backlog'}`,
    `order: ${fields.order ?? id}`,
    'created: 2026-10-25T10:00:00Z',
    `updated: ${fields.updated ?? '2026-10-25T11:00:00Z'}`,
    '---',
    `${body}\n`,
  ].join('\n')
}

export const path = (id: number, slug = 'card') =>
  `.kanban/${String(id).padStart(4, '0')}-${slug}.md`

// The engine resolves a relative path against the session's directory before
// `fs.*` is raised, so the fake maps it back to the path the plugin spelled.
const relative = (file: string) =>
  file.includes('.kanban') ? file.slice(file.indexOf('.kanban')) : file

/** Answers `fs.*` from a map of path to text; a write bumps the file's mtime. */
export function fakeFs(on: On, files: Files) {
  const mtimes = new Map<string, number>()
  const touch = (file: string) => mtimes.set(file, (mtime += 1))
  for (const file of Object.keys(files)) touch(file)
  const calls = {
    lists: 0,
    writes: [] as string[],
    denyWrite: undefined as string | undefined,
    denyRead: undefined as string | undefined,
    // Writes that land before every later one is denied.
    denyWriteAfter: undefined as number | undefined,
    // While set, a write waits for it: a move stays unsettled for the test to look at.
    hold: undefined as Promise<void> | undefined,
    // A change made outside the plugin, as Claude's Write or the person's editor does.
    edit: (file: string, text: string) => {
      files[file] = text
      touch(file)
    },
  }
  const under = (dir: string) =>
    Object.keys(files).filter(
      file =>
        file.startsWith(`${dir}/`) && !file.slice(dir.length + 1).includes('/'),
    )

  on('fs.exists', (_, e) => {
    const file = relative(e.path)

    return { value: file in files || under(file).length > 0 }
  })
  on('fs.list', (_, e) => {
    const dir = relative(e.path)
    calls.lists += 1

    return {
      value: under(dir).map(file => ({
        name: file.slice(dir.length + 1),
        kind: 'file' as const,
        size: files[file]?.length ?? 0,
        mtimeMs: mtimes.get(file) ?? 0,
        isLink: false,
      })),
    }
  })
  on('fs.read', (_, e) => {
    if (calls.denyRead !== undefined) return { deny: calls.denyRead }

    const text = files[relative(e.path)]

    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', async (_, e) => {
    await calls.hold
    if (calls.denyWrite !== undefined) return { deny: calls.denyWrite }
    if (
      calls.denyWriteAfter !== undefined &&
      calls.writes.length >= calls.denyWriteAfter
    )
      return { deny: 'EIO: disk error' }

    const file = relative(e.path)
    files[file] = e.text
    touch(file)
    calls.writes.push(file)

    return { value: undefined }
  })

  return calls
}

/** The engine beneath the plugin: a clock, files, and the registration calls. */
export function boot(on: On, files: Files) {
  const clock = mock.clock(on, { now: NOW })
  const calls = fakeFs(on, files)
  const toasts: string[] = []
  const logs: string[] = []
  const scrolls: { by: number }[] = []
  const registered: string[] = []
  const prompts: string[] = []
  const world = { panes: [] as string[], opened: [] as string[] }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('tool.register', (_, e) => {
    registered.push(e.name)

    return { value: { tool: `mcp__kanban__${e.name}` } }
  })
  on('ui.open', (_, e) => {
    world.opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({
    value: world.panes.map(id => ({
      id,
      title: id,
      isShown: true,
      isFocused: false,
      isPlaced: true,
    })),
  }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.log', (_, e) => {
    logs.push(e.text)

    return { value: undefined }
  })
  on('ui.scroll', (_, e) => {
    scrolls.push({ by: e.by })

    return {}
  })
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)

    return { text: e.text }
  })
  on('tool.call', () => ({ result: {} }))

  return { clock, calls, toasts, logs, scrolls, registered, prompts, world }
}

export const PANE = {
  plugin: 'kanban',
  component: 'Pane',
  requestId: 'kanban',
  props: {
    title: 'Kanban',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

export const SCROLL = {
  component: 'Pane',
  requestId: 'kanban',
  offset: 0,
  bodyRows: 30,
  contentRows: 30,
  origin: { kind: 'person' },
} as const

export const RUN = {
  command: 'kanban',
  args: '',
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 120 },
} as const
