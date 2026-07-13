import { describe, expect, it } from 'vitest'
import { rulesToBlankLines } from './format'

describe('rulesToBlankLines — an exact *** line becomes two blank lines', () => {
  it('replaces *** between two sections with two blank lines', () => {
    expect(rulesToBlankLines('Section A\n\n***\n\nSection B')).toBe(
      'Section A\n\n\nSection B'
    )
  })

  it('does not replace *** with leading spaces', () => {
    expect(rulesToBlankLines('Section A\n\n   ***\n\nSection B')).toBe(
      'Section A\n\n   ***\n\nSection B'
    )
  })

  it('does not replace *** with trailing spaces', () => {
    expect(rulesToBlankLines('Section A\n\n***   \n\nSection B')).toBe(
      'Section A\n\n***   \n\nSection B'
    )
  })

  it('does not replace a line of four stars', () => {
    expect(rulesToBlankLines('Section A\n\n****\n\nSection B')).toBe(
      'Section A\n\n****\n\nSection B'
    )
  })

  it('replaces two stacked rules', () => {
    expect(rulesToBlankLines('A\n\n***\n\n***\n\nB')).toBe('A\n\n\nB')
  })

  it('handles three sections separated by rules', () => {
    expect(rulesToBlankLines('A\n\n***\n\nB\n\n***\n\nC')).toBe(
      'A\n\n\nB\n\n\nC'
    )
  })

  it('drops a leading rule', () => {
    expect(rulesToBlankLines('***\n\nBody text.')).toBe('\nBody text.')
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

  it('caps a run of four or more newlines at two blank lines', () => {
    expect(rulesToBlankLines('A\n\n\n\nB')).toBe('A\n\n\nB')
  })

  it('leaves a single blank line untouched', () => {
    expect(rulesToBlankLines('A\n\nB')).toBe('A\n\nB')
  })
})
