import { FeishuProvider } from '../src/provider.js';
import { setCoreRuntime } from '../src/runtime.js';

// Configuration
const config = {
    appId: "cli_a9f2f4bc6ab81bb5",
    appSecret: "DlgOvOKjD7MjnZZbSUATMgwrMW8VErfO"
};
const realChatId = "oc_66f91c662db1beb4f250a4bfcb0ad137";

// Mock Core Runtime
const mockCore = {};
setCoreRuntime(mockCore);

const ctx = {
    account: { config },
    log: console
};

async function test() {
    const provider = new FeishuProvider(ctx);
    
    console.log("1. Sending Schema 2.0 Markdown Headers...");
    const md = `
# 一级标题 (Card Title)
## 二级标题 (H2)
### 三级标题 (H3 -> H2)
正文文本
`;
    await provider.sendCard(realChatId, md, { title: "标题样式测试 (Schema 2.0)" });

    console.log("2. Sending Interactive Buttons (Schema 2.0 Check)...");
    try {
        await provider.sendCard(realChatId, "Schema 2.0 按钮兼容性测试", {
            title: "按钮测试",
            buttons: [
                { text: "测试按钮", value: "test", type: "primary" }
            ]
        });
        console.log("   Buttons sent successfully!");
    } catch (e) {
        console.error("   ❌ Button Send Failed:", e.response?.data || e.message);
    }
}

test().catch(console.error);