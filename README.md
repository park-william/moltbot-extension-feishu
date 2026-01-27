# @clawdbot/extension-feishu

这是 Moltbot (Clawdbot) 的原生飞书 (Feishu/Lark) 频道扩展插件。它允许你的 AI 助手直接接入飞书，通过单聊或群聊与用户进行交互。

## 特性

- **多模式支持**：支持 WebSocket（长连接）模式和 Webhook 模式。推荐使用 WebSocket 模式，无需公网 IP 或内网穿透即可快速接入。
- **消息处理**：目前支持文本消息的接收与发送。
- **多账号管理**：支持在 Moltbot 中配置多个飞书自建应用账号。
- **易于集成**：基于官方 `@larksuiteoapi/node-sdk` 构建，性能稳定，安全可靠。

## 安装

在你的 Moltbot 工作区中，可以通过 `moltbot` 命令行工具安装（假设你已经配置好了插件目录）：

```bash
# 进入你的插件目录
cd ~/.clawdbot/extensions
# 克隆或解压本项目
git clone https://github.com/park-william/clawdbot-extension-feishu feishu
# 安装依赖
cd feishu
npm install
```

## 配置

在 `moltbot.json` 配置文件中添加飞书频道的配置信息：

```json
{
  "channels": {
    "feishu": {
      "accounts": {
        "my-feishu-bot": {
          "config": {
            "appId": "cli_xxxxxxxxxxxx",
            "appSecret": "xxxxxxxxxxxxxxxxxxxxxxxx",
            "mode": "websocket" 
          }
        }
      }
    }
  },
  "plugins": {
    "entries": {
      "feishu": {
        "enabled": true
      }
    }
  }
}
```

### 配置项说明

| 参数 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `appId` | string | 是 | 飞书开放平台应用的 App ID |
| `appSecret` | string | 是 | 飞书开放平台应用的 App Secret |
| `mode` | string | 否 | 连接模式：`websocket` (默认) 或 `webhook` |
| `encryptKey` | string | 否 | Webhook 模式下的加密策略 Key |
| `verificationToken` | string | 否 | Webhook 模式下的事件验证 Token |

## 飞书开放平台设置

1. **创建应用**：前往 [飞书开放平台](https://open.feishu.cn/) 创建一个“企业自建应用”。
2. **启用机器人**：在“应用功能”中开启“机器人”功能。
3. **权限配置**：
   - 需开启 `im:message:p2p:readonly` (接收单聊消息)
   - 需开启 `im:message:group_at:readonly` (接收群聊中 @ 机器人的消息)
   - 需开启 `im:message:send_as_bot` (以机器人身份发送消息)
4. **事件订阅**：
   - 订阅事件：`im.message.receive_v1` (接收消息 v1.0)
   - 如果使用 **WebSocket 模式**，无需配置请求地址。
   - 如果使用 **Webhook 模式**，请在“事件订阅”中配置你的公网请求地址。

## 开发者

- **作者**: park-william

## 许可证

MIT
