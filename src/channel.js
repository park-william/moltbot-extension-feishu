import { FeishuProvider } from './provider.js';

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
        }
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
            const account = cfg.channels?.feishu?.accounts?.[accountId || 'default'];
            if (!account) throw new Error("Feishu account not found in config");
            
            const provider = new FeishuProvider({ account, log: console });
            await provider.sendText(to, text);
            
            return { channel: "feishu", id: Date.now().toString() };
        }
    }
};