#!/usr/bin/env node
// Compiles + runs the lifecycle-timestamps transition-table unit tests —
// pure, no Supabase, no network, no env vars. Cleans up its scratch output
// in `finally` regardless of pass/fail, and propagates a non-zero exit
// code on failure.
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const outDir = path.join(root, '.scratch-lifecycle-timestamps-test')

let exitCode = 0
try {
  execSync(
    `npx tsc scripts/test-lifecycle-timestamps.ts scripts/lifecycleTimestampsModel.ts --outDir "${outDir}" --module commonjs --target es2019 --esModuleInterop --skipLibCheck --moduleResolution node`,
    { stdio: 'inherit', cwd: root }
  )
  // Unlike the other run-*-test.js scripts, both inputs here live inside
  // scripts/ itself — tsc's inferred rootDir is scripts/, not the repo
  // root, so the output is flattened (no scripts/ subfolder under outDir).
  execSync(`node "${path.join(outDir, 'test-lifecycle-timestamps.js')}"`, { stdio: 'inherit', cwd: root })
} catch (e) {
  exitCode = 1
} finally {
  fs.rmSync(outDir, { recursive: true, force: true })
}
process.exit(exitCode)
