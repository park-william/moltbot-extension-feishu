import * as lark from '@larksuiteoapi/node-sdk';

export class FeishuProvider {
    constructor(account, runtime, logger) {
        this.config = account.config;
        this.runtime = runtime;
        this.logger = logger;
        this.appId = account.config.appId;
        
        this.client = new lark.Client({
            appId: this.config.appId,
            appSecret: this.config.appSecret,
        });
        
        this.wsClient = null;
    }

    async start(abortSignal) {
        this.logger?.info(`Starting Feishu provider for ${this.appId} in ${this.config.mode} mode`);
        
        if (this.config.mode === 'webhook') {
            this.logger?.info("Webhook mode enabled. Ensure public URL is configured in Feishu console.");
            return;
        }

        // WebSocket Mode
        this.wsClient = new lark.WSClient({
            appId: this.config.appId,
            appSecret: this.config.appSecret,
        });

        const dispatcher = new lark.EventDispatcher({}).register({
            'im.message.receive_v1': async (data) => {
                const { message, sender } = data;
                if (message.message_type !== 'text') return;

                const content = JSON.parse(message.content).text;
                const senderId = sender.sender_id.user_id || sender.sender_id.open_id;
                const chatId = message.chat_id;

                await this.runtime.ingest({
                    channel: 'feishu',
                    id: message.message_id,
                    from: { id: senderId },
                    to: { id: this.appId },
                    conversation: { id: chatId, type: message.chat_type },
                    content: { text: content },
                    raw: data
                });
            }
        });

        await this.wsClient.start({ eventDispatcher: dispatcher });
        this.logger?.info("Feishu WebSocket connected successfully");

        // Handle shutdown
        abortSignal?.addEventListener('abort', () => {
            this.logger?.info("Shutting down Feishu WebSocket...");
            // SDK currently doesn't have a clean stop for WSClient, but we can drop the ref
            this.wsClient = null;
        });
    }

    async sendText(chatId, text) {
        return await this.client.im.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
                receive_id: chatId,
                msg_type: 'text',
                content: JSON.stringify({ text }),
            },
        });
    }
}
