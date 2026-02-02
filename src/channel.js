import { FeishuProvider } from './provider.js';

// Helper to resolve account from config
const resolveAccount = (cfg, accountId) => {
    return cfg.channels?.feishu?.accounts?.[accountId || 'default'] || 
           ( (accountId === 'default' || !accountId) && cfg.plugins?.entries?.feishu?.config ? { config: cfg.plugins.entries.feishu.config } : null);
};

export const feishuPlugin = {
    id: "feishu",
    
    // Capabilities defined for this channel
    capabilities: {
        chatTypes: ["direct", "group"],
        media: true, // Enabled media support
    },

    messaging: {
        normalizeTarget: (target) => {
            // Feishu IDs typically start with oc_ (chat), ou_ (user), or on_ (union)
            if (/^(oc_|ou_|on_)/.test(target)) return target;
            return null;
        },
        targetResolver: {
            looksLikeId: (id) => /^(oc_|ou_|on_)/.test(id),
            hint: "<chat_id|open_id|union_id>",
        },
    },

    // Threading adapter: enables message tool to auto-infer target from current session
    threading: {
        resolveReplyToMode: ({ cfg }) => cfg.channels?.feishu?.replyToMode ?? "off",
        buildToolContext: ({ context, hasRepliedRef }) => ({
            currentChannelId: context.To?.trim() || undefined,
            currentChannelProvider: "feishu",
            currentThreadTs: context.ReplyToId || undefined,
            hasRepliedRef,
        }),
    },

    // Configuration methods
    config: {
        listAccountIds: (cfg) => {
            const explicit = Object.keys(cfg.channels?.feishu?.accounts || {});
            if (explicit.length > 0) return explicit;
            
            // Fallback: use plugin-level config as 'default' account
            if (cfg.plugins?.entries?.feishu?.config?.appId) {
                return ['default'];
            }
            return [];
        },
        resolveAccount: (cfg, accountId) => {
            const explicit = cfg.channels?.feishu?.accounts?.[accountId];
            if (explicit) return explicit;

            if (accountId === 'default' && cfg.plugins?.entries?.feishu?.config?.appId) {
                return {
                    id: 'default',
                    config: cfg.plugins.entries.feishu.config
                };
            }
            return null;
        },
    },

    // Inbound listener (Gateway logic)
    gateway: {
        startAccount: async (ctx) => {
            const provider = new FeishuProvider(ctx);
            await provider.start();
            
            return async () => {
                // Stop logic is handled via abortSignal in ctx
            };
        }
    },

    // Outbound dispatcher (Agent reply logic)
    outbound: {
        deliveryMode: "direct",

        sendText: async ({ to, text, cfg, accountId }) => {
            const account = resolveAccount(cfg, accountId);
            if (!account) throw new Error(`Feishu account "${accountId || 'default'}" not found in config`);
            
            const provider = new FeishuProvider({ account, log: console });
            const resp = await provider.sendAuto(to, text);
            
            return { 
                channel: "feishu", 
                messageId: resp?.data?.message_id || Date.now().toString() 
            };
        },

        // REQUIRED by Moltbot core: sendMedia handles all media types
        // ctx.mediaUrl contains the file path, ctx.text contains the caption
        sendMedia: async ({ to, text, mediaUrl, cfg, accountId }) => {
            const account = resolveAccount(cfg, accountId);
            if (!account) throw new Error(`Feishu account "${accountId || 'default'}" not found in config`);
            
            const provider = new FeishuProvider({ account, log: console });
            const lower = (mediaUrl || '').toLowerCase();
            
            let mediaMessageId;
            
            // Determine media type by extension
            if (/\.(jpg|jpeg|png|gif|webp|bmp)$/.test(lower)) {
                // Image
                const imageKey = await provider.uploadImage(mediaUrl);
                const resp = await provider.sendImage(to, imageKey);
                mediaMessageId = resp?.data?.message_id;
            } else {
                // Everything else (audio, video, documents) -> send as file
                const fileKey = await provider.uploadFile(mediaUrl, 'stream');
                const resp = await provider.sendFile(to, fileKey);
                mediaMessageId = resp?.data?.message_id;
            }
            
            // If there's a caption, send it as a separate text message
            if (text && text.trim()) {
                await provider.sendAuto(to, text);
            }
            
            return { 
                channel: "feishu", 
                messageId: mediaMessageId || Date.now().toString() 
            };
        },

        sendImage: async ({ to, filePath, cfg, accountId }) => {
            const account = resolveAccount(cfg, accountId);
            if (!account) throw new Error(`Feishu account "${accountId || 'default'}" not found`);
            
            const provider = new FeishuProvider({ account, log: console });
            
            // Upload first
            const imageKey = await provider.uploadImage(filePath);
            // Then send
            const resp = await provider.sendImage(to, imageKey);
            
            return { channel: "feishu", messageId: resp?.data?.message_id };
        },

        sendFile: async ({ to, filePath, cfg, accountId }) => {
            const account = resolveAccount(cfg, accountId);
            const provider = new FeishuProvider({ account, log: console });
            
            const fileKey = await provider.uploadFile(filePath, 'stream');
            const resp = await provider.sendFile(to, fileKey);
            
            return { channel: "feishu", messageId: resp?.data?.message_id };
        },

        sendVideo: async ({ to, filePath, cfg, accountId }) => {
            const account = resolveAccount(cfg, accountId);
            const provider = new FeishuProvider({ account, log: console });
            
            // Fallback: Send video as regular file to avoid ownership/cover issues
            // Upload as generic stream (not 'mp4') to match 'file' message type
            const fileKey = await provider.uploadFile(filePath, 'stream');
            // Send as file message
            const resp = await provider.sendFile(to, fileKey);
            
            return { channel: "feishu", messageId: resp?.data?.message_id };
        }
    }
};
