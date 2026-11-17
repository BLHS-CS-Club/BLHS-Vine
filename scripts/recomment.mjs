// Rewrites the comments in one file and refuses to save if any code changed.
//
//   node scripts/recomment.mjs dump <file>            prints every comment as JSON
//   node scripts/recomment.mjs dump <file> 200 900    only the comments on those lines
//   node scripts/recomment.mjs apply <file> <json>    puts the new words in
//
// The JSON for apply is a list like [{"id": 3, "text": "New words."}].
// Empty text deletes the comment. An id that is left out stays as it is.
// Ids are positions, so dump again before a second apply on the same file.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { scanJS, scanCSS, group } from './comments.mjs'

const WIDTH = 100
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const [cmd, rel, mapFile] = process.argv.slice(2)

const fail = (why) => {
  console.error(why)
  process.exit(1)
}

if (!cmd || !rel) fail('dump <file> | apply <file> <json>')
if (!/\.(ts|tsx|mjs|js|css)$/.test(rel)) fail(`${rel}: only ts, tsx, mjs, js and css files`)

const full = path.join(root, rel)
const original = fs.readFileSync(full, 'utf8')
const crlf = original.includes('\r\n')
const body = crlf ? original.split('\r\n').join('\n') : original
const spans = rel.endsWith('.css') ? scanCSS(body) : scanJS(body)
const comments = group(body, spans, rel)

if (cmd === 'dump') {
  const lines = body.split('\n')
  // Two more numbers narrow the dump to a range of lines, for a very long file.
  const from = Number(process.argv[4] || 1)
  const to = Number(process.argv[5] || Infinity)
  for (const c of comments) {
    if (c.directive || c.line < from || c.line > to) continue
    const row = { id: c.id, line: c.line, where: c.style === 'jsx' ? 'jsx' : c.own ? 'above' : 'beside', text: c.text }
    // A comment that already runs over several lines may have a shape worth keeping.
    if (c.lines > 1) row.raw = lines.slice(c.line - 1, c.line - 1 + c.lines).map((l) => l.trimEnd())
    const over = (c.own ? lines.slice(c.line - 1 + c.lines, c.line + 1 + c.lines) : [lines[c.line - 1]])
      .map((l) => l.trim()).filter(Boolean).join(' / ').slice(0, 160)
    if (over) row.code = over
    console.log(JSON.stringify(row))
  }
  process.exit(0)
}

if (cmd !== 'apply') fail('dump <file> | apply <file> <json>')
if (!mapFile) fail('apply needs the json file with the new words')

let wanted
try {
  const list = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
  wanted = new Map(list.map((m) => [Number(m.id), String(m.text ?? '')]))
} catch (e) {
  fail(`${mapFile} is not a JSON list of {"id", "text"}: ${e.message}`)
}

// Split into lines no wider than `room`, breaking only at spaces.
function wrap(text, room) {
  const out = []
  let line = ''
  for (const word of text.split(' ').filter(Boolean)) {
    if (line && line.length + 1 + word.length > room) {
      out.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) out.push(line)
  return out
}

// A "\n" in the new text is a line break the writer asked for. A line that starts
// with two spaces is kept exactly as typed, for a command or a small table.
function layout(text, room) {
  const out = []
  for (const part of text.split('\n')) {
    if (part.trim() === '') out.push('')
    else if (/^ {2,}\S/.test(part)) out.push(part.trimEnd())
    else out.push(...wrap(part.replace(/\s+/g, ' ').trim(), room))
  }
  while (out.length && out[0] === '') out.shift()
  while (out.length && out[out.length - 1] === '') out.pop()
  return out
}

function render(c, text) {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  const room = Math.max(40, WIDTH - c.indent.length - 3)
  if (c.style === 'line') {
    if (!c.own) return `// ${oneLine}`
    return layout(text, room).map((l, i) => (i ? c.indent : '') + (l ? `// ${l}` : '//')).join('\n')
  }
  const open = c.style === 'jsdoc' ? '/**' : '/*'
  if (!c.own) return `${open} ${oneLine} */`
  const lines = layout(text, room)
  if (lines.length === 1) return `${open} ${lines[0]} */`
  if (c.style === 'jsdoc') {
    return [open, ...lines.map((l) => `${c.indent} *${l ? ` ${l}` : ''}`), `${c.indent} */`].join('\n')
  }
  return [`${open} ${lines[0]}`, ...lines.slice(1).map((l) => `${c.indent} *${l ? ` ${l}` : ''}`)].join('\n') + ' */'
}

let out = ''
let cursor = 0
let rewritten = 0
let deleted = 0
for (const c of comments) {
  if (!wanted.has(c.id)) continue
  if (c.directive) fail(`id ${c.id} (line ${c.line}) is an instruction to a tool, so it stays as it is`)
  const text = wanted.get(c.id).replace(/\r/g, '').replace(/[ \t]+$/gm, '')
  if (/[—–]/.test(text)) fail(`id ${c.id}: no long dashes in a comment. Use a comma, a period or "to".`)
  if (text.includes('*/')) fail(`id ${c.id}: the text has */ in it, which would end the comment early`)
  if (c.style !== 'line' || !c.own) {
    if (!c.own && text.includes('\n')) fail(`id ${c.id}: a comment beside code is one line. Take the line break out.`)
  }

  if (text.trim() === '') {
    if (c.style === 'jsx') fail(`id ${c.id} (line ${c.line}) sits inside JSX braces and cannot be deleted. Give it words.`)
    if (c.own) {
      const lineStart = body.lastIndexOf('\n', c.start - 1) + 1
      const nl = body.indexOf('\n', c.end)
      const lineEnd = nl < 0 ? body.length : nl + 1
      if (body.slice(c.end, lineEnd).trim() === '') {
        // The comment had its own line or lines, so the whole lines go.
        out += body.slice(cursor, lineStart)
        cursor = lineEnd
      } else {
        out += body.slice(cursor, c.start)
        cursor = c.end
        while (body[cursor] === ' ') cursor++
      }
    } else {
      let s = c.start
      while (s > 0 && (body[s - 1] === ' ' || body[s - 1] === '\t')) s--
      out += body.slice(cursor, s)
      cursor = c.end
    }
    deleted++
    continue
  }

  out += body.slice(cursor, c.start) + render(c, text)
  cursor = c.end
  rewritten++
}
out += body.slice(cursor)

fs.writeFileSync(full, crlf ? out.split('\n').join('\r\n') : out)

// The proof. If the code moved at all, the file goes back exactly as it was.
try {
  execFileSync('node', [path.join(root, 'scripts/codeonly.mjs'), root, 'HEAD', rel.split(path.sep).join('/')],
    { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })
} catch (e) {
  fs.writeFileSync(full, original)
  console.error(`${rel}: NOT SAVED, because the code would have changed. The file is back as it was.`)
  console.error(String(e.stdout || e.message))
  process.exit(1)
}
console.log(`${rel}: ${rewritten} rewritten, ${deleted} deleted, code unchanged`)
