import * as lark from '@larksuiteoapi/node-sdk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { getCoreRuntime } from '../index.js';

export class FeishuProvider {
    constructor(ctx) {
        this.ctx = ctx;
        this.account = ctx.account;
        this.runtime = ctx.runtime;
        this.logger = ctx.log;
        
        // Extract credentials safely
        this.appId = this.account?.config?.appId;
        this.appSecret = this.account?.config?.appSecret;
        
        if (!this.appId || !this.appSecret) {
            throw new Error("Feishu provider missing appId or appSecret in account config");
        }
        
        // Create a safe logger shim for Lark SDK
        // Lark SDK may pass objects or multiple args that might confuse strict loggers
        this.safeLogger = {
            debug: (...args) => this.logger?.debug?.(args.map(String).join(' ')) || console.debug(...args),
            info: (...args) => this.logger?.info?.(args.map(String).join(' ')) || console.info(...args),
            warn: (...args) => this.logger?.warn?.(args.map(String).join(' ')) || console.warn(...args),
            error: (...args) => this.logger?.error?.(args.map(String).join(' ')) || console.error(...args),
        };

        this.client = new lark.Client({
            appId: this.appId,
            appSecret: this.appSecret,
            logger: this.safeLogger,
        });
        
        this.wsClient = null;
    }

    async downloadImage(messageId, imageKey) {
        try {
            const resp = await this.client.im.messageResource.get({
                path: { message_id: messageId, file_key: imageKey },
                params: { type: 'image' },
            });

            if (!resp) throw new Error("Empty response from Feishu");

            const tmpDir = os.tmpdir();
            const filename = `feishu-${messageId}-${imageKey}.image`;
            const filePath = path.join(tmpDir, filename);

            // Lark SDK v1.x response wrapper handling
            if (typeof resp.writeFile === 'function') {
                await resp.writeFile(filePath);
            } else if (typeof resp.getReadableStream === 'function') {
                 // Explicit stream getter
                 const stream = resp.getReadableStream();
                 if (stream) {
                    await pipeline(stream, fs.createWriteStream(filePath));
                 } else {
                     throw new Error("Feishu response stream was null");
                 }
            } else if (Buffer.isBuffer(resp)) {
                await fs.promises.writeFile(filePath, resp);
            } else if (typeof resp.pipe === 'function') {
                await pipeline(resp, fs.createWriteStream(filePath));
            } else if (resp.data && (Buffer.isBuffer(resp.data) || typeof resp.data.pipe === 'function')) {
                 if (Buffer.isBuffer(resp.data)) {
                     await fs.promises.writeFile(filePath, resp.data);
                 } else {
                     await pipeline(resp.data, fs.createWriteStream(filePath));
                 }
            } else {
                this.logger?.warn(`Unknown response type for image download: ${resp.constructor?.name}, keys: ${Object.keys(resp)}`);
                throw new Error("Received invalid response type for image");
            }

            return { path: filePath, type: 'image/jpeg' }; 
        } catch (err) {
            this.logger?.error(`Failed to download image ${imageKey}: ${err.message}`);
            return null;
        }
    }

    async start() {
        const core = getCoreRuntime();
        const mode = this.account.config.mode || 'websocket';
        this.logger?.info(`Starting Feishu provider for ${this.appId} in ${mode} mode`);
        
        if (mode === 'webhook') {
            this.logger?.info("Webhook mode enabled. Ensure public URL is configured in Feishu console.");
            return;
        }

        // WebSocket Mode
        try {
            // Re-instantiate WSClient here to ensure clean state on restart
            this.wsClient = new lark.WSClient({
                appId: this.appId,
                appSecret: this.appSecret,
                logger: this.safeLogger,
            });

            const dispatcher = new lark.EventDispatcher({}).register({
                'im.message.receive_v1': async (data) => {
                    try {
                        const { message, sender } = data;
                        
                        // Debug log for raw message structure
                        this.logger?.info(`[Feishu] Received ${message.message_type}: ${JSON.stringify(message).slice(0, 500)}`);

                        let contentText = "";
                        let mediaPath = undefined;
                        let mediaType = undefined;

                        if (message.message_type === 'text') {
                            contentText = JSON.parse(message.content).text;
                            // Replace @mentions placeholders with names if available
                            if (message.mentions && message.mentions.length > 0) {
                                try {
                                    message.mentions.forEach(mention => {
                                        if (mention.key && mention.name) {
                                            // Use global replace with escaped key just in case, though replaceAll covers string literal
                                            // Ensure key is treated as literal string
                                            contentText = contentText.split(mention.key).join(`@${mention.name}`);
                                        }
                                    });
                                } catch (mentionErr) {
                                    this.logger?.warn(`Failed to replace mentions: ${mentionErr.message}`);
                                }
                            }
                        } else if (message.message_type === 'post') {
                            // Handle rich text (post) messages
                            // Extract plain text from the complex post structure
                            try {
                                const content = JSON.parse(message.content);
                                // content.content is typically [[{tag: "text", text: "..."}]]
                                // We flatten it to a single string
                                if (content && content.content) {
                                    contentText = content.content.map(paragraph => 
                                        paragraph.map(elem => {
                                            if (elem.tag === 'text') return elem.text;
                                            if (elem.tag === 'at') return `@${elem.user_name || 'User'}`;
                                            if (elem.tag === 'a') return elem.text; // link
                                            return elem.text || "";
                                        }).join("")
                                    ).join("\n");
                                }
                                // If title exists, prepend it
                                if (content.title) {
                                    contentText = `# ${content.title}\n${contentText}`;
                                }
                            } catch (e) {
                                this.logger?.warn("Failed to parse post content: " + e.message);
                            }
                        } else if (message.message_type === 'image') {
                            try {
                                const content = JSON.parse(message.content);
                                const imageKey = content.image_key;
                                if (imageKey) {
                                    const downloaded = await this.downloadImage(message.message_id, imageKey);
                                    if (downloaded) {
                                        mediaPath = downloaded.path;
                                        mediaType = downloaded.type;
                                        contentText = "<media:image>";
                                    }
                                }
                            } catch (e) {
                                this.logger?.warn("Failed to process image message: " + e.message);
                            }
                        }

                        if (!contentText && !mediaPath) {
                            // Silently ignore other types or empty parses
                            this.logger?.debug?.(`Ignored message type: ${message.message_type}`);
                            return;
                        }

                        const senderId = sender.sender_id?.user_id || sender.sender_id?.open_id;
                        const chatId = message.chat_id;

                        if (!senderId) {
                            this.logger?.warn("Received Feishu message without valid sender_id");
                            return;
                        }

                        // Use simple reply context if core runtime is not fully available or differs
                        // Standard Moltbot Channel Payload
                        const ctxPayload = {
                            Body: contentText,
                            From: senderId,
                            To: this.appId,
                            SessionKey: 'feishu:' + chatId,
                            AccountId: this.ctx.accountId || 'default',
                            MessageSid: message.message_id,
                            OriginatingChannel: 'feishu',
                            MediaPath: mediaPath,
                            MediaType: mediaType,
                        };
                        
                        // Dispatch via standard reply interface
                        if (core && core.channel && core.channel.reply) {
                            // Do not await the full processing chain. 
                            // Return ACK to Feishu immediately to prevent timeout.
                            core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                                ctx: ctxPayload,
                                cfg: this.ctx.cfg,
                                dispatcherOptions: {
                                    deliver: async (payload) => {
                                        await this.sendText(chatId, payload.text);
                                    }
                                }
                            }).catch(err => {
                                this.logger?.error("Feishu async dispatch failed: " + String(err));
                            });
                            
                            // Return success to SDK immediately
                            return {};
                        } else {
                            this.logger?.error("Feishu: Core runtime channel reply system not found");
                        }
                    } catch (err) {
                        this.logger?.error("Feishu message dispatch failed: " + String(err));
                    }
                }
            });

            await this.wsClient.start({ eventDispatcher: dispatcher });
            this.logger?.info("Feishu WebSocket connected successfully");

        } catch (err) {
            this.logger?.error("Failed to start Feishu WebSocket: " + String(err));
            throw err;
        }

        // Handle shutdown
        this.ctx.abortSignal?.addEventListener('abort', () => {
            this.logger?.info("Shutting down Feishu WebSocket...");
            this.wsClient = null;
        });
    }

    async sendText(chatId, text) {
        try {
            this.logger?.info(`[Feishu] Sending text to ${chatId}: ${text.slice(0, 100)}...`);
            const resp = await this.client.im.message.create({
                params: { receive_id_type: 'chat_id' },
                data: {
                    receive_id: chatId,
                    msg_type: 'text',
                    content: JSON.stringify({ text }),
                },
            });
            this.logger?.info(`[Feishu] Send response: ${JSON.stringify(resp)}`);
            return resp;
        } catch (err) {
            this.logger?.error(`Failed to send text to ${chatId}: ${err.message}`, err);
            throw err;
        }
    }
}
