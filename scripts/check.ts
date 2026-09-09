import "./check-startup.ts"
import "./check-backbone.ts"
import "./check-bundle.ts"
import "./check-stage.ts"
import "./check-playbook.ts"
import "./check-agent-turn.ts"
import "./check-starter.ts"
import "./check-authoring-trigger.ts"
import "./check-experience.ts"
import "./check-webmcp.ts"
import "./check-character.ts"
import "./check-character-creation.ts"
import "./check-character-normalization.ts"
import "./check-character-workspace.ts"
import "./check-character-workspace-events.ts"
import "./check-character-editor.ts"
import "./check-scene.ts"
import "./check-items.ts"
import "./check-history.ts"
import "./check-journal.ts"
import "./check-portable.ts"
import "./check-storage-persistence.ts"
import "./check-workspace.ts"
import "./check-character-composite.ts"
import "./check-character-library.ts"

// Run IndexedDB fixtures after the other modules have settled; each owns its records.
await import('./check-character-collections.ts')
await import('./check-character-library-concurrency.ts')
await import('./check-character-model-sheet.ts')

// Isolate module mocks and browser globals from the other checks.
const { execFileSync } = await import('node:child_process')
execFileSync(process.execPath, ['--experimental-strip-types', '--experimental-test-module-mocks', 'scripts/check-character-renderer.ts'], { stdio: 'inherit' })
execFileSync(process.execPath, ['--experimental-strip-types', 'scripts/check-character-fit.ts'], { stdio: 'inherit' })
