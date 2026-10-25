import type { EngineInterface, On } from 'claude-code'

export type Reply = { exitCode?: number; stdout?: string; stderr?: string }

// A route answers every command that starts with `match`; the first one wins.
export type Route = {
  match: readonly string[]
  reply: Reply | ((argv: readonly string[]) => Reply)
}

export type Call = { argv: readonly string[]; stdin?: string }

function answer(routes: readonly Route[], call: Call) {
  const route = routes.find(one =>
    one.match.every((part, index) => call.argv[index] === part),
  )
  // A command nobody routed fails the test: nothing reaches a real `gh`.
  if (route === undefined) {
    throw new Error(`fake gh: no route for ${call.argv.join(' ')}`)
  }
  const reply =
    typeof route.reply === 'function' ? route.reply(call.argv) : route.reply

  return {
    exitCode: reply.exitCode ?? 0,
    stdout: reply.stdout ?? '',
    stderr: reply.stderr ?? '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  }
}

/** A stand-in `$` for the plain functions: `process.run` from routes, `fs` from a map. */
export function fakeEngine(
  routes: readonly Route[],
  files: Record<string, string> = {},
) {
  const calls: Call[] = []
  const timeouts: (number | undefined)[] = []
  const logs: string[] = []
  const $ = {
    fs: {
      exists: async (file: string) => file in files,
      read: async (file: string) => {
        const text = files[file]
        if (text === undefined) throw new Error(`ENOENT: ${file}`)

        return text
      },
    },
    ui: {
      log: (text: string) => {
        logs.push(text)
      },
    },
    process: {
      run: async (
        argv: readonly string[],
        init?: { stdin?: string; timeoutMs?: number },
      ) => {
        const call = {
          argv,
          ...(init?.stdin === undefined ? {} : { stdin: init.stdin }),
        }
        calls.push(call)
        timeouts.push(init?.timeoutMs)

        return answer(routes, call)
      },
    },
  } as unknown as EngineInterface

  return { $, calls, timeouts, logs }
}

/** Answers the engine's `process.run` event from routes and records each command. */
export function fakeProcess(on: On, routes: readonly Route[]) {
  const calls: Call[] = []
  on('process.run', (_, e) => {
    const call = {
      argv: e.argv,
      ...(e.init?.stdin === undefined ? {} : { stdin: e.init.stdin }),
    }
    calls.push(call)

    return { value: answer(routes, call) }
  })

  return calls
}
