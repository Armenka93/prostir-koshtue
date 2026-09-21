#!/usr/bin/env node
// Compiles + runs the unit tests for src/lib/pendingReviewCursor.ts — pure,
// no Supabase, no network, no env vars. Cleans up its scratch output in
// `finally` regardless of pass/fail, and propagates a non-zero exit code
// on failure.
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const outDir = path.join(root, '.scratch-pending-review-cursor-test')

let exitCode = 0
try {
  execSync(
    `npx tsc scripts/test-pending-review-cursor.ts src/lib/pendingReviewCursor.ts --outDir "${outDir}" --module commonjs --target es2019 --esModuleInterop --skipLibCheck --moduleResolution node`,
    { stdio: 'inherit', cwd: root }
  )
  execSync(`node "${path.join(outDir, 'scripts', 'test-pending-review-cursor.js')}"`, { stdio: 'inherit', cwd: root })
} catch (e) {
  exitCode = 1
} finally {
  fs.rmSync(outDir, { recursive: true, force: true })
}
process.exit(exitCode)
