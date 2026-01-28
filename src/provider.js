import * as lark from '@larksuiteoapi/node-sdk';
import { getCoreRuntime } from '../index.js';

export class FeishuProvider {
    constructor(ctx) {
        this.ctx = ctx;
        this.account = ctx.account;
        this.runtime = ctx.runtime;
        this.logger = ctx.log;
        this.appId = ctx.account.config.appId;
        
        this.client = new lark.Client({
            appId: this.account.config.appId,
            appSecret: this.account.config.appSecret,
        });
        
        this.wsClient = null;
    }

    async start() {
        const core = getCoreRuntime();
        const mode = this.account.config.mode || 'websocket';
        this.logger?.info("Starting Feishu provider for " + this.appId + " in " + mode + " mode");
        
        if (mode === 'webhook') {
            this.logger?.info("Webhook mode enabled. Ensure public URL is configured in Feishu console.");
            return;
        }

        // WebSocket Mode
        this.wsClient = new lark.WSClient({
            appId: this.account.config.appId,
            appSecret: this.account.config.appSecret,
        });

        const dispatcher = new lark.EventDispatcher({}).register({
            'im.message.receive_v1': async (data) => {
                const { message, sender } = data;
                if (message.message_type !== 'text') return;

                const content = JSON.parse(message.content).text;
                const senderId = sender.sender_id.user_id || sender.sender_id.open_id;
                const chatId = message.chat_id;

                const ctxPayload = {
                    Body: content,
                    From: senderId,
                    To: this.appId,
                    SessionKey: 'feishu:' + chatId,
                    AccountId: this.ctx.accountId || 'default',
                    MessageSid: message.message_id,
                    OriginatingChannel: 'feishu',
                };

                try {
                    await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                        ctx: ctxPayload,
                        cfg: this.ctx.cfg,
                        dispatcherOptions: {
                            deliver: async (payload) => {
                                await this.sendText(chatId, payload.text);
                            }
                        }
                    });
                } catch (err) {
                    this.logger?.error("Feishu message dispatch failed: " + String(err));
                }
            }
        });

        await this.wsClient.start({ eventDispatcher: dispatcher });
        this.logger?.info("Feishu WebSocket connected successfully");

        // Handle shutdown
        this.ctx.abortSignal?.addEventListener('abort', () => {
            this.logger?.info("Shutting down Feishu WebSocket...");
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