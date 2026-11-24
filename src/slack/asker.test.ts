import { describe, expect, it } from 'vitest'
import { outputsForAsker } from './asker'

describe('outputsForAsker', () => {
  const payload = { toolOutputs: ['a', 'b'], askerId: 'U1' }

  it('hands a turn’s outputs back to the person who asked', () => {
    expect(outputsForAsker(payload, 'U1')).toEqual(['a', 'b'])
  })

  it('keeps them from anyone else in the thread', () => {
    expect(outputsForAsker(payload, 'U2')).toBeUndefined()
  })

  it('keeps older replies and service-account turns working', () => {
    expect(outputsForAsker({ toolOutputs: ['a'] }, 'U2')).toEqual(['a'])
    expect(outputsForAsker(payload, undefined)).toEqual(['a', 'b'])
    expect(outputsForAsker({}, 'U1')).toBeUndefined()
  })
})
