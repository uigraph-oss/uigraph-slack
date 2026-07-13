import { App } from '@slack/bolt'
import { env } from './env'

const app = new App({
  token: env.SLACK_BOT_TOKEN,
  appToken: env.SLACK_APP_TOKEN,
  socketMode: true,
})

app.event('app_mention', async ({ say }) => {
  await say("I'm alive!")
})

app.message('hello', async ({ message, say }) => {
  await say({
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Hey there <@${message.user}>!`,
        },
        accessory: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Click Me',
          },
          action_id: 'button_click',
        },
      },
    ],
    text: `Hey there <@${message.user}>!`,
  })
})

app.action('button_click', async ({ body, ack, say }) => {
  await ack()
  await say(`<@${body.user.id}> clicked the button`)
})

void (async () => {
  await app.start(process.env.PORT || 3000)
  app.logger.info('⚡️ Bolt app is running!')
})()
