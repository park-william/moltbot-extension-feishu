import { feishuPlugin } from './src/channel.js';
import { setCoreRuntime } from './src/runtime.js';

/**
 * Extension entry point for Clawdbot
 */
const extension = {
  id: "feishu",
  name: "Feishu (Lark)",
  description: "Native Feishu channel integration",
  
  register(api) {
    // Force reload timestamp: 2026-02-05-v9 (Fix Button Schema)
    // Store runtime in our dedicated module to avoid circular dependency
    setCoreRuntime(api.runtime);
    
    // Inject into Clawdbot's channel registry
    api.registerChannel({ 
        plugin: {
            ...feishuPlugin,
            meta: {
                label: "Feishu",
            }
        } 
    });
  },
};

export default extension;
