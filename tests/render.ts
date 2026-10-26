import type { Mounted } from 'claude-code/testing'

import { cellWidth, padEnd, truncate } from '../hooks/model'

// A text renderer for what `ui.drawn()` returns, to look at a view at a given
// width. The kit paints nothing, so this lays the tree out the way a terminal
// would, close enough to see rows that wrap, run past the edge or crowd:
//
// - Box: column or row, `flexWrap`, `gap`, `width`, `paddingLeft`/`paddingX`,
//   `justifyContent: space-between`, `flexGrow`. Children of a row that do not
//   fit shrink, last first, but only Text and Markdown can.
// - Text wraps at spaces, or is cut with `…` for `wrap: 'truncate-end'`.
// - Button is `[ key: label ]`, a plain one `key: label`; Input is
//   `[label: value]` across the row, `rows` tall; Link is its text.
//
// Style (color, dim, bold) is not drawn: assert on props for that. A line wider
// than the width is kept whole, so `overflow` can find it.

type Node =
  string | { type?: string; props?: Record<string, unknown>; children?: Node[] }

type Block = string[]

const prop = <T>(node: Exclude<Node, string>, name: string) =>
  node.props?.[name] as T | undefined

const widthOf = (block: Block) =>
  block.reduce((most, line) => Math.max(most, cellWidth(line)), 0)

const evened = (block: Block, width: number): Block =>
  block.map(line => padEnd(line, width))

const inline = (node: Node): string => {
  if (typeof node === 'string') return node

  const text = (node.children ?? []).map(inline).join('')
  // A Link or a Button with no children is drawn as its label.
  return text === '' ? (prop<string>(node, 'label') ?? '') : text
}

// Cuts a word that is wider than the line into pieces that fit it.
function pieces(word: string, width: number): string[] {
  const parts: string[] = []
  let part = ''
  for (const char of word) {
    if (part !== '' && cellWidth(part + char) > width) {
      parts.push(part)
      part = ''
    }
    part += char
  }

  return [...parts, part]
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      // A word wider than a line starts on a line of its own and runs over the next ones.
      const parts = cellWidth(word) > width ? pieces(word, width) : [word]
      parts.forEach((part, index) => {
        const next = line === '' ? part : `${line} ${part}`
        if (line === '' || (index === 0 && cellWidth(next) <= width)) {
          line = next
        } else {
          lines.push(line)
          line = part
        }
      })
    }
    lines.push(line)
  }

  return lines
}

const plain = (markdown: string) =>
  markdown
    .replaceAll('**', '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#+ /gm, '')

function button(node: Exclude<Node, string>): string {
  const label = inline(node) || (prop<string>(node, 'label') ?? '')
  const hotkey = prop<string>(node, 'hotkey')
  const text = hotkey === undefined ? label : `${hotkey}: ${label}`
  if (prop<boolean>(node, 'plain') === true) return text

  return `[ ${text} ]`
}

function input(node: Exclude<Node, string>, width: number): Block {
  const label = prop<string>(node, 'label')
  const value = prop<string>(node, 'value') ?? ''
  const shown = value === '' ? (prop<string>(node, 'placeholder') ?? '') : value
  const rows = prop<number>(node, 'rows') ?? 1
  const inner = Math.max(0, width - 2)
  const first = `${label === undefined ? '' : `${label}: `}${shown}`

  return Array.from({ length: rows }, (_, row) => {
    const text = row === 0 ? first : ''

    return `[${padEnd(truncate(text, inner), inner)}]`
  })
}

function stack(blocks: Block[], gap: number): Block {
  const width = Math.max(0, ...blocks.map(widthOf))
  const lines: Block = []
  blocks.forEach((block, index) => {
    if (index > 0) lines.push(...Array(gap).fill(''))
    lines.push(...block)
  })

  return evened(lines, width)
}

function beside(blocks: Block[], gaps: number[]): Block {
  const height = Math.max(0, ...blocks.map(block => block.length))

  return Array.from({ length: height }, (_, row) =>
    blocks
      .map((block, index) => {
        const width = widthOf(block)
        const part = padEnd(block[row] ?? '', width)

        return index === 0 ? part : ' '.repeat(gaps[index - 1] ?? 0) + part
      })
      .join(''),
  )
}

// Whether a child of a row can give up width: a Box, whose content wraps, or
// text with a space inside it to wrap at. A lone word, a dot between two links
// or a Button cannot.
const shrinks = (child: Node) =>
  typeof child !== 'string' &&
  (child.type === 'Box' ||
    child.type === 'Markdown' ||
    (child.type === 'Text' && inline(child).trim().includes(' ')))

function row(
  node: Exclude<Node, string>,
  children: Node[],
  avail: number,
): Block {
  const gap = prop<number>(node, 'columnGap') ?? prop<number>(node, 'gap') ?? 0
  const fixed = (child: Node) =>
    typeof child === 'string' ? undefined : prop<number>(child, 'width')
  const natural = children.map(child => {
    const width = fixed(child)
    const block = draw(child, width ?? Infinity)

    return width === undefined ? block : evened(block, width)
  })

  if (prop<string>(node, 'flexWrap') === 'wrap') {
    const lines: Block[] = []
    let current: Block[] = []
    let used = 0
    for (const block of natural) {
      const width = widthOf(block)
      if (current.length > 0 && used + gap + width > avail) {
        lines.push(beside(current, Array(current.length).fill(gap)))
        current = []
        used = 0
      }
      used += (current.length > 0 ? gap : 0) + width
      current.push(block)
    }
    if (current.length > 0) {
      lines.push(beside(current, Array(current.length).fill(gap)))
    }

    return stack(lines, prop<number>(node, 'rowGap') ?? 0)
  }

  // Too wide: the last children that can shrink give way first.
  const total = () =>
    natural.reduce((sum, block) => sum + widthOf(block), 0) +
    gap * Math.max(0, natural.length - 1)
  for (let at = children.length - 1; at >= 0 && total() > avail; at -= 1) {
    const child = children[at]
    if (child === undefined || fixed(child) !== undefined) continue
    if (!shrinks(child)) continue

    const others = total() - widthOf(natural[at] ?? [])
    const room = Math.max(1, avail - others)
    const block = draw(child, room)
    if (widthOf(block) < widthOf(natural[at] ?? [])) natural[at] = block
  }

  const leftover = Math.max(0, avail - total())
  const gaps = Array(Math.max(0, natural.length - 1)).fill(gap)
  if (
    prop<string>(node, 'justifyContent') === 'space-between' &&
    natural.length > 1 &&
    Number.isFinite(avail)
  ) {
    const share = Math.floor(leftover / (natural.length - 1))
    gaps.forEach((_, index) => {
      gaps[index] =
        gap + share + (index === 0 ? leftover % (natural.length - 1) : 0)
    })
  }
  const grow = children.findIndex(
    child =>
      typeof child !== 'string' && (prop<number>(child, 'flexGrow') ?? 0) > 0,
  )
  if (grow >= 0 && Number.isFinite(avail)) {
    const block = natural[grow] ?? []
    natural[grow] = evened(block, widthOf(block) + leftover)
  }

  return beside(natural, gaps)
}

function draw(node: Node, avail: number): Block {
  if (typeof node === 'string') return wrap(node, avail)

  const children = node.children ?? []
  switch (node.type) {
    case 'Text': {
      const text = inline(node)
      if (prop<string>(node, 'wrap') === 'truncate-end') {
        return [Number.isFinite(avail) ? truncate(text, avail) : text]
      }

      return Number.isFinite(avail) ? wrap(text, avail) : text.split('\n')
    }

    case 'Link':
      return [inline(node) || (prop<string>(node, 'label') ?? '')]

    case 'Button':
      return [button(node)]

    case 'Input':
      return input(node, Number.isFinite(avail) ? avail : 40)

    case 'Markdown': {
      const text = plain(prop<string>(node, 'text') ?? '')

      return Number.isFinite(avail) ? wrap(text, avail) : text.split('\n')
    }

    case 'Code':
      return (prop<string>(node, 'source') ?? '').split('\n')

    case 'Box': {
      const own = prop<number>(node, 'width')
      const left =
        prop<number>(node, 'paddingLeft') ??
        prop<number>(node, 'paddingX') ??
        prop<number>(node, 'padding') ??
        0
      const right =
        prop<number>(node, 'paddingRight') ??
        prop<number>(node, 'paddingX') ??
        prop<number>(node, 'padding') ??
        0
      const room = Math.min(avail, own ?? Infinity) - left - right
      const inner =
        prop<string>(node, 'flexDirection') === 'column'
          ? stack(
              children.map(child => draw(child, room)),
              prop<number>(node, 'rowGap') ?? prop<number>(node, 'gap') ?? 0,
            )
          : row(node, children, room)
      const padded = inner.map(line => ' '.repeat(left) + line)

      return own === undefined ? padded : evened(padded, own)
    }

    default:
      return stack(
        children.map(child => draw(child, avail)),
        0,
      )
  }
}

/** A drawn tree as lines of text at `columns` cells across. */
export function renderTree(root: unknown, columns: number): string[] {
  return draw(root as Node, columns).map(line => line.trimEnd())
}

type Drawn = Pick<Mounted, 'drawn'>

// A Client's region is drawn by its surface module: swap each for what it drew.
async function inlined(ui: Drawn, node: Node): Promise<Node> {
  if (typeof node === 'string') return node

  if (node.type === 'Client') {
    const key = prop<string>(node, 'key')

    return (await ui.drawn(key === undefined ? undefined : { in: key })) as Node
  }

  return {
    ...node,
    children: await Promise.all(
      (node.children ?? []).map(child => inlined(ui, child)),
    ),
  }
}

/** The mounted pane as lines of text at `columns`, a Client's rows included. */
export async function renderPane(
  ui: Drawn,
  columns: number,
): Promise<string[]> {
  return renderTree(await inlined(ui, (await ui.drawn()) as Node), columns)
}

/** The lines wider than `columns`: what a terminal would cut or wrap. */
export function overflow(lines: readonly string[], columns: number): string[] {
  return lines.filter(line => cellWidth(line) > columns)
}

/** Lines inside a frame `columns` wide, as a report shows them. */
export function framed(lines: readonly string[], columns: number): string {
  const edge = '─'.repeat(columns)

  return [
    `┌${edge}┐`,
    ...lines.map(line => `│${padEnd(line, columns)}│`),
    `└${edge}┘`,
  ].join('\n')
}
