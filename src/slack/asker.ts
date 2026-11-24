// A turn's raw tool output is kept in the reply's metadata so the next turn can use it. Each
// output was fetched with its asker's access, so it is only handed back to that same person:
// otherwise a second user in the thread would be answered from the first user's view of the data.
// Replies from before this was recorded carry no asker and are kept as they were.
export function outputsForAsker(
  payload: { toolOutputs?: unknown; askerId?: unknown },
  askerId: string | undefined
): string[] | undefined {
  if (!Array.isArray(payload.toolOutputs)) return undefined
  if (
    askerId !== undefined &&
    typeof payload.askerId === 'string' &&
    payload.askerId !== askerId
  ) {
    return undefined
  }
  return payload.toolOutputs as string[]
}
