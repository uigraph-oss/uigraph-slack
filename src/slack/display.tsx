import { tool, type ToolSet } from 'ai'
import {
  Actions,
  Button,
  Card,
  CardText,
  Chart,
  Field,
  Fields,
  Select,
  SelectOption,
  Table,
  toCardElement,
  type PostableMessage,
} from 'chat'
import { z } from 'zod'

// What one turn shows besides its text. Cards are posted under the answer once it is written, and
// videos are delivered after that. toolOutputs holds the UIGraph tool results seen so far.
export type TurnDisplay = {
  posts: PostableMessage[]
  videos: string[]
  toolOutputs: string[]
}

// Slack needs every button in a row to have its own action id, so each follow-up gets one.
export const ASK_ACTION_IDS = ['ask', 'ask_2', 'ask_3']

export function asCard(element: unknown) {
  const card = toCardElement(element)
  if (!card) throw new Error('Expected a card element')
  return card
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export function displayTools(turn: TurnDisplay): ToolSet {
  return {
    show_table: tool({
      description: 'Show rows of data as a sortable Slack table.',
      inputSchema: z.object({
        title: z.string(),
        headers: z.array(z.string()),
        rows: z.array(z.array(z.string())),
      }),
      execute: async (input) => {
        turn.posts.push({
          card: asCard(
            <Card>
              <Table
                headers={input.headers}
                rows={input.rows}
                caption={input.title}
                pageSize={10}
              />
            </Card>
          ),
          fallbackText: `${input.title}: ${input.rows.map((row) => row.join(' · ')).join('; ')}`,
        })
        return 'It will appear right below your reply.'
      },
    }),
    show_chart: tool({
      description: 'Show numbers as a pie or bar chart.',
      inputSchema: z.object({
        title: z.string().max(50),
        type: z.enum(['pie', 'bar']),
        unit: z
          .string()
          .max(20)
          .describe(
            'What the numbers count, like "Endpoints" or "Failed tests"'
          ),
        items: z
          .array(z.object({ label: z.string(), value: z.number() }))
          .max(12),
      }),
      execute: async (input) => {
        const items = input.items.map((item) => ({
          label:
            item.label.length > 20 ? `${item.label.slice(0, 19)}…` : item.label,
          value: item.value,
        }))
        if (new Set(items.map((item) => item.label)).size !== items.length) {
          throw new Error(
            'Labels must stay different after shortening to 20 characters'
          )
        }
        const chart =
          input.type === 'pie'
            ? {
                type: 'pie' as const,
                segments: items.filter((item) => item.value > 0),
              }
            : {
                type: 'bar' as const,
                categories: items.map((item) => item.label),
                series: [{ name: input.unit, data: items }],
              }
        turn.posts.push({
          card: asCard(
            <Card>
              <Chart title={input.title} chart={chart} />
            </Card>
          ),
          fallbackText: `${input.title}: ${input.items.map((item) => `${item.label} ${item.value}`).join(', ')}`,
        })
        return 'It will appear right below your reply.'
      },
    }),
    show_card: tool({
      description:
        'Show one service or item with its key facts. Pass service_id for a service so the card offers a video button, and up to 3 follow_ups: short next questions the person can ask with one click.',
      inputSchema: z.object({
        title: z.string(),
        subtitle: z.string().optional(),
        summary: z.string().optional(),
        fields: z
          .array(z.object({ label: z.string(), value: z.string() }))
          .max(10),
        service_id: z.string().optional(),
        follow_ups: z.array(z.string().max(150)).max(3).optional(),
      }),
      execute: async (input) => {
        const followUps = input.follow_ups ?? []
        turn.posts.push({
          card: asCard(
            <Card title={input.title} subtitle={input.subtitle}>
              {input.summary && <CardText>{input.summary}</CardText>}
              <Fields>
                {input.fields.map((field) => (
                  <Field label={field.label} value={field.value} />
                ))}
              </Fields>
              {(input.service_id || followUps.length > 0) && (
                <Actions>
                  {input.service_id && (
                    <Button
                      id="make_video"
                      value={input.service_id}
                      actionType="modal"
                      style="primary"
                    >
                      Explain as a video
                    </Button>
                  )}
                  {followUps.map((question, index) => (
                    <Button id={ASK_ACTION_IDS[index]} value={question}>
                      {question}
                    </Button>
                  ))}
                </Actions>
              )}
            </Card>
          ),
          fallbackText: `${input.title}: ${input.fields.map((field) => `${field.label} ${field.value}`).join(', ')}`,
        })
        return 'It will appear right below your reply.'
      },
    }),
    show_diagram: tool({
      description:
        'Show an architecture diagram as an image. First call get_diagram with include_thumbnail: true, then pass the thumbnailURL it returned.',
      inputSchema: z.object({
        title: z.string(),
        image_url: z.string(),
      }),
      execute: async (input) => {
        if (
          !turn.toolOutputs.some((output) => output.includes(input.image_url))
        ) {
          throw new Error(
            'image_url must be a thumbnailURL returned by get_diagram in this turn'
          )
        }
        const response = await fetch(input.image_url)
        if (!response.ok) {
          throw new Error(`Diagram image download failed: ${response.status}`)
        }
        const mimeType = (response.headers.get('content-type') ?? '')
          .split(';')[0]
          .trim()
        const extension = IMAGE_EXTENSIONS[mimeType]
        if (extension === undefined) {
          throw new Error(`Diagram image has unsupported type "${mimeType}"`)
        }
        turn.posts.push({
          card: asCard(
            <Card title={input.title}>
              <CardText>Architecture diagram from UIGraph</CardText>
            </Card>
          ),
          fallbackText: `Diagram: ${input.title}`,
          files: [
            {
              data: Buffer.from(await response.arrayBuffer()),
              filename: `${input.title}.${extension}`,
              mimeType,
            },
          ],
        })
        return 'It will appear right below your reply.'
      },
    }),
    share_video: tool({
      description:
        'Post an existing walkthrough video into the thread so it plays in Slack. Videos made with create_video are posted on their own; do not share them again.',
      inputSchema: z.object({ doc_id: z.string() }),
      execute: async (input) => {
        if (!turn.videos.includes(input.doc_id)) turn.videos.push(input.doc_id)
        return 'It will be posted under your answer.'
      },
    }),
    offer_choices: tool({
      description:
        'Ask the person to pick one option from a menu. Each value is the follow-up question to answer when picked.',
      inputSchema: z.object({
        question: z.string(),
        options: z
          .array(z.object({ label: z.string(), value: z.string() }))
          .min(2)
          .max(10),
      }),
      execute: async (input) => {
        turn.posts.push({
          card: asCard(
            <Card title={input.question}>
              <Actions>
                <Select
                  id="ask"
                  label={input.question}
                  placeholder="Choose one"
                >
                  {input.options.map((option) => (
                    <SelectOption label={option.label} value={option.value} />
                  ))}
                </Select>
              </Actions>
            </Card>
          ),
          fallbackText: `${input.question} Options: ${input.options.map((option) => option.label).join(', ')}`,
        })
        return 'Menu shown. Stop here and wait for the choice.'
      },
    }),
  } satisfies ToolSet
}
