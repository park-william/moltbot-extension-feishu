import * as lark from '@larksuiteoapi/node-sdk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { getCoreRuntime } from './runtime.js';

// A simple 32x32 gray placeholder icon for video cover (Base64)
const DEFAULT_VIDEO_COVER_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAxwAAAMcBwhGQBgAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAADdSURBVFiF7ZYxCsMwEEW/x0sI3aO36CE6d+8RMnfv0aF79BAZPILp0iGDOyXjQ6AwsGzL//0QCOvO+ySOIwCAMebcc87lOedLz/N+5RzX1XW963ne/Z8A2F5tG4B1y7Zt3/fc930xDAMYYzEfx/G2KIpig3O+f88B2N7z/d9+v68VRREYY1Ff13U0TROUZRk451F/u92i7/uibduiaZqgbduCcx71nPOl7/uX/BwA2F5tG4B1y7Isy7Isy7Isy7Isy7Isy7Isy7Isy7Isy/8BPM+755zLfd//A3i/AH71Plf62eF6AAAAAElFTkSuQmCC";

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

    async downloadResource(messageId, fileKey, type) {
        try {
            const resp = await this.client.im.messageResource.get({
                path: { message_id: messageId, file_key: fileKey },
                params: { type },
            });

            if (!resp) throw new Error(`Empty response from Feishu for ${type}`);

            const tmpDir = os.tmpdir();
            const ext = type === 'image' ? 'image' : (type === 'audio' ? 'opus' : 'bin');
            const filename = `feishu-${messageId}-${fileKey}.${ext}`;
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
                this.logger?.warn(`Unknown response type for resource download: ${resp.constructor?.name}, keys: ${Object.keys(resp)}`);
                throw new Error(`Received invalid response type for ${type}`);
            }

            const mimeType = type === 'image' ? 'image/jpeg' : (type === 'audio' ? 'audio/opus' : 'application/octet-stream');
            return { path: filePath, type: mimeType }; 
        } catch (err) {
            this.logger?.error(`Failed to download ${type} ${fileKey}: ${err.message}`);
            return null;
        }
    }

    async downloadImage(messageId, imageKey) {
        return this.downloadResource(messageId, imageKey, 'image');
    }

    async downloadAudio(messageId, fileKey) {
        return this.downloadResource(messageId, fileKey, 'audio');
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
                        } else if (message.message_type === 'audio') {
                            try {
                                const content = JSON.parse(message.content);
                                const fileKey = content.file_key;
                                if (fileKey) {
                                    const downloaded = await this.downloadAudio(message.message_id, fileKey);
                                    if (downloaded) {
                                        mediaPath = downloaded.path;
                                        mediaType = downloaded.type;
                                        contentText = "<media:audio>";
                                    }
                                }
                            } catch (e) {
                                this.logger?.warn("Failed to process audio message: " + e.message);
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
                        // IMPORTANT: 'To' should be the chat_id, not appId, so that message tool can auto-infer target
                        // IMPORTANT: 'Provider' is required for buildThreadingToolContext to identify the channel
                        const ctxPayload = {
                            Body: contentText,
                            From: senderId,
                            To: chatId,  // Changed from this.appId to chatId for proper target inference
                            SessionKey: 'feishu:' + chatId,
                            AccountId: this.ctx.accountId || 'default',
                            MessageSid: message.message_id,
                            // These fields are critical for message tool to auto-infer target
                            Provider: 'feishu',
                            Surface: 'feishu',
                            OriginatingChannel: 'feishu',
                            OriginatingTo: chatId,
                            ChatType: message.chat_type === 'group' ? 'group' : 'direct',
                            // Media fields
                            MediaPath: mediaPath,
                            MediaType: mediaType,
                            MediaMimeType: mediaType,
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
                                        this.logger?.info(`[Feishu] Core dispatch deliver payload: ${JSON.stringify(payload)}`);
                                        
                                        // Handle Media (Video/Image/File)
                                        let mediaFile = payload.mediaUrl || (payload.mediaUrls && payload.mediaUrls[0]);
                                        let textToSend = payload.text || '';
                                        
                                        // NEW: Extract media paths from markdown syntax if no explicit mediaUrl
                                        // Matches: ![alt](path) or just bare file paths starting with /
                                        if (!mediaFile && textToSend) {
                                            // Pattern 1: Markdown image/file syntax ![...](path)
                                            const mdMatch = textToSend.match(/!\[[^\]]*\]\(([^)]+)\)/);
                                            if (mdMatch && mdMatch[1]) {
                                                const extractedPath = mdMatch[1];
                                                // Verify it looks like a file path (starts with / or ./)
                                                if (extractedPath.startsWith('/') || extractedPath.startsWith('./')) {
                                                    mediaFile = extractedPath;
                                                    // Remove the markdown syntax from text
                                                    textToSend = textToSend.replace(/!\[[^\]]*\]\([^)]+\)/g, '').trim();
                                                    this.logger?.info(`[Feishu] Extracted media from markdown: ${mediaFile}`);
                                                }
                                            }
                                            
                                            // Pattern 2: MEDIA: prefix (common Moltbot format)
                                            const mediaMatch = textToSend.match(/MEDIA:\s*(\S+)/i);
                                            if (!mediaFile && mediaMatch && mediaMatch[1]) {
                                                mediaFile = mediaMatch[1];
                                                textToSend = textToSend.replace(/MEDIA:\s*\S+/gi, '').trim();
                                                this.logger?.info(`[Feishu] Extracted media from MEDIA: tag: ${mediaFile}`);
                                            }
                                        }
                                        
                                        if (mediaFile) {
                                            try {
                                                const lower = mediaFile.toLowerCase();
                                                this.logger?.info(`[Feishu] Processing media file: ${mediaFile}`);

                                                if (/\.(jpg|jpeg|png|gif|webp|bmp)$/.test(lower)) {
                                                    // Images
                                                    const imageKey = await this.uploadImage(mediaFile);
                                                    await this.sendImage(chatId, imageKey);
                                                } else {
                                                    // Everything else (Videos, Files, PDFs) -> Send as File attachment
                                                    // IMPORTANT: To send as msg_type='file', we MUST upload as file_type='stream'.
                                                    // If we upload as 'mp4', Feishu expects msg_type='media' and requires a cover image.
                                                    // By forcing 'stream', we bypass the strict video validation and just send the raw file.
                                                    const fileType = 'stream';
                                                    const fileKey = await this.uploadFile(mediaFile, fileType);
                                                    await this.sendFile(chatId, fileKey);
                                                }
                                            } catch (e) {
                                                this.logger?.error(`[Feishu] Failed to send media: ${e.message}`);
                                            }
                                        }

                                        // Handle Text (only if present after extraction)
                                        if (textToSend && textToSend.trim()) {
                                            await this.sendText(chatId, textToSend);
                                        }
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

    async uploadImage(filePath) {
        try {
            const fileStream = fs.createReadStream(filePath);
            const resp = await this.client.im.image.create({
                data: {
                    image_type: 'message',
                    image: fileStream,
                }
            });
            return resp.image_key;
        } catch (err) {
            this.logger?.error(`Failed to upload image ${filePath}: ${err.message}`);
            throw err;
        }
    }

    async uploadFile(filePath, fileType = 'stream') {
        try {
            const fileName = path.basename(filePath);
            
            // Debug: Check file stats
            try {
                const stats = fs.statSync(filePath);
                this.logger?.info(`[Feishu] Uploading file: ${filePath} (Size: ${stats.size} bytes)`);
            } catch (e) {
                this.logger?.error(`[Feishu] File stat failed for ${filePath}: ${e.message}`);
                throw e;
            }

            const fileStream = fs.createReadStream(filePath);
            
            const startTime = Date.now();
            const resp = await this.client.im.file.create({
                data: {
                    file_type: fileType,
                    file_name: fileName,
                    duration: 3000,
                    file: fileStream,
                }
            });
            
            const duration = Date.now() - startTime;
            this.logger?.info(`[Feishu] Upload success! Key: ${resp.file_key}, Time: ${duration}ms`);
            
            return resp.file_key;
        } catch (err) {
            this.logger?.error(`[Feishu] Failed to upload file ${filePath}: ${err.message}`, err.response ? err.response.data : '');
            throw err;
        }
    }

    async sendImage(chatId, imageKey) {
        return await this.client.im.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
                receive_id: chatId,
                msg_type: 'image',
                content: JSON.stringify({ image_key: imageKey }),
            },
        });
    }

    async sendFile(chatId, fileKey) {
        return await this.client.im.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
                receive_id: chatId,
                msg_type: 'file',
                content: JSON.stringify({ file_key: fileKey }),
            },
        });
    }

    async sendVideo(chatId, fileKey, imageKey) {
        // If no cover image provided, try to upload the default one
        if (!imageKey) {
            try {
                const imgBuffer = Buffer.from(DEFAULT_VIDEO_COVER_BASE64, 'base64');
                const tempCoverPath = path.join(os.tmpdir(), `feishu-cover-${Date.now()}.png`);
                await fs.promises.writeFile(tempCoverPath, imgBuffer);
                
                imageKey = await this.uploadImage(tempCoverPath);
                
                fs.unlink(tempCoverPath, () => {}); 
            } catch (e) {
                this.logger?.warn("Failed to upload default video cover: " + e.message);
                // Fallback: If cover upload fails, send as regular file instead of media card
                // Feishu requires image_key for media messages.
                this.logger?.info("Falling back to sending video as file attachment.");
                return this.sendFile(chatId, fileKey);
            }
        }

        // Double check: if we still don't have an imageKey, send as file
        if (!imageKey) {
             return this.sendFile(chatId, fileKey);
        }

        return await this.client.im.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
                receive_id: chatId,
                msg_type: 'media',
                content: JSON.stringify({ 
                    file_key: fileKey,
                    image_key: imageKey
                }),
            },
        });
    }
}
