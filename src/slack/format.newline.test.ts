import { describe, expect, it } from 'vitest'
import { rulesToBlankLines } from './format'

describe('rulesToBlankLines — a *** rule line becomes one blank line', () => {
  it('replaces *** between two sections with a single blank line', () => {
    expect(rulesToBlankLines('Section A\n\n***\n\nSection B')).toBe(
      'Section A\n\nSection B'
    )
  })

  it('replaces *** with leading spaces', () => {
    expect(rulesToBlankLines('Section A\n\n   ***\n\nSection B')).toBe(
      'Section A\n\nSection B'
    )
  })

  it('replaces *** with trailing spaces', () => {
    expect(rulesToBlankLines('Section A\n\n***   \n\nSection B')).toBe(
      'Section A\n\nSection B'
    )
  })

  it('collapses two stacked rules into a single blank line', () => {
    expect(rulesToBlankLines('A\n\n***\n\n***\n\nB')).toBe('A\n\nB')
  })

  it('handles three sections separated by rules', () => {
    expect(rulesToBlankLines('A\n\n***\n\nB\n\n***\n\nC')).toBe('A\n\nB\n\nC')
  })

  it('drops a leading rule', () => {
    expect(rulesToBlankLines('***\n\nBody text.')).toBe('\n\nBody text.')
  })

  it('drops a trailing rule', () => {
    expect(rulesToBlankLines('Body text.\n\n***')).toBe('Body text.\n\n')
  })

  it('leaves *** inside a sentence untouched', () => {
    expect(rulesToBlankLines('Use *** inside a sentence like this.')).toBe(
      'Use *** inside a sentence like this.'
    )
  })

  it('leaves *bold* text untouched', () => {
    expect(rulesToBlankLines('This is *important* text.')).toBe(
      'This is *important* text.'
    )
  })

  it('collapses any run of three or more newlines to one blank line', () => {
    expect(rulesToBlankLines('A\n\n\n\nB')).toBe('A\n\nB')
  })

  it('leaves a single blank line untouched', () => {
    expect(rulesToBlankLines('A\n\nB')).toBe('A\n\nB')
  })
})
