import { describe, expect, it } from 'vitest'
import { formatForSlack } from './format'

describe('formatForSlack — horizontal rules become a single blank line', () => {
  it('replaces --- with one blank line', () => {
    expect(formatForSlack('Section A\n\n---\n\nSection B')).toBe(
      'Section A\n\nSection B\n'
    )
  })

  it('replaces *** with one blank line', () => {
    expect(formatForSlack('Section A\n\n***\n\nSection B')).toBe(
      'Section A\n\nSection B\n'
    )
  })

  it('replaces ___ with one blank line', () => {
    expect(formatForSlack('Section A\n\n___\n\nSection B')).toBe(
      'Section A\n\nSection B\n'
    )
  })

  it('replaces spaced - - - with one blank line', () => {
    expect(formatForSlack('Section A\n\n- - -\n\nSection B')).toBe(
      'Section A\n\nSection B\n'
    )
  })

  it('replaces spaced * * * with one blank line', () => {
    expect(formatForSlack('Section A\n\n* * *\n\nSection B')).toBe(
      'Section A\n\nSection B\n'
    )
  })

  it('replaces a long dash run with one blank line', () => {
    expect(formatForSlack('Section A\n\n-----\n\nSection B')).toBe(
      'Section A\n\nSection B\n'
    )
  })
})

describe('formatForSlack — bold and headings', () => {
  it('converts GitHub bold to Slack bold', () => {
    expect(formatForSlack('The **billing** service is **active**.')).toBe(
      'The ​*billing*​ service is ​*active*​.\n'
    )
  })

  it('converts a heading to Slack bold', () => {
    expect(formatForSlack('## Services\n\nWe have three.')).toBe(
      '*Services*\n\nWe have three.\n'
    )
  })
})

describe('formatForSlack — plain text and bullets pass through', () => {
  it('leaves plain prose intact', () => {
    expect(formatForSlack('The billing service talks to the ledger DB.')).toBe(
      'The billing service talks to the ledger DB.\n'
    )
  })

  it('keeps an existing bullet list', () => {
    expect(formatForSlack('- billing — active\n- auth — active')).toBe(
      '•   billing — active\n•   auth — active\n'
    )
  })
})

describe('formatForSlack — tables become bullet lists', () => {
  it('turns a 2-column table into bullets', () => {
    const input =
      '| Name | Type |\n| --- | --- |\n| billing | service |\n| auth | worker |'
    expect(formatForSlack(input)).toBe(
      '•   ​*billing*​ — service\n' + '•   ​*auth*​ — worker\n'
    )
  })

  it('labels extra columns by header for a wide table', () => {
    const input =
      '| Name | Type | Owner |\n| --- | --- | --- |\n| billing | service | platform |\n| auth | worker | security |'
    expect(formatForSlack(input)).toBe(
      '•   ​*billing*​ — Type: service · Owner: platform\n' +
        '•   ​*auth*​ — Type: worker · Owner: security\n'
    )
  })
})

describe('formatForSlack — fenced code is untouched', () => {
  it('does not strip rules or tables inside a code fence', () => {
    const input = 'Run this:\n\n```\n| not | a | table |\n---\n```\n\nDone.'
    expect(formatForSlack(input)).toBe(
      'Run this:\n\n```\n| not | a | table |\n---\n```\n\nDone.\n'
    )
  })
})

describe('formatForSlack — realistic combined reply', () => {
  it('strips rules, converts the table, and keeps prose', () => {
    const input =
      "Here's the org:\n\n---\n\n## Services\n\n| Name | DB |\n| --- | --- |\n| billing | Postgres |\n| auth | SQLite |\n\n---\n\nWant more?"
    expect(formatForSlack(input)).toBe(
      "Here's the org:\n\n*Services*\n\n" +
        '•   ​*billing*​ — Postgres\n' +
        '•   ​*auth*​ — SQLite\n\n' +
        'Want more?\n'
    )
  })
})
