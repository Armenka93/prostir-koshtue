#!/usr/bin/env node
// Compiles + runs the deterministic autosave engine test
// (src/lib/autosaveEngine.ts via scripts/test-autosave-engine.ts) — no
// Supabase, no network, no DOM. Cleans up its scratch output in `finally`
// regardless of pass/fail, and propagates a non-zero exit code on failure.
// Plain Node (no ts-node/tsx dependency) — cross-platform, not PowerShell-specific.
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const outDir = path.join(root, '.scratch-autosave-test')

let exitCode = 0
try {
  execSync(
    `npx tsc scripts/test-autosave-engine.ts src/lib/autosaveEngine.ts --outDir "${outDir}" --module commonjs --target es2019 --esModuleInterop --skipLibCheck --moduleResolution node`,
    { stdio: 'inherit', cwd: root }
  )
  execSync(`node "${path.join(outDir, 'scripts', 'test-autosave-engine.js')}"`, { stdio: 'inherit', cwd: root })
} catch (e) {
  exitCode = 1
} finally {
  fs.rmSync(outDir, { recursive: true, force: true })
}
process.exit(exitCode)
