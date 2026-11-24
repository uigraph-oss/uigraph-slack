import { describe, expect, it } from 'vitest'
import { isSafeTool } from './tools'

describe('isSafeTool', () => {
  it('allows read-only and add-only tools', () => {
    expect(isSafeTool({ readOnlyHint: true })).toBe(true)
    expect(isSafeTool({ readOnlyHint: false, destructiveHint: false })).toBe(
      true
    )
  })

  it('refuses tools that change or remove, and tools that say nothing', () => {
    expect(isSafeTool({ readOnlyHint: false, destructiveHint: true })).toBe(
      false
    )
    expect(isSafeTool({})).toBe(false)
    expect(isSafeTool(undefined)).toBe(false)
  })
})
