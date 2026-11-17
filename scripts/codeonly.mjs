// Checks that a change touched only comments. It strips every comment from the committed version
// and the working copy, squashes whitespace and compares them. If they match the code is untouched,
// and if not it prints the file name so the change can be undone.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = process.argv[2]
const ref = process.argv[3] || 'HEAD'
const only = process.argv[4] || ''

const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })

// The strippers. The JavaScript and TypeScript one understands strings, template literals and regex
// literals. A simpler one would treat the slashes in a URL inside a string as a comment and report
// a code change that didn't happen.
function stripJS(src) {
  let out = ''
  let i = 0
  const n = src.length
  // The last character seen decides whether a slash starts a regex or means divide.
  let prev = ''
  const tmpl = []
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && d === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }
    if (c === '"' || c === "'") {
      const q = c
      out += c
      i++
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        out += src[i]
        if (src[i] === q) { i++; break }
        i++
      }
      prev = q
      continue
    }
    if (c === '`') {
      out += c
      i++
      tmpl.push(true)
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        if (src[i] === '$' && src[i + 1] === '{') {
          // A ${...} hole can hold any code, comments included, so run the scanner on it too.
          let depth = 1
          out += '${'
          i += 2
          let inner = ''
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++
            else if (src[i] === '}') { depth--; if (!depth) break }
            inner += src[i]
            i++
          }
          out += stripJS(inner) + '}'
          i++
          continue
        }
        out += src[i]
        if (src[i] === '`') { i++; break }
        i++
      }
      tmpl.pop()
      prev = '`'
      continue
    }
    if (c === '/') {
      // A regex can only start where a value could start.
      const canRegex = !/[\w)\]`'"]/.test(prev)
      if (canRegex) {
        let j = i + 1
        let cls = false
        let ok = false
        while (j < n) {
          const e = src[j]
          if (e === '\\') { j += 2; continue }
          if (e === '\n') break
          if (cls) { if (e === ']') cls = false; j++; continue }
          if (e === '[') { cls = true; j++; continue }
          if (e === '/') { ok = true; break }
          j++
        }
        if (ok) {
          j++
          while (j < n && /[a-z]/.test(src[j])) j++
          out += src.slice(i, j)
          i = j
          prev = '/'
          continue
        }
      }
    }
    out += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}

function stripCSS(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      out += ' '
      continue
    }
    if (c === '"' || c === "'") {
      const q = c
      out += c
      i++
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        out += src[i]
        if (src[i] === q) { i++; break }
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

// Python. A docstring is a string and stays. Only a real # comment gets removed.
function stripPY(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '#') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    const three = src.slice(i, i + 3)
    if (three === '"""' || three === "'''") {
      out += three
      i += 3
      while (i < n && src.slice(i, i + 3) !== three) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        out += src[i]
        i++
      }
      out += three
      i += 3
      continue
    }
    if (c === '"' || c === "'") {
      const q = c
      out += c
      i++
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        out += src[i]
        if (src[i] === q) { i++; break }
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

const strip = (file, src) => {
  const ext = path.extname(file)
  if (ext === '.css') return stripCSS(src)
  if (ext === '.py') return stripPY(src)
  return stripJS(src)
}

// Squash all whitespace, because removing a comment also removes a blank line and that isn't a code
// change.
const norm = (s) => s.replace(/\s+/g, ' ').trim()

// ---- the check --------------------------------------------------------------

const EXT = new Set(['.ts', '.tsx', '.mjs', '.js', '.css', '.py'])
let changed = only
  ? [only]
  : git(['diff', '--name-only', ref])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
changed = changed.filter((f) => EXT.has(path.extname(f)))

let bad = 0
for (const f of changed) {
  let before
  try {
    before = git(['show', `${ref}:${f}`])
  } catch {
    console.log(`  new     ${f}`)
    continue
  }
  const after = fs.readFileSync(path.join(root, f), 'utf8')
  const a = norm(strip(f, before))
  const b = norm(strip(f, after))
  if (a === b) continue
  bad++
  console.log(`  CODE    ${f}`)
  // Print where the difference is, so fixing it doesn't mean reading the whole file.
  let k = 0
  while (k < a.length && k < b.length && a[k] === b[k]) k++
  console.log(`          at ${k}: was ...${a.slice(Math.max(0, k - 70), k + 70)}...`)
  console.log(`              now ...${b.slice(Math.max(0, k - 70), k + 70)}...`)
}
console.log(bad ? `\n${bad} of ${changed.length} file(s) changed code.` : `\n${changed.length} file(s), comments only.`)
process.exit(bad ? 1 : 0)
