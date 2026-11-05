/**
 * Cross-platform `pnpm dev:web`.
 *
 * The old script used POSIX env-prefix syntax (`VAR=value cmd`), which fails on Windows
 * with "VAR is not recognized as an internal or external command". Setting the variable
 * here and spawning Vite keeps one implementation for every platform.
 */
import { spawn } from 'node:child_process'

const child = spawn('pnpm', ['exec', 'vite', '--mode=development'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, OFFICE_EXTENSION_TARGET: 'web' },
})

child.on('error', error => {
    console.error(`dev:web: failed to start vite — ${error.message}`)
    process.exit(1)
})

child.on('exit', code => process.exit(code ?? 0))
