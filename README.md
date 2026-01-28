# @moltbot/extension-feishu

这是 [Moltbot](https://github.com/moltbot/moltbot) 的原生飞书 (Feishu/Lark) 频道扩展插件。它允许你的 AI 助手直接接入飞书，通过单聊或群聊与用户进行交互。

## 特性

- **多模式支持**：支持 WebSocket（长连接）模式和 Webhook 模式。推荐使用 WebSocket 模式，无需公网 IP 或内网穿透即可快速接入。
- **高性能消息处理**：基于 Moltbot 的 `dispatchReplyWithBufferedBlockDispatcher` 管道，支持流式响应和复杂上下文处理。
- **多账号管理**：支持在 Moltbot 中配置多个飞书自建应用账号。
- **安全稳定**：基于官方 `@larksuiteoapi/node-sdk` 构建，并针对 Moltbot 进行了底层 Bug 适配与稳定性优化。

## 安装

在你的 Moltbot 工作区中，可以通过以下步骤安装：

1. **进入插件目录**
   通常是 `~/moltbot/extensions` 或 `~/clawdbot/extensions`（取决于你的配置）。

2. **克隆本项目**
   ```bash
   git clone https://github.com/park-william/moltbot-extension-feishu feishu
   ```

3. **安装依赖**
   ```bash
   cd feishu
   npm install
   ```

## 配置

在 `moltbot.json` 配置文件中添加飞书插件的配置信息：

```json
{
  "channels": {
    "feishu": {
      "dmPolicy": "allowlist"
    }
  },
  "plugins": {
    "entries": {
      "feishu": {
        "enabled": true,
        "config": {
          "appId": "cli_xxxxxxxxxxxx",
          "appSecret": "xxxxxxxxxxxxxxxxxxxxxxxx",
          "mode": "websocket"
        }
      }
    }
  }
}
```

### 配置项说明

#### `plugins.entries.feishu.config`

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `appId` | string | 是 | 飞书开放平台应用的 App ID |
| `appSecret` | string | 是 | 飞书开放平台应用的 App Secret |
| `mode` | string | 否 | 连接模式：目前仅支持 `websocket`（默认）。Webhook 模式暂未实现。 |

#### `channels.feishu`

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `dmPolicy` | string | 否 | 私聊策略：`allowlist`、`open` 或 `disabled` |

## 飞书开放平台设置

1. **创建应用**：前往 [飞书开放平台](https://open.feishu.cn/) 创建一个"企业自建应用"。
2. **启用机器人**：在"应用功能"中开启"机器人"功能。
3. **权限配置**：
   - 需开启 `im:message:p2p:readonly` (接收单聊消息)
   - 需开启 `im:message:group_at:readonly` (接收群聊中 @ 机器人的消息)
   - 需开启 `im:message:send_as_bot` (以机器人身份发送消息)
4. **事件订阅**：
   - 订阅事件：`im.message.receive_v1` (接收消息 v1.0)
   - 在"事件订阅"页面选择"使用长连接接入"（WebSocket 模式），无需配置请求地址。
   - ⚠️ **注意**：Webhook 模式暂未实现，请使用 WebSocket 模式。

## 开发者

- **作者**: park-william

## 许可证

MIT
