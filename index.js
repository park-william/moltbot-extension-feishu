import { feishuPlugin } from './src/channel.js';

let coreRuntime;

/**
 * Extension entry point for Clawdbot
 */
const extension = {
  id: "feishu",
  name: "Feishu (Lark)",
  description: "Native Feishu channel integration",
  
  register(api) {
    coreRuntime = api.runtime;
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

export function getCoreRuntime() { return coreRuntime; }
export default extension;