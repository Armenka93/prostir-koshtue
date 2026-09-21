#!/usr/bin/env node
// Compiles + runs the unit tests for src/lib/listingImagePath.ts — pure,
// no Supabase, no network, no env vars. Cleans up its scratch output in
// `finally` regardless of pass/fail, and propagates a non-zero exit code
// on failure.
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const outDir = path.join(root, '.scratch-image-path-test')

let exitCode = 0
try {
  execSync(
    `npx tsc scripts/test-listing-image-path.ts src/lib/listingImagePath.ts --outDir "${outDir}" --module commonjs --target es2019 --esModuleInterop --skipLibCheck --moduleResolution node`,
    { stdio: 'inherit', cwd: root }
  )
  execSync(`node "${path.join(outDir, 'scripts', 'test-listing-image-path.js')}"`, { stdio: 'inherit', cwd: root })
} catch (e) {
  exitCode = 1
} finally {
  fs.rmSync(outDir, { recursive: true, force: true })
}
process.exit(exitCode)
