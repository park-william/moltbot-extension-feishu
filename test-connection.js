import * as lark from '@larksuiteoapi/node-sdk';

const APP_ID = "cli_a9f2f4bc6ab81bb5";
const APP_SECRET = "Fv6lDMWG781FeHDeUG4YEcMGjdh3bBQ5";

console.log("Starting DEBUG standalone Feishu connection...");
console.log(`App ID: ${APP_ID}`);

async function main() {
    try {
        const wsClient = new lark.WSClient({
            appId: APP_ID,
            appSecret: APP_SECRET,
            logger: {
                debug: (...args) => console.log('[DEBUG]', ...args),
                info: (...args) => console.log('[INFO]', ...args),
                warn: (...args) => console.warn('[WARN]', ...args),
                error: (...args) => console.error('[ERROR]', ...args),
            }
        });

        console.log("Attempting to connect to Feishu WebSocket...");
        
        await wsClient.start({
            eventDispatcher: new lark.EventDispatcher({}).register({
                'im.message.receive_v1': async (data) => {
                    console.log("\n>>> RECEIVED MESSAGE! <<<");
                    console.log(JSON.stringify(data, null, 2));
                }
            })
        });

        console.log("✅ WebSocket connected successfully! App should be 'online' now.");
        console.log("Keep this running and send a message in Feishu to test.");

    } catch (err) {
        console.error("❌ Connection failed!");
        console.error(err);
    }
}

main();
