import { describe, expect, it } from 'vitest'
import { tablesToBullets } from './format'

describe('tablesToBullets — pipe tables become bullet lists', () => {
  it('turns a 2-column table into bullets', () => {
    const input =
      '| Name | Type |\n| --- | --- |\n| billing | service |\n| auth | worker |'
    expect(tablesToBullets(input)).toBe(
      '- **billing** — service\n- **auth** — worker'
    )
  })

  it('turns a single-row table into one bullet', () => {
    const input = '| Name | Type |\n| --- | --- |\n| billing | service |'
    expect(tablesToBullets(input)).toBe('- **billing** — service')
  })

  it('labels extra columns by header for a 3-column table', () => {
    const input =
      '| Name | Type | Owner |\n| --- | --- | --- |\n| billing | service | platform |\n| auth | worker | security |'
    expect(tablesToBullets(input)).toBe(
      '- **billing** — Type: service · Owner: platform\n' +
        '- **auth** — Type: worker · Owner: security'
    )
  })

  it('labels every extra column for a 4-column table', () => {
    const input =
      '| Name | Type | Owner | Status |\n| --- | --- | --- | --- |\n| billing | service | platform | active |'
    expect(tablesToBullets(input)).toBe(
      '- **billing** — Type: service · Owner: platform · Status: active'
    )
  })

  it('keeps prose that follows a table', () => {
    const input =
      '| Name | Type |\n| --- | --- |\n| billing | service |\n\nThat is all.'
    expect(tablesToBullets(input)).toBe(
      '- **billing** — service\n\nThat is all.'
    )
  })

  it('keeps prose that precedes a table', () => {
    const input =
      'Here they are:\n\n| Name | Type |\n| --- | --- |\n| billing | service |'
    expect(tablesToBullets(input)).toBe(
      'Here they are:\n\n- **billing** — service'
    )
  })

  it('does not touch a pipe table inside a code fence', () => {
    const input = 'Run this:\n\n```\n| not | a | table |\n---\n```\n\nDone.'
    expect(tablesToBullets(input)).toBe(
      'Run this:\n\n```\n| not | a | table |\n---\n```\n\nDone.'
    )
  })

  it('converts the table and leaves rules and headings for later phases', () => {
    const input =
      "Here's the org:\n\n---\n\n## Services\n\n| Name | DB |\n| --- | --- |\n| billing | Postgres |\n| auth | SQLite |\n\n---\n\nWant more?"
    expect(tablesToBullets(input)).toBe(
      "Here's the org:\n\n---\n\n## Services\n\n" +
        '- **billing** — Postgres\n- **auth** — SQLite\n\n' +
        '---\n\nWant more?'
    )
  })
})
