// Hand-written types for the parts of the MicroPython wasm build that the worker calls.
declare module '@micropython/micropython-webassembly-pyscript/micropython.mjs' {
  export interface MicroPython {
    /* Gives back null in this build. Read the answer out of globals instead. */
    runPython(code: string): unknown
    /* The main namespace. Strings pass through it unchanged both ways, including quotes, newlines
     * and unicode. */
    globals: {
      get(key: string): unknown
      set(key: string, value: unknown): void
    }
    /* The in-memory file system that a member's island gets written into as real files. */
    FS: {
      writeFile(path: string, data: string): void
      mkdirTree(path: string): void
    }
  }

  export function loadMicroPython(options?: {
    /* The full url of micropython.wasm, which becomes Module.locateFile. */
    url?: string
    heapsize?: number
    stdout?: (line: string) => void
    stderr?: (line: string) => void
    linebuffer?: boolean
  }): Promise<MicroPython>
}
