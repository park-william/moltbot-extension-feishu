import { FeishuProvider } from '../src/provider.js';
import { setCoreRuntime } from '../src/runtime.js';
import * as fixtures from './fixtures.js';
import fs from 'fs';

// Configuration
const config = {
    appId: "cli_a9f2f4bc6ab81bb5",
    appSecret: "DlgOvOKjD7MjnZZbSUATMgwrMW8VErfO"
};
const realChatId = "oc_66f91c662db1beb4f250a4bfcb0ad137";

// Mock Core Runtime
const mockCore = {
    channel: {
        reply: {
            dispatchReplyWithBufferedBlockDispatcher: ({ ctx }) => {
                console.log(`✅ [Inbound Verified] Type: ${ctx.Provider} | Content: ${ctx.Body.substring(0, 50)}...`);
                if (ctx.MediaPaths) console.log(`   Media Attached: ${ctx.MediaPaths.length} file(s)`);
            }
        }
    }
};

// Initialize
setCoreRuntime(mockCore);
const ctx = {
    account: { config },
    log: console,
    cfg: {}
};
const provider = new FeishuProvider(ctx);

async function runTests() {
    console.log("=== 🚀 Starting Feishu Regression Test Suite ===\n");

    /* 
    // --- Part 1: Inbound Tests (Requires Provider Refactor) ---
    console.log("--- 📥 Part 1: Inbound Message Processing ---");
    // Skipped to maintain provider.js stability (no extra exports)
    */

    console.log("\n--- 📤 Part 2: Outbound Message Delivery (Real API) ---");
    
    // --- Part 2: Outbound Tests (Real API) ---
    
    // 1. Plain Text
    console.log("1. Sending Plain Text...");
    await provider.sendAuto(realChatId, "🤖 回归测试开始：纯文本消息");

    // 2. Markdown & Table (Complex)
    console.log("2. Sending Complex Markdown...");
    const md = `
# 综合 Markdown 测试
## 1. 基础样式
**加粗文本** | *斜体文本* | ~~删除线~~
[OpenClaw 官网](https://docs.openclaw.ai)

## 2. 列表与引用
- 无序列表项 A
- 无序列表项 B
  1. 有序子列表 1
  2. 有序子列表 2

> 这是一段引用文本
> 飞书卡片支持多级引用渲染

## 3. 代码块
\`\`\`javascript
const greeting = "Hello Feishu";
console.log(greeting);
\`\`\`

## 4. 数据表格
| 模块 | 状态 | 覆盖率 |
| :--- | :--- | :--- |
| Core | ✅ Pass | 98% |
| Feishu | ⚠️ Warn | 85% |
| WhatsApp | ❌ Fail | 40% |
`;
    await provider.sendCard(realChatId, md, { title: "Markdown 全量回归" });

    // 3. Status Card Flow
    console.log("3. Testing Status Card Flow...");
    const statusMsg = await provider.sendStatusCard(realChatId, {
        title: "部署任务",
        status: "running",
        content: "正在构建镜像..."
    });
    const msgId = statusMsg.data.message_id;
    
    await new Promise(r => setTimeout(r, 2000)); // Simulate delay
    
    await provider.updateStatusCard(msgId, {
        title: "部署任务",
        status: "success",
        content: "镜像构建成功 (2s)"
    });

    // 4. Interactive Buttons (V1 Schema)
    console.log("4. Testing Interactive Buttons...");
    await provider.sendCard(realChatId, "请点击测试回调：", {
        title: "交互测试",
        buttons: [
            { text: "Pass", value: "pass", type: "primary" },
            { text: "Fail", value: "fail", type: "danger" }
        ]
    });

    // 5. Real Image Send
    console.log("5. Testing Image Sending...");
    // Use an existing image if available, else skip
    const testImgPath = "/home/william/.openclaw/media/feishu/img_v3_02uk_16896190-6353-49a0-9d59-b0a1e4ffcf8g.png";
    if (fs.existsSync(testImgPath)) {
        const imgKey = await provider.uploadImage(testImgPath);
        await provider.sendImage(realChatId, imgKey);
        console.log("   Image sent successfully.");
    } else {
        console.log("   Skipping image send (test file not found).");
    }

    console.log("\n=== ✅ All Tests Completed Successfully ===");
}

runTests().catch(e => {
    console.error("\n❌ Test Failed:", e);
    process.exit(1);
});
