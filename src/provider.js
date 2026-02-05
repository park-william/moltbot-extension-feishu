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
        
        this.safeLogger.info('[Feishu] Provider loaded v4 - Fix Applied');

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
            // schema: "2.0", // 降级到 V1 以支持 action module
            config: { 
                wide_screen_mode: true, 
                update_multi: true
            },
            header: title ? {
                title: { tag: "plain_text", content: title },
                template: options.template || "blue"
            } : undefined,
            elements: elements // V1: elements 在顶层
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
            
            let postBody = content;
            // 如果顶层没有 content 字段，尝试解包语言键 (例如 "zh_cn")
            if (!postBody.content) {
                const keys = Object.keys(content);
                if (keys.length > 0 && content[keys[0]]?.content) {
                    postBody = content[keys[0]];
                }
            }
            
            if (!postBody.content) return "";

            const lines = [];
            if (postBody.title) {
                lines.push(`# ${postBody.title}`);
            }
            
            if (Array.isArray(postBody.content)) {
                for (const paragraph of postBody.content) {
                    const lineParts = [];
                    for (const elem of paragraph) {
                        let text = "";
                        if (elem.tag === 'text') {
                            text = elem.text;
                            // 处理样式
                            if (elem.style) {
                                if (elem.style.includes('bold')) text = `**${text}**`;
                                if (elem.style.includes('italic')) text = `*${text}*`;
                                if (elem.style.includes('strike_through')) text = `~~${text}~~`;
                            }
                        } else if (elem.tag === 'a') {
                            text = `[${elem.text}](${elem.href})`;
                        } else if (elem.tag === 'at') {
                            text = `@${elem.user_name || elem.user_id}`;
                        } else if (elem.tag === 'img') {
                            text = `[图片]`;
                        } else if (elem.tag === 'media') {
                            text = `[视频]`;
                        }
                        lineParts.push(text);
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

    /**
     * 下载飞书图片到本地
     * @param {string} imageKey - 图片的 image_key
     * @param {string} messageId - 消息 ID
     * @returns {Promise<string|null>} 本地文件路径或 null
     */
    async downloadImage(imageKey, messageId) {
        try {
            this.safeLogger.info(`[Feishu] Starting download for imageKey: ${imageKey}, messageId: ${messageId}`);
            
            // 创建媒体目录
            const homeDir = process.env.HOME || '/tmp';
            const mediaDir = path.join(homeDir, '.openclaw', 'media', 'feishu');
            if (!fs.existsSync(mediaDir)) {
                fs.mkdirSync(mediaDir, { recursive: true });
            }

            // 使用 image_key 作为文件名
            const filePath = path.join(mediaDir, `${imageKey}.png`);
            
            // 如果文件已存在，直接返回
            if (fs.existsSync(filePath)) {
                this.safeLogger.info(`[Feishu] Image already exists: ${filePath}`);
                return filePath;
            }

            // 下载图片
            const response = await this.client.im.messageResource.get({
                path: {
                    message_id: messageId,
                    file_key: imageKey,
                },
                params: {
                    type: 'image',
                },
            });

            // 优先处理 SDK 的 writeFile 方法
            if (response && typeof response.writeFile === 'function') {
                await response.writeFile(filePath);
                this.safeLogger.info(`[Feishu] Downloaded image to ${filePath} (via writeFile)`);
                return filePath;
            }
            
            // 写入文件 (旧版 SDK 兼容)
            if (response && response.data) {
                const writeStream = fs.createWriteStream(filePath);
                await new Promise((resolve, reject) => {
                    response.data.pipe(writeStream);
                    response.data.on('end', resolve);
                    response.data.on('error', reject);
                });
                this.safeLogger.info(`[Feishu] Downloaded image to ${filePath} (via stream)`);
                return filePath;
            } else {
                this.safeLogger.warn(`[Feishu] Empty response data for imageKey: ${imageKey}, keys: ${Object.keys(response || {}).join(',')}`);
            }
            
            return null;
        } catch (e) {
            this.safeLogger.error(`[Feishu] Failed to download image: ${e.message}`, e.response?.data);
            return null;
        }
    }
    
    /**
     * 递归从 Post 消息中提取并下载图片
     * @returns {Promise<string[]>} 下载后的本地文件路径数组
     */
    async downloadPostImages(contentJson, messageId) {
        const paths = [];
        try {
            // 兼容 content 已经是对象的情况
            const content = typeof contentJson === 'string' ? JSON.parse(contentJson) : contentJson;
            
            // 递归查找 img 标签
            const findImages = (obj) => {
                if (!obj) return;
                if (Array.isArray(obj)) {
                    obj.forEach(findImages);
                } else if (typeof obj === 'object') {
                    if (obj.tag === 'img' && obj.image_key) {
                        paths.push(obj.image_key);
                    } else {
                        Object.values(obj).forEach(findImages);
                    }
                }
            };
            
            findImages(content);
            
            // 逐个下载
            const localPaths = [];
            for (const imageKey of paths) {
                try {
                    const localPath = await this.downloadImage(imageKey, messageId);
                    if (localPath) localPaths.push(localPath);
                } catch (err) {
                    this.safeLogger.error(`[Feishu] Failed to download post image ${imageKey}: ${err.message}`);
                }
            }
            
            return localPaths;
        } catch (e) {
            this.safeLogger.error(`[Feishu] Failed to extract images from post: ${e.message}`);
            return [];
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
                let mediaPaths = [];

                if (message.message_type === 'text') {
                    try {
                        contentText = JSON.parse(message.content).text;
                    } catch (e) {
                        this.safeLogger.error(`Failed to parse text message: ${e.message}`);
                    }
                } else if (message.message_type === 'post') {
                    // 处理富文本消息
                    contentText = this.parsePostContent(message.content);
                    // NEW: 下载富文本中的图片
                    const postImages = await this.downloadPostImages(message.content, message.message_id);
                    if (postImages.length > 0) {
                        mediaPaths.push(...postImages);
                    }
                } else if (message.message_type === 'image') {
                    // 处理图片消息：下载图片并作为附件传递
                    try {
                        const content = typeof message.content === 'string' 
                            ? JSON.parse(message.content) 
                            : message.content;
                        const imageKey = content.image_key;
                        if (imageKey) {
                            const localPath = await this.downloadImage(imageKey, message.message_id);
                            if (localPath) {
                                mediaPaths.push(localPath);
                                contentText = "[用户发送了一张图片]";
                            } else {
                                contentText = "[用户发送了一张图片，但下载失败]";
                            }
                        } else {
                            contentText = "[用户发送了一张图片]";
                        }
                    } catch (e) {
                        this.safeLogger.error(`Failed to process image message: ${e.message}`);
                        contentText = "[用户发送了一张图片]";
                    }
                } else if (message.message_type === 'file') {
                    // 处理文件消息
                    contentText = "[用户发送了一个文件]";
                } else if (message.message_type === 'audio') {
                    // 处理音频消息
                    contentText = "[用户发送了一段语音]";
                } else if (message.message_type === 'video') {
                    // 处理视频消息
                    contentText = "[用户发送了一段视频]";
                } else if (message.message_type === 'sticker') {
                    // 处理表情消息
                    contentText = "[用户发送了一个表情]";
                } else {
                    // 未知类型，尝试提供信息
                    contentText = `[用户发送了 ${message.message_type} 类型消息]`;
                }
                
                const chatId = message.chat_id;
                
                if (core && core.channel && core.channel.reply) {
                    const ctx = { 
                        Body: contentText, 
                        From: sender.sender_id.open_id, 
                        To: chatId, 
                        SessionKey: 'feishu:' + chatId, 
                        Provider: 'feishu' 
                    };
                    
                    // 如果有媒体文件，添加到上下文
                    if (mediaPaths.length > 0) {
                        ctx.MediaPaths = mediaPaths;
                        ctx.MediaUrls = mediaPaths; // 本地路径也作为 URL
                        ctx.MediaPath = mediaPaths[0];
                        ctx.MediaUrl = mediaPaths[0];
                    }
                    
                    core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                        ctx,
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
