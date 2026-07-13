import { describe, expect, it } from 'vitest'
import { formatForSlack, normalizeSlackMessage } from './format'

describe('normalizeSlackMessage — pulls markdown images into assets', () => {
  it('extracts a single image and removes it from the text', () => {
    const input = 'Here is it:\n\n![diagram](https://x/y.png)\n\nDone.'
    expect(normalizeSlackMessage(input)).toEqual({
      message: 'Here is it:\n\n\n\nDone.',
      assets: ['https://x/y.png'],
    })
  })

  it('extracts multiple images in order', () => {
    const input = '![a](https://x/a.png) and ![b](https://x/b.png)'
    expect(normalizeSlackMessage(input)).toEqual({
      message: ' and ',
      assets: ['https://x/a.png', 'https://x/b.png'],
    })
  })

  it('drops an optional title and keeps only the url', () => {
    const input = '![alt](https://x/y.png "a title")'
    expect(normalizeSlackMessage(input)).toEqual({
      message: '',
      assets: ['https://x/y.png'],
    })
  })

  it('extracts an image with empty alt text', () => {
    const input = '![](https://x/y.png)'
    expect(normalizeSlackMessage(input)).toEqual({
      message: '',
      assets: ['https://x/y.png'],
    })
  })

  it('leaves a plain link untouched', () => {
    const input = 'See [the docs](https://x/docs).'
    expect(normalizeSlackMessage(input)).toEqual({
      message: 'See [the docs](https://x/docs).',
      assets: [],
    })
  })

  it('optimizes tables while extracting images', () => {
    const input =
      '| Name | Type |\n| --- | --- |\n| billing | service |\n\n![d](https://x/d.png)'
    expect(normalizeSlackMessage(input)).toEqual({
      message: '- **billing** — service\n\n',
      assets: ['https://x/d.png'],
    })
  })

  it('returns empty assets when there are no images', () => {
    const input = 'Just some text.'
    expect(normalizeSlackMessage(input)).toEqual({
      message: 'Just some text.',
      assets: [],
    })
  })
})

describe('formatForSlack — returns slackified message and assets', () => {
  it('slackifies the normalized message and returns extracted assets', () => {
    const input = 'Here is it:\n\n![diagram](https://x/y.png)\n\nDone.'
    const result = formatForSlack(input)
    expect(result.assets).toEqual(['https://x/y.png'])
    expect(result.message).not.toContain('https://x/y.png')
    expect(result.message).toContain('Here is it:')
    expect(result.message).toContain('Done.')
  })

  it('returns empty assets for a message with no images', () => {
    expect(formatForSlack('Just some text.')).toEqual({
      message: 'Just some text.\n',
      assets: [],
    })
  })
})
