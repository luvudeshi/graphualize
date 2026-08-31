/**
 * Folds the single-file build into one HTML document.
 *
 * Opened from a `file://` URL a browser will not fetch sibling assets or run a
 * module script, so the CSS, the JS and the favicon all have to live inside the
 * page itself. The Google Fonts link is deliberately left alone: it is a
 * progressive enhancement and the font stack falls back cleanly offline.
 */
import { readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const dir = 'dist-single'
const out = 'Graphualize.html'

const html = await readFile(join(dir, 'index.html'), 'utf8')
const js = await readFile(join(dir, 'app.js'), 'utf8')
const assets = await readdir(join(dir, 'assets'))
const cssFile = assets.find((name) => name.endsWith('.css'))
if (!cssFile) throw new Error('No stylesheet was emitted.')
const css = await readFile(join(dir, 'assets', cssFile), 'utf8')
const icon = await readFile('public/graphualize.svg', 'utf8')

const escapeScript = (code) => code.replace(/<\/script>/gi, '<\\/script>')

// Replacement *functions*, not strings: minified JS and CSS contain `$&` and
// `$'` sequences that String.replace would otherwise expand.
const literal = (text) => () => text

const result = html
  .replace(
    /<link rel="icon"[^>]*>/i,
    literal(
      `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${Buffer.from(icon).toString('base64')}" />`,
    ),
  )
  .replace(/<link rel="stylesheet"[^>]*href="\/assets\/[^"]*"[^>]*>/i, literal(`<style>\n${css}\n</style>`))
  .replace(/<link rel="modulepreload"[^>]*>/gi, '')
  // A classic inline script runs the moment it is parsed, so it has to sit at
  // the end of the body rather than where the module tag was in the head.
  .replace(/<script[^>]*src="\/app\.js"[^>]*><\/script>\s*/i, '')
  .replace('</body>', literal(`  <script>\n${escapeScript(js)}\n</script>\n  </body>`))

for (const reference of ['/app.js', '/assets/', '/graphualize.svg']) {
  if (result.includes(reference)) {
    throw new Error(`"${reference}" is still referenced externally; the file would not work offline.`)
  }
}

await writeFile(out, result, 'utf8')
await rm(dir, { recursive: true, force: true })
console.log(`${out}  ${(Buffer.byteLength(result) / 1024 / 1024).toFixed(2)} MB`)
