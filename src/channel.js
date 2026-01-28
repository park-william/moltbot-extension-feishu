import { FeishuProvider } from './provider.js';

export const feishuPlugin = {
    id: "feishu",
    
    // Capabilities defined for this channel
    capabilities: {
        chatTypes: ["direct", "group"],
        media: false, // Text only for MVP
    },

    // Configuration methods
    config: {
        listAccountIds: (cfg) => Object.keys(cfg.channels?.feishu?.accounts || {}),
        resolveAccount: (cfg, accountId) => cfg.channels?.feishu?.accounts?.[accountId],
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