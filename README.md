# @moltbot/extension-feishu

这是 [Moltbot](https://github.com/moltbot/moltbot) 的原生飞书 (Feishu/Lark) 频道扩展插件。它允许你的 AI 助手直接接入飞书，通过单聊或群聊与用户进行交互。

## 特性

- **多模式支持**：架构上支持 WebSocket（长连接）模式和 Webhook 模式。
    - **WebSocket 模式 (推荐)**：无需公网 IP 或内网穿透即可快速接入，适合大多数场景。
    - **Webhook 模式 (待实现)**：目前已预留接口，计划在后续版本中实现。
- **高性能消息处理**：基于 Moltbot 的 `dispatchReplyWithBufferedBlockDispatcher` 管道，支持流式响应和复杂上下文处理。
- **多账号管理 (待完善)**：架构上支持在 Moltbot 中配置多个飞书自建应用账号。目前已实现基础配置逻辑，多账号并发运行的稳定性仍在测试中，建议现阶段优先使用单账号配置。
- **富媒体与富文本解析**：
    - **图片支持**：支持接收并自动下载飞书消息中的图片。
    - **Mentions 解析**：自动将消息中的 `@用户` 占位符转换为可读的用户名（`@Name`）。
    - **富文本 (Post) 解析**：支持解析飞书富文本消息（Post），提取文本内容、链接及 `@` 信息。
- **安全稳定**：基于官方 `@larksuiteoapi/node-sdk` 构建，并针对 SDK 内部日志及并发分发逻辑进行了稳定性优化，防止因超时导致的重复分发。

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
| `mode` | `plugins...config` | 否 | 连接模式：目前仅支持 `websocket`（默认）。Webhook 模式正在开发中。 |
| `dmPolicy` | `channels.feishu` | 否 | 私聊策略：`allowlist` (白名单)、`open` (开放)、`disabled` (禁用) |

## 飞书开放平台设置

1. **创建应用**：前往 [飞书开放平台](https://open.feishu.cn/) 创建一个"企业自建应用"。
2. **启用机器人**：在"应用功能"中开启"机器人"功能。
3. **权限配置**：
   - 需开启 `im:message:p2p:readonly` (接收单聊消息)
   - 需开启 `im:message:group_at:readonly` (接收群聊中 @ 机器人的消息)
   - 需开启 `im:message:send_as_bot` (以机器人身份发送消息)
   - 需开启 `im:resource:readonly` (用于下载图片等媒体资源)
   - 发布版本以便权限生效。
4. **事件订阅**：
   - 订阅事件：`im.message.receive_v1` (接收消息 v1.0)
   - 在"事件订阅"页面选择"使用长连接接入"（WebSocket 模式），无需配置请求地址。
   - ⚠️ **注意**：Webhook 模式目前尚未正式发布，请务必选择 **WebSocket 模式**。

## 常见问题

### 1. 为什么飞书后台显示机器人 “App not online”？
- 请检查是否在插件目录下执行了 `npm install`。Moltbot 加载插件时如果由于缺少依赖报错（如 `Cannot find package '@larksuiteoapi/node-sdk'`），则无法启动 WebSocket 连接。
- 请检查 `moltbot` 的日志，确认飞书插件是否已成功初始化。

### 2. 为什么机器人不回复消息？
- 确认飞书开放平台中，机器人的“权限配置”已包含 `im:message:p2p:readonly` (私聊) 或 `im:message:group_at:readonly` (群聊)。
- 确认应用已发布版本并被企业管理员审核通过（或处于测试状态且你在测试列表内）。
- 检查 `moltbot.json` 中的 `dmPolicy` 配置，确认你的 ID 是否在允许范围内。

### 3. 如何获取我的 User ID / Open ID？
- 建议将 `dmPolicy` 暂时设为 `"open"`，向机器人发送一条消息，查看 Moltbot 的调试日志，其中会打印接收到的消息结构，包含 `user_id` (Open ID)。获取后填入 `allowFrom` 并改回 `allowlist`。

### 4. 为什么图片无法解析？
- 需确保应用开启了 `im:resource:readonly` 权限。
- 检查网络是否允许访问飞书资源服务器。

## 开发者

- **作者**: park-william

## 许可证

MIT
