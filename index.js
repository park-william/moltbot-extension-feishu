import { feishuPlugin } from './src/channel.js';

/**
 * Extension entry point for Clawdbot
 */
const extension = {
  id: "feishu",
  name: "Feishu (Lark)",
  description: "Native Feishu channel integration",
  
  register(api) {
    // Inject into Clawdbot's channel registry
    api.registerChannel({ plugin: feishuPlugin });
  },
};

export default extension;
