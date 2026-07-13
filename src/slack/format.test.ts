import { describe, expect, it } from 'vitest'
import { formatForSlack } from './format'

function hasPipeTable(text: string): boolean {
  return text.split('\n').some((line) => /^\s*\|.*\|\s*$/.test(line))
}

function hasHorizontalRule(text: string): boolean {
  return text.split('\n').some((line) => /^\s*([-*_]\s*){3,}$/.test(line))
}

function hasGithubBold(text: string): boolean {
  return /\*\*/.test(text)
}

describe('formatForSlack — realistic org overview reply', () => {
  const reply = `Here's everything I found in the org:

---

## Current User
- **Test** (service account) — logged into **Main Org**

---

## Services (11 total)

### OiPer Desktop
Tauri desktop dictation app (React + Rust). Records audio on global hotkey, transcribes locally (Whisper) or cloud, enhances with LLM, injects into active app.
- **APIs:** oiper-gateway (REST), llm-providers (REST) — 4 endpoints
- **DB:** oiper (SQLite)
- **Diagrams:** Application Architecture, Frontend Routing, Cloud Request Sequence, Cloud API Key Resolution, Whisper Model Sync, Application Startup, Transcription Mode Routing, Recording Session Lifecycle, Transcription Pipeline

### E2E Test Service
Synthetic service for e2e harness testing.
- **APIs:** OpenAPI, GraphQL, gRPC — 16 endpoints
- **DBs:** misc, analytics (MongoDB), payments (DynamoDB), notes (SQLite), accounts (Postgres), ecommerce (MySQL)
- **Diagrams:** Styled Node Types, All Styles, All Shapes, All Node Types, Edge Gallery

### Billing Service
Handles invoicing, metering, and the monthly ledger reconciliation job.
- **APIs:** billing-public (REST) — 9 endpoints
- **DB:** billing (Postgres)
- **Diagrams:** Ledger Reconciliation, Dunning Flow

---

Want me to go deeper on any one of these?`

  const out = formatForSlack(reply)

  it('removes every horizontal rule', () => {
    expect(hasHorizontalRule(out)).toBe(false)
  })

  it('emits no GitHub-style bold', () => {
    expect(hasGithubBold(out)).toBe(false)
  })

  it('has no leftover pipe tables', () => {
    expect(hasPipeTable(out)).toBe(false)
  })

  it('preserves the opening and closing prose', () => {
    expect(out).toContain("Here's everything I found in the org:")
    expect(out).toContain('Want me to go deeper on any one of these?')
  })

  it('preserves the current-user line', () => {
    expect(out).toContain('Test')
    expect(out).toContain('service account')
    expect(out).toContain('Main Org')
  })

  it('preserves every service name', () => {
    expect(out).toContain('OiPer Desktop')
    expect(out).toContain('E2E Test Service')
    expect(out).toContain('Billing Service')
  })

  it('preserves service descriptions verbatim', () => {
    expect(out).toContain(
      'Tauri desktop dictation app (React + Rust). Records audio on global hotkey'
    )
    expect(out).toContain('Synthetic service for e2e harness testing.')
    expect(out).toContain(
      'Handles invoicing, metering, and the monthly ledger reconciliation job.'
    )
  })

  it('preserves the API and DB inventory lines', () => {
    expect(out).toContain(
      'oiper-gateway (REST), llm-providers (REST) — 4 endpoints'
    )
    expect(out).toContain('OpenAPI, GraphQL, gRPC — 16 endpoints')
    expect(out).toContain('billing-public (REST) — 9 endpoints')
    expect(out).toContain('oiper (SQLite)')
    expect(out).toContain('analytics (MongoDB), payments (DynamoDB)')
    expect(out).toContain('billing (Postgres)')
  })

  it('preserves the full diagram enumerations', () => {
    expect(out).toContain('Application Architecture, Frontend Routing')
    expect(out).toContain('Recording Session Lifecycle, Transcription Pipeline')
    expect(out).toContain('Styled Node Types, All Styles, All Shapes')
    expect(out).toContain('Ledger Reconciliation, Dunning Flow')
  })
})

describe('formatForSlack — realistic service deep-dive with a 9-row diagram table', () => {
  const reply = `Here's a full breakdown of **OiPer Desktop** — a Tauri-based desktop dictation app built with React (frontend) + Rust (backend).

***

## What it does

Records audio via a global hotkey, transcribes it (locally with Whisper or via cloud), optionally enhances the text using an LLM, and injects the result into whichever app you're actively using.

***

## Architecture at a glance

**Frontend (React)** → Tauri IPC → **Rust Command Handlers** → Services → Cloud APIs / SQLite / Filesystem / OS Keychain

## Diagrams (9)

| Diagram | What it shows |
| ---------------------------- | ------------------------------------------------------------------ |
| Application Architecture | React Frontend → Tauri IPC → Command Handlers → Services → Cloud APIs / SQLite / Filesystem / OS Keychain |
| Frontend Routing | Router root → Access Gates (PermissionGate, OnboardingGate) → App shell → 10 routes (Overview, Models, History, Dictionary, Snippets, Settings, Profile, Sandbox, App State Store, Config Store) |
| Application Startup | Tauri runtime → setup() → init_logging → init_state → ensure_dirs → init SQLite DB (run migrations) → init window (tray + main) → init shortcuts (hotkeys + overlay) → spawn model sync (background) |
| Cloud Request Sequence | OiPer Desktop → POST /v1/generate → OiPer Gateway → ASR provider (transcribe) → LLM provider (enhance) — or directly via LLM input_audio |
| Cloud API Key Resolution | Decision tree: explicit key → named env var → auth store → provider env vars → error |
| Whisper Model Sync | Collect model IDs from profiles → resolve CPU/GPU backend → prune cache → download missing models |
| Transcription Mode Routing | profile.mode → Local (Whisper ± cloud LLM enhance) / Cloud (ASR + LLM transcription or audio) / OiPer (managed) |
| Recording Session Lifecycle | idle → recording → transcribing → enhancing → injecting → idle |
| Transcription Pipeline | capture → VAD → chunk → ASR → merge → post-process → inject |

***

## API Specs (2 groups)

1. **OiPer Gateway API** — \`POST /v1/generate\`
   - Multipart upload of 16 kHz mono WAV
   - Returns transcribed (+ optionally enhanced) text as JSON or plain text
   - Authenticated via bearer token

2. **LLM Providers API** — 3 endpoints
   - \`GET /v1/models\` — list available models
   - \`POST /v1/enhance\` — clean up a raw transcript
   - \`POST /v1/audio\` — direct audio → text`

  const out = formatForSlack(reply)

  it('has no leftover pipe tables', () => {
    expect(hasPipeTable(out)).toBe(false)
  })

  it('removes every horizontal rule', () => {
    expect(hasHorizontalRule(out)).toBe(false)
  })

  it('emits no GitHub-style bold', () => {
    expect(hasGithubBold(out)).toBe(false)
  })

  it('keeps the intro and section headings content', () => {
    expect(out).toContain('OiPer Desktop')
    expect(out).toContain('What it does')
    expect(out).toContain('Architecture at a glance')
    expect(out).toContain('Diagrams (9)')
    expect(out).toContain('API Specs (2 groups)')
  })

  it('turns every diagram row into a labelled bullet, first column bold', () => {
    expect(out).toContain('Application Architecture')
    expect(out).toContain('Frontend Routing')
    expect(out).toContain('Application Startup')
    expect(out).toContain('Cloud Request Sequence')
    expect(out).toContain('Cloud API Key Resolution')
    expect(out).toContain('Whisper Model Sync')
    expect(out).toContain('Transcription Mode Routing')
    expect(out).toContain('Recording Session Lifecycle')
    expect(out).toContain('Transcription Pipeline')
  })

  it('preserves the arrow-heavy diagram descriptions verbatim', () => {
    expect(out).toContain(
      'React Frontend → Tauri IPC → Command Handlers → Services → Cloud APIs / SQLite / Filesystem / OS Keychain'
    )
    expect(out).toContain(
      'Router root → Access Gates (PermissionGate, OnboardingGate) → App shell → 10 routes'
    )
    expect(out).toContain(
      'Tauri runtime → setup() → init_logging → init_state → ensure_dirs → init SQLite DB (run migrations)'
    )
    expect(out).toContain(
      'OiPer Desktop → POST /v1/generate → OiPer Gateway → ASR provider (transcribe) → LLM provider (enhance)'
    )
    expect(out).toContain(
      'idle → recording → transcribing → enhancing → injecting → idle'
    )
    expect(out).toContain(
      'capture → VAD → chunk → ASR → merge → post-process → inject'
    )
  })

  it('preserves the API spec bullets and inline code endpoints', () => {
    expect(out).toContain('POST /v1/generate')
    expect(out).toContain('Multipart upload of 16 kHz mono WAV')
    expect(out).toContain('Returns transcribed (+ optionally enhanced) text')
    expect(out).toContain('Authenticated via bearer token')
    expect(out).toContain('GET /v1/models')
    expect(out).toContain('POST /v1/enhance')
    expect(out).toContain('POST /v1/audio')
    expect(out).toContain('direct audio → text')
  })

  it('does not lose the count in the diagram heading', () => {
    expect(out).toContain('Diagrams (9)')
  })
})

describe('formatForSlack — realistic DB schema reply with vertical and wide tables', () => {
  const reply = `You're right to check — let me confirm everything from the source. Here's what the tools actually report:

***

## Service: OiPer Desktop

| Field | Data |
| --------------- | ----------------------------------- |
| Status | active |
| Tier | tier3 |
| Category | Desktop App |
| Description | Tauri desktop dictation app (React + Rust). Records audio via global hotkey, transcribes locally (Whisper) or in cloud, optionally enhances with an LLM, and injects result into active application. |

***

## Database: oiper (SQLite)

| Table | Column | Type | Nullable | Notes |
| ------------ | ---------------- | --------- | -------- | ------------------------------------ |
| recordings | id | INTEGER | no | primary key |
| recordings | started_at | DATETIME | no | UTC capture start |
| recordings | duration_ms | INTEGER | yes | null while still recording |
| recordings | transcript | TEXT | yes | populated after ASR completes |
| profiles | id | INTEGER | no | primary key |
| profiles | mode | TEXT | no | one of: local, cloud, oiper |
| profiles | asr_model | TEXT | yes | overrides the global default |

Everything above is live from \`get_service_context\` and \`get_db_schema\` — no guessing.`

  const out = formatForSlack(reply)

  it('has no leftover pipe tables', () => {
    expect(hasPipeTable(out)).toBe(false)
  })

  it('removes every horizontal rule', () => {
    expect(hasHorizontalRule(out)).toBe(false)
  })

  it('emits no GitHub-style bold', () => {
    expect(hasGithubBold(out)).toBe(false)
  })

  it('flattens the vertical Field/Data table into value bullets', () => {
    expect(out).toContain('Status')
    expect(out).toContain('active')
    expect(out).toContain('Tier')
    expect(out).toContain('tier3')
    expect(out).toContain('Category')
    expect(out).toContain('Desktop App')
    expect(out).toContain(
      'Tauri desktop dictation app (React + Rust). Records audio via global hotkey'
    )
  })

  it('labels the wide schema table columns by header', () => {
    expect(out).toContain('Column: id')
    expect(out).toContain('Type: INTEGER')
    expect(out).toContain('Nullable: no')
    expect(out).toContain('primary key')
    expect(out).toContain('Column: started_at')
    expect(out).toContain('Type: DATETIME')
    expect(out).toContain('UTC capture start')
    expect(out).toContain('Column: duration_ms')
    expect(out).toContain('null while still recording')
    expect(out).toContain('Column: transcript')
    expect(out).toContain('populated after ASR completes')
  })

  it('keeps both table subjects (recordings, profiles) present', () => {
    expect(out).toContain('recordings')
    expect(out).toContain('profiles')
    expect(out).toContain('one of: local, cloud, oiper')
    expect(out).toContain('overrides the global default')
  })

  it('preserves the tool-provenance footer with inline code', () => {
    expect(out).toContain('get_service_context')
    expect(out).toContain('get_db_schema')
    expect(out).toContain('no guessing')
  })
})

describe('formatForSlack — realistic endpoint listing with a wide table', () => {
  const reply = `Here are all endpoints in the **billing-public** API group:

## Endpoints (9)

| Method | Path | Auth | Description |
| ------ | ----------------------- | -------- | ----------------------------------- |
| GET | /v1/invoices | bearer | List invoices for the current org |
| GET | /v1/invoices/{id} | bearer | Fetch a single invoice |
| POST | /v1/invoices | bearer | Create a draft invoice |
| POST | /v1/invoices/{id}/void | bearer | Void an issued invoice |
| GET | /v1/usage | bearer | Metered usage for the period |
| POST | /v1/usage/report | service | Push a usage record (internal) |
| GET | /v1/ledger | bearer | Read the reconciliation ledger |
| POST | /v1/ledger/reconcile | service | Kick off monthly reconciliation |
| GET | /v1/health | none | Liveness probe |

All bearer endpoints require the \`billing:read\` scope; the \`service\` ones require \`billing:write\`.`

  const out = formatForSlack(reply)

  it('has no leftover pipe tables', () => {
    expect(hasPipeTable(out)).toBe(false)
  })

  it('emits no GitHub-style bold', () => {
    expect(hasGithubBold(out)).toBe(false)
  })

  it('keeps the group name and count', () => {
    expect(out).toContain('billing-public')
    expect(out).toContain('Endpoints (9)')
  })

  it('labels each endpoint row by header', () => {
    expect(out).toContain('Path: /v1/invoices')
    expect(out).toContain('Path: /v1/invoices/{id}')
    expect(out).toContain('Path: /v1/invoices/{id}/void')
    expect(out).toContain('Path: /v1/usage/report')
    expect(out).toContain('Path: /v1/ledger/reconcile')
    expect(out).toContain('Path: /v1/health')
  })

  it('preserves auth and description columns', () => {
    expect(out).toContain('Auth: bearer')
    expect(out).toContain('Auth: service')
    expect(out).toContain('Auth: none')
    expect(out).toContain('List invoices for the current org')
    expect(out).toContain('Kick off monthly reconciliation')
    expect(out).toContain('Liveness probe')
  })

  it('preserves the scope footer', () => {
    expect(out).toContain('billing:read')
    expect(out).toContain('billing:write')
  })
})

describe('formatForSlack — adversarial reply that ignores every formatting rule', () => {
  const reply = `Are you really sure? Check it again. Fine, here is EVERYTHING as a table:

---
***
___

## System Map: Payments

| Frame | Focus | Notes |
| ----- | ---------------- | ----------------------------------- |
| 1 | Checkout | user hits pay → cart service → billing |
| 2 | Ledger | billing → ledger DB → reconciliation job |
| 3 | Payouts | ledger → payout worker → bank rails |

Here's how you'd write that same table in Markdown, for reference:

\`\`\`md
| Frame | Focus |
| ----- | ----- |
| 1 | Checkout |
---
\`\`\`

And a stray separator right here:

- - -

...followed by more prose. Range of frames is 1--3.`

  const out = formatForSlack(reply)

  it('strips all standalone horizontal rules outside code', () => {
    const outsideFence = out
      .split('```')
      .filter((_, index) => index % 2 === 0)
      .join('\n')
    expect(hasHorizontalRule(outsideFence)).toBe(false)
  })

  it('converts the real system-map table to bullets', () => {
    expect(hasPipeTable(out.split('```')[0])).toBe(false)
    expect(out).toContain('Focus: Checkout')
    expect(out).toContain('user hits pay → cart service → billing')
    expect(out).toContain('Focus: Ledger')
    expect(out).toContain('billing → ledger DB → reconciliation job')
    expect(out).toContain('Focus: Payouts')
    expect(out).toContain('ledger → payout worker → bank rails')
  })

  it('leaves the fenced markdown example completely untouched', () => {
    expect(out).toContain('| Frame | Focus |')
    expect(out).toContain('| 1 | Checkout |')
    expect(out).toContain('```')
  })

  it('keeps look-alike text like a two-dash range', () => {
    expect(out).toContain('1--3')
    expect(out).toContain('followed by more prose')
  })

  it('emits no GitHub-style bold', () => {
    expect(hasGithubBold(out)).toBe(false)
  })
})

describe('formatForSlack — edge cases packed into one pass', () => {
  it('handles a table with a trailing pipe-free paragraph', () => {
    const reply = `| K | V |
| --- | --- |
| a | 1 |
| b | 2 |

That's the config.`
    const out = formatForSlack(reply)
    expect(hasPipeTable(out)).toBe(false)
    expect(out).toContain('a')
    expect(out).toContain('b')
    expect(out).toContain("That's the config.")
  })

  it('handles back-to-back tables with no blank line between sections', () => {
    const reply = `| A | B |
| --- | --- |
| a1 | b1 |
prose divider
| C | D |
| --- | --- |
| c1 | d1 |`
    const out = formatForSlack(reply)
    expect(hasPipeTable(out)).toBe(false)
    expect(out).toContain('prose divider')
    for (const v of ['a1', 'b1', 'c1', 'd1']) {
      expect(out).toContain(v)
    }
  })

  it('does not double-bold an already-emphasised first cell', () => {
    const reply = `| Name | Note |
| --- | --- |
| **auth** | core identity |
| _billing_ | metering |`
    const out = formatForSlack(reply)
    expect(hasGithubBold(out)).toBe(false)
    expect(out).toContain('auth')
    expect(out).toContain('core identity')
    expect(out).toContain('billing')
    expect(out).toContain('metering')
  })

  it('tolerates ragged rows that drop trailing cells', () => {
    const reply = `| Name | Type | Owner |
| --- | --- | --- |
| auth | service | platform |
| cache | service |
| gateway |`
    const out = formatForSlack(reply)
    expect(hasPipeTable(out)).toBe(false)
    expect(out).toContain('Type: service')
    expect(out).toContain('Owner: platform')
    expect(out).toContain('auth')
    expect(out).toContain('cache')
    expect(out).toContain('gateway')
  })

  it('treats a lone inline pipe (no separator) as ordinary text', () => {
    const reply = 'Use the `a | b` fallback and pipe `x | y` through.'
    const out = formatForSlack(reply)
    expect(out).toContain('a | b')
    expect(out).toContain('x | y')
  })

  it('strips spaced rule variants but keeps bullet lists', () => {
    const reply = `intro
- - -
- item one
* item two
* * *
outro`
    const out = formatForSlack(reply)
    expect(hasHorizontalRule(out)).toBe(false)
    expect(out).toContain('intro')
    expect(out).toContain('item one')
    expect(out).toContain('item two')
    expect(out).toContain('outro')
  })

  it('preserves an indentation-heavy nested bullet list', () => {
    const reply = `Structure:
- top
  - middle
    - leaf a
    - leaf b
  - middle two
- top two`
    const out = formatForSlack(reply)
    expect(out).toContain('top')
    expect(out).toContain('middle')
    expect(out).toContain('leaf a')
    expect(out).toContain('leaf b')
    expect(out).toContain('middle two')
    expect(out).toContain('top two')
  })

  it('remains structurally clean across a redundant second pass', () => {
    const reply = `## Head
| K | V |
| --- | --- |
| k1 | v1 |
---
tail`
    const twice = formatForSlack(formatForSlack(reply))
    expect(hasPipeTable(twice)).toBe(false)
    expect(hasHorizontalRule(twice)).toBe(false)
    expect(twice).toContain('k1')
    expect(twice).toContain('v1')
    expect(twice).toContain('tail')
  })

  it('returns empty for empty input', () => {
    expect(formatForSlack('').trim()).toBe('')
  })

  it('passes plain single-line prose through unharmed', () => {
    const out = formatForSlack('The billing service talks to the ledger DB.')
    expect(out).toContain('The billing service talks to the ledger DB.')
  })
})

function makeRng(seed: number): () => number {
  let state = seed
  return function next(): number {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SUBJECTS = [
  'auth',
  'billing',
  'ledger',
  'gateway',
  'cache',
  'payments',
  'notes',
  'accounts',
  'ecommerce',
  'analytics',
  'recordings',
  'profiles',
  'invoices',
  'usage',
  'reconcile',
  'checkout',
  'payout',
  'dunning',
  'metering',
  'identity',
  'catalog',
  'inventory',
  'shipping',
  'search',
]

const VALUES = [
  'service',
  'worker',
  'active',
  'inactive',
  'tier1',
  'tier2',
  'tier3',
  'Postgres',
  'MySQL',
  'SQLite',
  'MongoDB',
  'DynamoDB',
  'REST',
  'GraphQL',
  'gRPC',
  'bearer',
  'none',
  'primary key',
  'not null',
  'nullable',
  'UTC start',
  'read only',
  'write heavy',
  'batch job',
]

const HEADERS = [
  'Name',
  'Type',
  'Owner',
  'Status',
  'Path',
  'Auth',
  'Column',
  'Nullable',
  'Notes',
  'Focus',
  'Frame',
  'Field',
  'Data',
  'Mode',
  'Backend',
  'Scope',
  'Region',
  'Kind',
]

const HR_VARIANTS = [
  '---',
  '***',
  '___',
  '- - -',
  '* * *',
  '-----',
  '****',
  '____',
]

const PROSE = [
  'Here is what I found in the org.',
  'No guessing, this is straight from the tools.',
  'Want me to go deeper on any of these?',
  'That is the full picture from the source.',
  'Everything below is live data.',
  'Let me confirm from the actual tool output.',
  'This scopes to the current organization only.',
]

const SEPARATOR_CELLS = ['---', ':---', '---:', ':---:', '----', '-----']

type GeneratedCase = {
  name: string
  input: string
  out: string
  tokens: string[]
}

function generateCase(seed: number): GeneratedCase {
  const rng = makeRng(seed)
  function pick<T>(arr: T[]): T {
    return arr[Math.floor(rng() * arr.length)]
  }
  function int(min: number, max: number): number {
    return min + Math.floor(rng() * (max - min + 1))
  }
  function arrowChain(): string {
    const count = int(2, 5)
    const parts: string[] = []
    for (let i = 0; i < count; i++) {
      parts.push(pick(SUBJECTS))
    }
    return parts.join(' → ')
  }

  const tokens: string[] = []
  const lines: string[] = []

  const leadingProse = pick(PROSE)
  tokens.push(leadingProse)
  lines.push(leadingProse)
  lines.push('')

  const hrBefore = int(0, 3)
  for (let i = 0; i < hrBefore; i++) {
    lines.push(pick(HR_VARIANTS))
  }
  lines.push('')

  const heading = `## ${pick(SUBJECTS)} report`
  lines.push(heading)
  lines.push('')

  const tableCount = int(1, 3)
  for (let t = 0; t < tableCount; t++) {
    const cols = int(2, 6)
    const headerCells: string[] = []
    const usedHeaders = new Set<string>()
    while (headerCells.length < cols) {
      const h = pick(HEADERS)
      if (usedHeaders.has(h)) {
        continue
      }
      usedHeaders.add(h)
      headerCells.push(h)
    }
    lines.push(`| ${headerCells.join(' | ')} |`)

    const sepCells: string[] = []
    for (let c = 0; c < cols; c++) {
      sepCells.push(pick(SEPARATOR_CELLS))
    }
    lines.push(`| ${sepCells.join(' | ')} |`)

    const rows = int(1, 8)
    for (let r = 0; r < rows; r++) {
      const cells: string[] = []
      const first = pick(SUBJECTS)
      cells.push(first)
      tokens.push(first)
      for (let c = 1; c < cols; c++) {
        const value = rng() < 0.35 ? arrowChain() : pick(VALUES)
        cells.push(value)
        tokens.push(value)
      }
      lines.push(`| ${cells.join(' | ')} |`)
    }
    lines.push('')

    if (rng() < 0.6) {
      lines.push(pick(HR_VARIANTS))
      lines.push('')
    }
  }

  const bulletCount = int(0, 4)
  for (let b = 0; b < bulletCount; b++) {
    const token = pick(SUBJECTS)
    tokens.push(token)
    lines.push(`- ${token} — ${pick(VALUES)}`)
  }
  lines.push('')

  const hrAfter = int(0, 2)
  for (let i = 0; i < hrAfter; i++) {
    lines.push(pick(HR_VARIANTS))
  }

  const trailingProse = pick(PROSE)
  tokens.push(trailingProse)
  lines.push(trailingProse)

  const input = lines.join('\n')
  return {
    name: `case-${seed}`,
    input,
    out: formatForSlack(input),
    tokens,
  }
}

const GENERATED_CASE_COUNT = 1200
const generatedCases: GeneratedCase[] = []
for (let seed = 1; seed <= GENERATED_CASE_COUNT; seed++) {
  generatedCases.push(generateCase(seed))
}

describe('formatForSlack — generated fuzz corpus (invariants)', () => {
  it.each(generatedCases)('never leaves a pipe table ($name)', ({ out }) => {
    expect(hasPipeTable(out)).toBe(false)
  })

  it.each(generatedCases)(
    'never leaves a horizontal rule ($name)',
    ({ out }) => {
      expect(hasHorizontalRule(out)).toBe(false)
    }
  )

  it.each(generatedCases)(
    'never leaks GitHub-style bold ($name)',
    ({ out }) => {
      expect(hasGithubBold(out)).toBe(false)
    }
  )

  it.each(generatedCases)(
    'preserves every content token ($name)',
    ({ out, tokens }) => {
      for (const token of tokens) {
        expect(out).toContain(token)
      }
    }
  )
})

function generateHrOnlyCase(seed: number): { input: string; out: string } {
  const rng = makeRng(seed * 7919)
  function pick<T>(arr: T[]): T {
    return arr[Math.floor(rng() * arr.length)]
  }
  const lineCount = 3 + Math.floor(rng() * 8)
  const lines: string[] = []
  for (let i = 0; i < lineCount; i++) {
    if (rng() < 0.5) {
      lines.push(pick(HR_VARIANTS))
    } else {
      lines.push(pick(PROSE))
    }
  }
  const input = lines.join('\n')
  return { input, out: formatForSlack(input) }
}

const HR_CASE_COUNT = 600
const hrCases: { name: string; input: string; out: string }[] = []
for (let seed = 1; seed <= HR_CASE_COUNT; seed++) {
  const { input, out } = generateHrOnlyCase(seed)
  hrCases.push({ name: `hr-${seed}`, input, out })
}

describe('formatForSlack — generated horizontal-rule corpus', () => {
  it.each(hrCases)(
    'removes all rules and keeps prose ($name)',
    ({ input, out }) => {
      expect(hasHorizontalRule(out)).toBe(false)
      for (const line of input.split('\n')) {
        if (PROSE.includes(line)) {
          expect(out).toContain(line)
        }
      }
    }
  )
})

function generateWideTableCase(seed: number): {
  name: string
  out: string
  labelled: string[]
} {
  const rng = makeRng(seed * 104729)
  function pick<T>(arr: T[]): T {
    return arr[Math.floor(rng() * arr.length)]
  }
  const cols = 3 + Math.floor(rng() * 4)
  const headerCells: string[] = []
  const used = new Set<string>()
  while (headerCells.length < cols) {
    const h = pick(HEADERS)
    if (used.has(h)) {
      continue
    }
    used.add(h)
    headerCells.push(h)
  }
  const lines: string[] = [
    `| ${headerCells.join(' | ')} |`,
    `| ${headerCells.map(() => '---').join(' | ')} |`,
  ]
  const labelled: string[] = []
  const rows = 1 + Math.floor(rng() * 5)
  for (let r = 0; r < rows; r++) {
    const cells = [pick(SUBJECTS)]
    for (let c = 1; c < cols; c++) {
      const value = pick(VALUES)
      cells.push(value)
      labelled.push(`${headerCells[c]}: ${value}`)
    }
    lines.push(`| ${cells.join(' | ')} |`)
  }
  const input = lines.join('\n')
  return { name: `wide-${seed}`, out: formatForSlack(input), labelled }
}

const WIDE_CASE_COUNT = 600
const wideCases: { name: string; out: string; labelled: string[] }[] = []
for (let seed = 1; seed <= WIDE_CASE_COUNT; seed++) {
  wideCases.push(generateWideTableCase(seed))
}

describe('formatForSlack — generated wide-table corpus (header labelling)', () => {
  it.each(wideCases)(
    'labels every non-first column by header ($name)',
    ({ out, labelled }) => {
      expect(hasPipeTable(out)).toBe(false)
      for (const pair of labelled) {
        expect(out).toContain(pair)
      }
    }
  )
})
