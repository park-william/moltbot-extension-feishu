# @moltbot/extension-feishu

这是 [Moltbot](https://github.com/moltbot/moltbot) 的原生飞书 (Feishu/Lark) 频道扩展插件。它允许你的 AI 助手直接接入飞书，通过单聊或群聊与用户进行交互。

## 特性

- **WebSocket 长连接**：推荐模式。无需公网 IP、无需内网穿透，开箱即用，特别适合本地部署。
- **富文本消息支持**：支持解析飞书的富文本 (Post) 消息格式（包含标题、多段落文本），不仅限于纯文本。
- **高性能与稳定**：
  - 基于官方 `@larksuiteoapi/node-sdk` 构建。
  - **增强的日志系统**：修复了 SDK 日志格式不兼容导致的崩溃问题。
  - **容错处理**：针对网络波动和畸形消息进行了健壮性优化。
- **配置灵活**：支持通过全局插件配置快速启动单账号，也支持在 Channel 中配置多账号。

## 安装

⚠️ **重要提示**：本插件依赖 `node_modules`，克隆代码后**必须**手动安装依赖，否则 Moltbot 无法加载插件（会出现 "App not online" 错误）。

1. **进入插件扩展目录**
   通常是 `~/moltbot/extensions`。

2. **克隆本项目**
   ```bash
   git clone https://github.com/park-william/moltbot-extension-feishu feishu
   ```

3. **安装依赖 (必须执行)**
   ```bash
   cd feishu
   npm install --production
   ```

## 配置

在 `moltbot.json` 配置文件中添加飞书插件的配置信息。

### 推荐配置（单账号）

这是最简单的配置方式，直接在 `plugins` 节点下配置凭证。

```json
{
  "channels": {
    "feishu": {
      "dmPolicy": "allowlist",  // 建议开启白名单，或者设为 "open" 允许所有人
      "allowFrom": ["ou_xxxxxxxx"] // 允许互动的用户 Open ID
    }
  },
  "plugins": {
    "entries": {
      "feishu": {
        "enabled": true,
        "config": {
          "appId": "cli_xxxxxxxxxxxx",     // 必填：飞书应用的 App ID
          "appSecret": "xxxxxxxxxxxxxxxx", // 必填：飞书应用的 App Secret
          "mode": "websocket"              // 必填：连接模式
        }
      }
    }
  }
}
```

> **注意**：由于插件元数据校验，`plugins.entries.feishu.config` 中的 `appId` 和 `appSecret` 是**必填项**。即使你使用多账号配置，这里也建议保留一组默认凭证。

### 配置项说明

| 参数 | 路径 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `appId` | `plugins...config` | 是 | 飞书开放平台应用的 App ID |
| `appSecret` | `plugins...config` | 是 | 飞书开放平台应用的 App Secret |
| `dmPolicy` | `channels.feishu` | 否 | 私聊策略：`allowlist` (白名单)、`open` (开放)、`disabled` (禁用) |

## 飞书开放平台设置

1. **创建应用**：前往 [飞书开放平台](https://open.feishu.cn/) 创建一个"企业自建应用"。
2. **启用机器人**：在"应用功能"中开启"机器人"功能。
3. **权限配置**：
   - 需开启 `im:message:p2p:readonly` (接收单聊消息)
   - 需开启 `im:message:group_at:readonly` (接收群聊中 @ 机器人的消息)
   - 需开启 `im:message:send_as_bot` (以机器人身份发送消息)
   - 发布版本以便权限生效。
4. **事件订阅**：
   - 订阅事件：`im.message.receive_v1` (接收消息 v1.0)
   - 在"事件订阅"页面选择"使用长连接接入"（WebSocket 模式）。

## 常见问题

**Q: 为什么飞书后台显示机器人“App not online”？**
A: 请检查是否执行了 `npm install`。Moltbot 日志如果报错 `Cannot find package ...`，说明依赖未安装。

**Q: 如何获取 User ID / Open ID？**
A: 将 `dmPolicy` 暂时设为 `"open"`，向机器人发送一条消息，查看 Moltbot 日志（或让机器人回复你的 ID），获取后填入 `allowFrom` 并改回 `allowlist`。

## 许可证

MIT
