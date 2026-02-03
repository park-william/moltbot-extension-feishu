import * as lark from '@larksuiteoapi/node-sdk';
import fs from 'node:fs';
import path from 'node:path';
import { getCoreRuntime } from './runtime.js';

export class FeishuProvider {
    constructor(ctx) {
        this.ctx = ctx;
        this.account = ctx.account;
        this.runtime = ctx.runtime;
        this.logger = ctx.log;
        
        this.appId = this.account?.config?.appId;
        this.appSecret = this.account?.config?.appSecret;
        
        if (!this.appId || !this.appSecret) {
            throw new Error("Feishu provider missing appId or appSecret");
        }
        
        this.safeLogger = {
            debug: (...args) => this.logger?.debug?.(args.map(String).join(' ')) || console.debug(...args),
            info: (...args) => this.logger?.info?.(args.map(String).join(' ')) || console.info(...args),
            warn: (...args) => this.logger?.warn?.(args.map(String).join(' ')) || console.warn(...args),
            error: (...args) => this.logger?.error?.(args.map(String).join(' ')) || console.error(...args),
        };

        this.client = new lark.Client({
            appId: this.appId,
            appSecret: this.appSecret,
            logger: this.safeLogger,
        });
        
        this.wsClient = null;
    }

    /**
     * 解析 Markdown 表格并返回飞书表格组件
     * @param {string[]} tableLines - 表格行数组
     * @returns {object|null} 飞书 table 元素
     */
    parseMarkdownTableToElement(tableLines) {
        if (tableLines.length < 2) return null;
        
        // 解析表头
        const headerLine = tableLines[0];
        const headers = headerLine.split('|').filter(x => x.trim()).map(x => x.trim());
        
        if (headers.length === 0) return null;
        
        // 生成列名 (col_0, col_1, ...)
        const columns = headers.map((h, idx) => ({
            name: `col_${idx}`,
            display_name: h,
            width: "auto"
        }));
        
        // 跳过分隔行，解析数据行
        const rows = [];
        for (let i = 2; i < tableLines.length; i++) {
            const line = tableLines[i];
            if (!line.includes('|')) break;
            const cells = line.split('|').filter(x => x.trim()).map(x => x.trim());
            if (cells.length > 0) {
                const row = {};
                cells.forEach((cell, idx) => {
                    if (idx < columns.length) {
                        row[`col_${idx}`] = cell;
                    }
                });
                rows.push(row);
            }
        }
        
        return {
            tag: "table",
            page_size: Math.min(rows.length, 10),
            row_height: "low",
            header_style: { 
                bold: true,
                background_style: "grey"
            },
            columns: columns,
            rows: rows
        };
    }

    /**
     * 将 Markdown 解析为飞书卡片元素数组
     * - 表格转换为独立的 table 元素
     * - 文本内容转换为 markdown 元素
     * - 标题会被正确处理
     * @param {string} markdown 
     * @returns {object[]} 飞书卡片元素数组
     */
    parseMarkdownToElements(markdown) {
        const lines = markdown.split('\n');
        const elements = [];
        let currentTextLines = [];
        let i = 0;
        
        const flushText = () => {
            if (currentTextLines.length > 0) {
                let text = currentTextLines.join('\n').trim();
                if (text) {
                    // 处理标题降级：### 及以上降为 ##
                    text = text.replace(/^#{3,}\s+/gm, '## ');
                    elements.push({ tag: "markdown", content: text });
                }
                currentTextLines = [];
            }
        };
        
        while (i < lines.length) {
            const line = lines[i];
            const trimmed = line.trim();
            
            // 检测 Markdown 表格
            if (trimmed.startsWith('|') && i + 1 < lines.length) {
                const nextLine = lines[i + 1]?.trim() || '';
                // 检查是否是表格分隔行 (|---|---|)
                if (nextLine.match(/^\|[\s\-:|]+\|/)) {
                    // 先输出之前累积的文本
                    flushText();
                    
                    // 收集整个表格
                    const tableLines = [trimmed];
                    i++;
                    while (i < lines.length && lines[i].trim().startsWith('|')) {
                        tableLines.push(lines[i].trim());
                        i++;
                    }
                    
                    // 转换表格为飞书元素
                    const tableElement = this.parseMarkdownTableToElement(tableLines);
                    if (tableElement) {
                        elements.push(tableElement);
                    } else {
                        // 转换失败，保留原始文本
                        currentTextLines.push(...tableLines);
                    }
                    continue;
                }
            }
            
            // 普通行
            currentTextLines.push(line);
            i++;
        }
        
        // 输出剩余文本
        flushText();
        
        return elements;
    }

    /**
     * 构建飞书消息卡片
     * @param {string} markdown - Markdown 内容
     * @param {object} options - 可选配置
     * @param {string} options.template - 卡片头部颜色模板
     * @param {string} options.title - 卡片标题
     * @param {array} options.buttons - 按钮配置 [{text, value, type}]
     */
    buildCard(markdown, options = {}) {
        let title = options.title || "";
        let content = markdown;
        
        // 提取标题 (如果以 # 开头)
        if (markdown.startsWith("# ")) {
            const lines = markdown.split("\n");
            title = lines[0].replace("# ", "").trim();
            content = lines.slice(1).join("\n").trim();
        }
        
        // 解析 Markdown 为飞书元素数组
        const elements = this.parseMarkdownToElements(content);
        
        // 添加按钮 (如果有)
        if (options.buttons && options.buttons.length > 0) {
            const actions = options.buttons.map(btn => ({
                tag: "button",
                text: { tag: "plain_text", content: btn.text },
                type: btn.type || "default", // primary, danger, default
                value: { action: btn.value || btn.text }
            }));
            
            elements.push({
                tag: "action",
                actions: actions
            });
        }
        
        const card = {
            schema: "2.0",
            config: { 
                wide_screen_mode: true, 
                update_multi: true
            },
            header: title ? {
                title: { tag: "plain_text", content: title },
                template: options.template || "blue"
            } : undefined,
            body: {
                elements: elements
            }
        };
        
        // 如果没有标题，移除 header
        if (!title) {
            delete card.header;
        }
        
        return card;
    }

    async sendAuto(chatId, text, messageId = null) {
        // 如果有 messageId，直接尝试原地更新
        if (messageId) {
            try {
                return await this.updateCard(messageId, text);
            } catch (e) {
                this.safeLogger.warn(`Failed to update card ${messageId}, falling back to new message: ${e.message}`);
            }
        }
        // 检测是否需要使用卡片格式
        if (/[#*`\[\-|]/.test(text) || text.includes('\n')) {
            return this.sendCard(chatId, text);
        }
        return this.sendText(chatId, text);
    }

    getReceiveIdType(id) {
        if (!id) return 'chat_id';
        const type = id.startsWith('ou_') ? 'open_id' :
                     id.startsWith('on_') ? 'union_id' :
                     id.startsWith('email_') ? 'email' : 'chat_id';
        this.logger?.info(`[Feishu] Resolve ID type: ${id} -> ${type}`);
        return type;
    }

    async sendText(chatId, text) {
        return await this.client.im.message.create({
            params: { receive_id_type: this.getReceiveIdType(chatId) },
            data: {
                receive_id: chatId,
                msg_type: 'text',
                content: JSON.stringify({ text }),
            },
        });
    }

    /**
     * 发送消息卡片
     * @param {string} chatId - 聊天 ID
     * @param {string} markdown - Markdown 内容
     * @param {object} options - 可选配置 (template, buttons, title)
     * @returns {object} - 包含 message_id 的响应
     */
    async sendCard(chatId, markdown, options = {}) {
        const card = this.buildCard(markdown, options);

        return await this.client.im.message.create({
            params: { receive_id_type: this.getReceiveIdType(chatId) },
            data: {
                receive_id: chatId,
                msg_type: 'interactive',
                content: JSON.stringify(card),
            },
        });
    }

    /**
     * 发送带状态的互动卡片 (支持后续更新)
     * @param {string} chatId - 聊天 ID
     * @param {object} cardConfig - 卡片配置
     * @param {string} cardConfig.title - 卡片标题
     * @param {string} cardConfig.content - Markdown 内容
     * @param {string} cardConfig.status - 状态: pending, running, success, error
     * @param {array} cardConfig.buttons - 按钮配置
     * @returns {object} - 包含 message_id 的响应
     */
    async sendStatusCard(chatId, cardConfig) {
        const statusTemplates = {
            pending: "grey",
            running: "blue", 
            success: "green",
            error: "red",
            warning: "orange"
        };
        
        const statusIcons = {
            pending: "⏳",
            running: "🔄",
            success: "✅",
            error: "❌",
            warning: "⚠️"
        };
        
        const status = cardConfig.status || "pending";
        const template = statusTemplates[status] || "blue";
        const icon = statusIcons[status] || "";
        
        const title = cardConfig.title ? `${icon} ${cardConfig.title}` : "";
        
        const card = this.buildCard(cardConfig.content || "", {
            title: title,
            template: template,
            buttons: cardConfig.buttons
        });
        
        return await this.client.im.message.create({
            params: { receive_id_type: this.getReceiveIdType(chatId) },
            data: {
                receive_id: chatId,
                msg_type: 'interactive',
                content: JSON.stringify(card),
            },
        });
    }

    /**
     * 更新已发送的卡片消息
     * @param {string} messageId - 要更新的消息 ID
     * @param {string} markdown - 新的 Markdown 内容
     * @param {object} options - 可选配置 (template, buttons, title)
     */
    async updateCard(messageId, markdown, options = {}) {
        // 自动判定模板颜色：如果包含 "✅" 或 "完成" 字样，自动转为绿色
        const template = (markdown.includes('✅') || markdown.includes('已就绪')) ? "green" : "blue";
        const card = this.buildCard(markdown, { ...options, template });

        return await this.client.im.message.patch({
            path: { message_id: messageId },
            data: {
                content: JSON.stringify(card),
            },
        });
    }

    /**
     * 更新状态卡片
     * @param {string} messageId - 要更新的消息 ID
     * @param {object} cardConfig - 新的卡片配置
     */
    async updateStatusCard(messageId, cardConfig) {
        const statusTemplates = {
            pending: "grey",
            running: "blue",
            success: "green", 
            error: "red",
            warning: "orange"
        };
        
        const statusIcons = {
            pending: "⏳",
            running: "🔄",
            success: "✅",
            error: "❌",
            warning: "⚠️"
        };
        
        const status = cardConfig.status || "success";
        const template = statusTemplates[status] || "green";
        const icon = statusIcons[status] || "";
        
        const title = cardConfig.title ? `${icon} ${cardConfig.title}` : "";
        
        const card = this.buildCard(cardConfig.content || "", {
            title: title,
            template: template,
            buttons: cardConfig.buttons
        });
        
        return await this.client.im.message.patch({
            path: { message_id: messageId },
            data: {
                content: JSON.stringify(card),
            },
        });
    }

    // 媒体上传和发送方法
    async uploadImage(filePath) {
        const fileStream = fs.createReadStream(filePath);
        const resp = await this.client.im.image.create({ 
            data: { image_type: 'message', image: fileStream } 
        });
        return resp.image_key;
    }
    
    async uploadFile(filePath, fileType = 'stream') {
        const fileStream = fs.createReadStream(filePath);
        const resp = await this.client.im.file.create({ 
            data: { 
                file_type: fileType, 
                file_name: path.basename(filePath), 
                file: fileStream 
            } 
        });
        return resp.file_key;
    }
    
    async sendImage(chatId, imageKey) {
        return await this.client.im.message.create({ 
            params: { receive_id_type: this.getReceiveIdType(chatId) }, 
            data: { 
                receive_id: chatId, 
                msg_type: 'image', 
                content: JSON.stringify({ image_key: imageKey }) 
            } 
        });
    }
    
    async sendFile(chatId, fileKey) {
        return await this.client.im.message.create({ 
            params: { receive_id_type: this.getReceiveIdType(chatId) }, 
            data: { 
                receive_id: chatId, 
                msg_type: 'file', 
                content: JSON.stringify({ file_key: fileKey }) 
            } 
        });
    }
    
    /**
     * 解析飞书富文本(Post)消息内容为 Markdown
     */
    parsePostContent(contentJson) {
        try {
            // 兼容 content 已经是对象的情况
            const content = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson;
            
            const keys = Object.keys(content);
            if (keys.length === 0) return "";
            
            const postBody = content[keys[0]];
            const lines = [];
            
            if (postBody.title) {
                lines.push(`# ${postBody.title}`);
            }
            
            if (Array.isArray(postBody.content)) {
                for (const paragraph of postBody.content) {
                    const lineParts = [];
                    for (const elem of paragraph) {
                        if (elem.tag === 'text') {
                            lineParts.push(elem.text);
                        } else if (elem.tag === 'a') {
                            lineParts.push(`[${elem.text}](${elem.href})`);
                        } else if (elem.tag === 'at') {
                            lineParts.push(`@${elem.user_name || elem.user_id}`);
                        } else if (elem.tag === 'img') {
                            lineParts.push(`[图片]`);
                        }
                    }
                    lines.push(lineParts.join(''));
                }
            }
            
            return lines.join('\n');
        } catch (e) {
            this.safeLogger.error(`Failed to parse post content: ${e.message}`);
            return "";
        }
    }
    
    async start() {
        const core = getCoreRuntime();
        this.wsClient = new lark.WSClient({ 
            appId: this.appId, 
            appSecret: this.appSecret, 
            logger: this.safeLogger 
        });
        
        const dispatcher = new lark.EventDispatcher({}).register({
            'im.message.receive_v1': async (data) => {
                const { message, sender } = data;
                let contentText = "";
                
                if (message.message_type === 'text') {
                    try {
                        contentText = JSON.parse(message.content).text;
                    } catch (e) {
                        this.safeLogger.error(`Failed to parse text message: ${e.message}`);
                    }
                } else if (message.message_type === 'post') {
                    // 处理富文本消息
                    contentText = this.parsePostContent(message.content);
                }
                
                const chatId = message.chat_id;
                
                if (core && core.channel && core.channel.reply) {
                    core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                        ctx: { 
                            Body: contentText, 
                            From: sender.sender_id.open_id, 
                            To: chatId, 
                            SessionKey: 'feishu:' + chatId, 
                            Provider: 'feishu' 
                        },
                        cfg: this.ctx.cfg,
                        dispatcherOptions: {
                            deliver: async (payload) => {
                                if (payload.text) {
                                    await this.sendAuto(chatId, payload.text);
                                }
                            }
                        }
                    });
                }
                return {};
            },
            // 处理卡片按钮回调
            'card.action.trigger': async (data) => {
                this.logger?.info(`[Feishu] Card action received: ${JSON.stringify(data)}`);

                const { action, operator, token } = data;
                // 尝试从多个位置获取 chat_id (兼容不同版本的事件结构)
                const chatId = data.open_chat_id || data.context?.open_chat_id || operator?.open_id;
                const messageId = data.open_message_id || data.context?.open_message_id;
                // 获取 action value
                const actionValue = action?.value?.action || JSON.stringify(action?.value || {});
                
                if (!chatId) {
                    this.logger?.error('[Feishu] Failed to resolve chatId from card action', data);
                    return {};
                }
                
                if (core && core.channel && core.channel.reply) {
                    // 将按钮点击作为用户消息处理
                    const buttonMessage = `[Button Clicked] ${actionValue}`;
                    core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                        ctx: { 
                            Body: buttonMessage, 
                            From: operator.open_id, 
                            To: chatId, 
                            SessionKey: 'feishu:' + chatId, 
                            Provider: 'feishu',
                            CardMessageId: messageId,
                            ActionValue: actionValue
                        },
                        cfg: this.ctx.cfg,
                        dispatcherOptions: {
                            deliver: async (payload) => {
                                if (payload.text) {
                                    try {
                                        await this.sendAuto(chatId, payload.text);
                                    } catch (err) {
                                        this.logger?.error(`[Feishu] Reply to card action failed: ${err.message}`, err);
                                    }
                                }
                            }
                        }
                    });
                }
                
                return {};
            }
        });
        
        await this.wsClient.start({ eventDispatcher: dispatcher });
    }
}
