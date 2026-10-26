import type { On, PaneOpenArgs } from 'claude-code'
import { mock } from 'claude-code/testing'

export const NOW = Date.parse('2026-10-25T12:00:00Z')
export const CWD = '/work'
// A move reaches the backend this long after it is made, so a test looks at the files after it.
export const SYNC_PAUSE = 300

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

/** A card body with a valid handoff, which a card needs before it can move to Human. */
export const HANDED_OFF = [
  'Spec text.',
  '',
  '## Handoff (2026-10-25)',
  '**Did:** Wrote the docs',
  '**Check:** Read the README',
  '**Changed:** README.md',
  '**Need from you:** Approve',
].join('\n')

export const path = (id: number, slug = 'card') =>
  `.kanban/${String(id).padStart(4, '0')}-${slug}.md`

// The engine resolves a relative path against the session's directory before
// `fs.*` is raised, so the fake maps it back to the path the plugin spelled:
// the longest listed path it ends with.
const relative = (file: string, files: Files) => {
  if (file.includes('.kanban')) return file.slice(file.indexOf('.kanban'))

  const spelled = Object.keys(files)
    .filter(one => file === one || file.endsWith(`/${one}`))
    .sort((a, b) => b.length - a.length)[0]

  return spelled ?? file
}

/** Answers `fs.*` from a map of path to text; a write bumps the file's mtime. */
export function fakeFs(on: On, files: Files) {
  const mtimes = new Map<string, number>()
  const touch = (file: string) => mtimes.set(file, (mtime += 1))
  for (const file of Object.keys(files)) touch(file)
  const calls = {
    lists: 0,
    // The paths asked about and read, as the engine raised them.
    exists: [] as string[],
    reads: [] as string[],
    writes: [] as string[],
    denyWrite: undefined as string | undefined,
    denyRead: undefined as string | undefined,
    // Writes that land before every later one is denied.
    denyWriteAfter: undefined as number | undefined,
    // While set, a write waits for it: a move stays unsettled for the test to look at.
    hold: undefined as Promise<void> | undefined,
    // While set, a listing waits for it: the first load stays unanswered.
    holdList: undefined as Promise<void> | undefined,
    // The next read is answered only once this settles: a load that is slow on one file
    // while it has already taken the others as they stand. Later reads are not held.
    lateRead: undefined as Promise<void> | undefined,
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
    calls.exists.push(e.path)
    const file = relative(e.path, files)

    return { value: file in files || under(file).length > 0 }
  })
  on('fs.list', async (_, e) => {
    const dir = relative(e.path, files)
    calls.lists += 1
    await calls.holdList

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
  on('fs.read', async (_, e) => {
    calls.reads.push(e.path)
    if (calls.denyRead !== undefined) return { deny: calls.denyRead }

    const text = files[relative(e.path, files)]
    const late = calls.lateRead
    calls.lateRead = undefined
    await late

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

    const file = relative(e.path, files)
    files[file] = e.text
    touch(file)
    calls.writes.push(file)

    return { value: undefined }
  })

  return calls
}

/** The engine beneath the plugin: a clock, files, and the registration calls. */
export function boot(on: On, files: Files, store?: Record<string, unknown>) {
  const clock = mock.clock(on, { now: NOW })
  // Kept as JSON text, as the engine keeps it, so a test can read what was saved.
  const saved = new Map(
    Object.entries(store ?? {}).map(([key, value]) => [
      key,
      JSON.stringify(value),
    ]),
  )
  const calls = fakeFs(on, files)
  const toasts: string[] = []
  const notices: string[] = []
  const statuses: (string | undefined)[] = []
  const logs: string[] = []
  const scrolls: { by: number }[] = []
  const registered: string[] = []
  const prompts: string[] = []
  const world = {
    panes: [] as string[],
    // False: the listed panes wait undrawn, as on a terminal too narrow for them.
    isPlaced: true,
    opened: [] as string[],
    // The next `ui.panes` answers with the panes as they stood when asked, but only
    // once this settles: a pane closed meanwhile is still listed.
    holdPanes: undefined as Promise<void> | undefined,
    // Every open as the engine got it, and the title each pane carries now.
    opens: [] as PaneOpenArgs[],
    titles: {} as Record<string, string>,
  }

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('store.get', (_, e) => {
    const text = saved.get(e.key)

    return { value: text === undefined ? undefined : JSON.parse(text) }
  })
  on('store.set', (_, e) => {
    saved.set(e.key, JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    saved.delete(e.key)

    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...saved.keys()] }))
  on('ui.status', (_, e) => {
    statuses.push(e.text)

    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    notices.push(e.text)

    return {
      value: { isSent: true as const, channel: 'terminal_bell' as const },
    }
  })
  on('command.register', () => ({ value: { command: 'kanban' } }))
  on('tool.register', (_, e) => {
    registered.push(e.name)

    return { value: { tool: `mcp__kanban__${e.name}` } }
  })
  on('ui.open', (_, e) => {
    world.opened.push(e.id)
    world.opens.push(e)
    world.titles[e.id] = e.title ?? e.id

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    world.panes = world.panes.filter(id => id !== e.id)

    return { value: undefined }
  })
  on('ui.panes', async () => {
    const listed = world.panes.map(id => ({
      id,
      title: world.titles[id] ?? 'Kanban',
      isShown: true,
      isFocused: false,
      isPlaced: world.isPlaced,
    }))
    const late = world.holdPanes
    world.holdPanes = undefined
    await late

    return { value: listed }
  })
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

  return {
    clock,
    calls,
    toasts,
    notices,
    statuses,
    logs,
    scrolls,
    registered,
    prompts,
    world,
    saved,
  }
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
