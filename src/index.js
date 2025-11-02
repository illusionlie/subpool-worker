/**
 * @name Subscription Pool Worker
 * @version 2.0.0
 * @description A refactored Cloudflare Worker for aggregating and serving subscription links with multi-group support.
 * @license MIT
 */

// ============================================================================================
// ================================  USER CONFIGURATION START  ================================
// ============================================================================================

const CONFIG = {
    // ---------------------------------------------------------------------------------------
    // Essential Settings - 基础设置
    // ---------------------------------------------------------------------------------------

    // Worker's filename, used in the 'Content-Disposition' header.
    // 文件名, 用于下发订阅的 'Content-Disposition' 头。
    fileName: 'cf-Worker-subpool',

    // Subscription update interval in hours, sent to clients.
    // 订阅更新间隔（小时），会下发给客户端。
    subUpdateTime: 4,

    // Sub-converter API backend. You can use a public one or self-host.
    // DO NOT include 'http(s)://'.
    // 订阅转换后端 API。可使用公共服务或自建。
    // 注意：不要包含 'http(s)://'。
    subConverterUrl: 'subsec.illusionlie.com',

    // Default configuration file for the sub-converter.
    // 订阅转换所使用的配置文件。
    subConverterConfig: 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry.ini',

    // ---------------------------------------------------------------------------------------
    // Subscription Groups - 订阅组配置
    // This is the core of the new extensible structure.
    // 这里是新的可扩展结构的核心。
    // ---------------------------------------------------------------------------------------

    subscriptionGroups: [
        {
            id: 'main', // A unique identifier for this group.
            name: '主订阅', // A user-friendly name.
            token: '2a99e95d-b3a8-4229-995b-50207d69437f',
            is_admin: true, // If true, this token can access the admin page.
            dataSources: [
                // A list of subscription URLs or inline nodes.
                'vless://b964cfbe-5f8a-47ae-9f14-4a6e36bfed2b@tmd.weyolo.com:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=tesla.com&fp=chrome&pbk=vNWTKraW-w1e5fUKLJhjDpslQX7OFnRbavF2VHowNhk&sid=cb37b04594&spx=%2F&allowInsecure=1&type=tcp&headerType=none#%F0%9F%87%AF%F0%9F%87%B5%20%E6%B5%8B%E8%AF%95-%E6%97%A5%E6%9C%AC%E8%BD%AC%E6%B4%9B%E6%9D%89%E7%9F%B61',
               
            ],
            filter: {
                enabled: true,
                rules: [
                    /剩余流量/i,
                    /过期时间/i,
                    /套餐到期/i,
                    /距离下次重置/i,
                    /hysteria2:\/\//i,
                    /TG群/i,
                    /官址/i,
                ]
            }
        },
        {
            id: 'best',
            name: '优选订阅',
            token: '1624933e-2657-4224-b0e4-7f245b49c65e',
            is_admin: false,
            dataSources: [
                'ss://YWVzLTI1Ni1nY206MWU2YWQ5MDYtMGFlZS0zOWU0LWJjNjItYmFmMzkyYTBkZmI3@92ufd-g04.kr01-ae5.entry.v50708.dev:20042#%E9%9F%A9%E5%9B%BD-%E9%AB%98%E9%98%B3-Tier0-sid%3AIEPL-flag%3AD',
            ],
            filter: {
                enabled: true,
                rules: [
                    /测试/i,
                    /免费/i,
                    /TG@/i,
                    /剩余流量/i,
                    /过期时间/i,
                    /套餐到期/i,
                    /距离下次重置/i,
                ]
            }
        },
        {
            id: 'guest',
            name: '访客订阅',
            token: '2f613167-702a-4710-af7c-bae1566f5183',
            is_admin: false,
            is_guest: true, // Marks this as a guest subscription.
            dataSources: [
                // Inline nodes for guests.
                'vmess://ew0KICAidiI6ICIyIiwNCiAgInBzIjogIuWPsOa5vi3lrrblrr0iLA0KICAiYWRkIjogImM4ZTg5NzRkLXQwZmRzMC10MGw3YWUtNG1jZS43Ny5pd3Nrd2FpLmNvbSIsDQogICJwb3J0IjogIjM2ODciLA0KICAiaWQiOiAiMDZjNjI1ZWEtNTkwMi0xMWVlLTllODctZjIzYzkzMTNiMTc3IiwNCiAgImFpZCI6ICIwIiwNCiAgInNjeSI6ICJhdXRvIiwNCiAgIm5ldCI6ICJ0Y3AiLA0KICAidHlwZSI6ICJub25lIiwNCiAgImhvc3QiOiAiYzhlODk3NGQtdDBmZHMwLXQwbDdhZS00bWNlLjc3Lml3c2t3YWkuY29tIiwNCiAgInBhdGgiOiAiLyIsDQogICJ0bHMiOiAiIiwNCiAgInNuaSI6ICIiLA0KICAiYWxwbiI6ICIiLA0KICAiZnAiOiAiIg0KfQ==',
            ],
            filter: {
                enabled: false,
                rules: []
            }
        },
        {
            id: 'example',
            name: '样式订阅',
            token: 'testtoken',
            is_admin: false,
            is_guest: true,
            dataSources: [
                'vless://d6b8011a-c725-435a-9fec-bf6d3530392c@104.17.142.12:443?encryption=none&security=tls&sni=vle.amclubsapp.dpdns.org&fp=chrome&allowInsecure=1&type=ws&host=vle.amclubsapp.dpdns.org&path=%2F#%F0%9F%87%A8%F0%9F%87%A6%E5%8A%A0%E6%8B%BF%E5%A4%A71%20%7C%20%E2%AC%87%EF%B8%8F%202.5MB%2Fs',
            ],
            filter: {
                enabled: false,
                rules: []
            }
        }
    ],

    // ---------------------------------------------------------------------------------------
    // Telegram Bot Notification Settings - TG 推送设置
    // ---------------------------------------------------------------------------------------

    telegram: {
        // Enable or disable all Telegram notifications.
        enabled: true,

        // Your Telegram Bot Token.
        // TG 机器人的 BotToken。
        botToken: '',

        // Your Telegram Chat ID.
        // 推送消息的 ChatID。
        chatId: '',

        // Log all access requests. If false, only subscription retrievals and errors are logged.
        // 推送所有访问信息。如果为 false，则仅推送订阅获取和异常访问。
        logAllAccess: false,
    },

    // ---------------------------------------------------------------------------------------
    // Advanced Settings - 高级设置
    // ---------------------------------------------------------------------------------------

    // Simulates subscription info for some clients.
    // 伪装部分客户端的订阅信息。
    subscriptionInfo: {
        totalTB: 99,
        expireDate: '2099-12-31',
    },

};

// ============================================================================================
// =================================  USER CONFIGURATION END  =================================
// ============================================================================================


/**
 * Global state, initialized from environment variables.
 */
const ENV_STATE = {};

/**
 * Main fetch handler for the Cloudflare Worker.
 */
export default {
    async fetch(request, env) {
        initializeConfigFromEnv(env);
        const url = new URL(request.url);
        
        const { group, fakeToken } = await findGroupForRequest(request, url);
        
        if (!group) {
            return handleUnauthorizedAccess(request, url);
        }

        // 检查是否ip来自中国
        const country = request.cf?.country;
        if (country && country === "CN") {
            return new Response(renderNginxWelcomePage(), {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=UTF-8' },
            });
        }

        // Handle admin page access for admins
        const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();
        if (group.is_admin && userAgent.includes('mozilla') && !url.search) {
            await sendTelegramMessage(`#管理页面访问: ${ENV_STATE.fileName}`, request);
            return renderAdminPage(request, group);
        }

        // Process subscription request
        await sendTelegramMessage(`#获取订阅: ${group.name}`, request);
        return processSubscriptionRequest(request, url, group, fakeToken);
    }
};

/**
 * Initializes and merges configuration from environment variables.
 * @param {object} env - The environment variables object.
 */
function initializeConfigFromEnv(env) {
    ENV_STATE.fileName = env.SUBNAME || CONFIG.fileName;
    ENV_STATE.subUpdateTime = env.SUBUPTIME || CONFIG.subUpdateTime;
    
    let subConverterUrl = env.SUBAPI || CONFIG.subConverterUrl;
    if (subConverterUrl.includes("://")) {
        const parts = subConverterUrl.split('://');
        ENV_STATE.subConverterProtocol = parts[0];
        ENV_STATE.subConverterUrl = parts[1];
    } else {
        ENV_STATE.subConverterProtocol = 'https';
        ENV_STATE.subConverterUrl = subConverterUrl;
    }

    ENV_STATE.subConverterConfig = env.SUBCONFIG || CONFIG.subConverterConfig;
    
    // Telegram settings
    CONFIG.telegram.botToken = env.TGTOKEN || CONFIG.telegram.botToken;
    CONFIG.telegram.chatId = env.TGID || CONFIG.telegram.chatId;
    if (env.TG !== undefined) {
        CONFIG.telegram.logAllAccess = !!parseInt(env.TG, 10);
    }
    
    // KV and other env settings
    ENV_STATE.kv = env.KV;
    ENV_STATE.url302 = env.URL302;
    ENV_STATE.proxyUrl = env.URL;
    ENV_STATE.warp = env.WARP ? env.WARP.split('\n').filter(Boolean) : [];
    ENV_STATE.linksub = env.LINKSUB ? env.LINKSUB.split('\n').filter(Boolean) : [];

    // Override group data from environment variables if they exist
    CONFIG.subscriptionGroups.forEach(group => {
        const envDataSource = env[`${group.id.toUpperCase()}_DATA`];
        if (envDataSource) {
            group.dataSources = envDataSource.split('\n').filter(Boolean);
        }
        const envToken = env[`${group.id.toUpperCase()}_TOKEN`];
        if (envToken) {
            group.token = envToken;
        }
    });

    // Handle legacy environment variables for backward compatibility
    const adminGroup = CONFIG.subscriptionGroups.find(g => g.is_admin);
    if (adminGroup) {
        adminGroup.token = env.TOKEN || adminGroup.token;
        if (env.LINK) {
            adminGroup.dataSources = (env.LINK.split('\n').filter(Boolean));
        }
    }
    const guestGroup = CONFIG.subscriptionGroups.find(g => g.is_guest);
    if (guestGroup) {
        guestGroup.token = env.GUESTTOKEN || env.GUEST || guestGroup.token;
    }
}

/**
 * Finds the appropriate subscription group based on the request token or path.
 * @param {Request} request
 * @param {URL} url
 * @returns {Promise<{group: object | null, fakeToken: string | null}>}
 */
async function findGroupForRequest(request, url) {
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    const timeTemp = Math.ceil(currentDate.getTime() / 1000);


    // Generate a daily fake token for EACH group.
    const groupFakeTokens = new Map();
    for (const group of CONFIG.subscriptionGroups) {
        const fakeToken = await generateMD5(group.token + timeTemp);
        groupFakeTokens.set(fakeToken, group);
    }

    const requestToken = url.searchParams.get('token');
    
    if (requestToken) {
        // 1. Check if the request token is a permanent token.
        const group = CONFIG.subscriptionGroups.find(g => g.token === requestToken);
        if (group) {
            const groupFakeToken = await generateMD5(group.token + timeTemp);
            return { group, fakeToken: groupFakeToken };
        }
        
        // 2. Check if the request token is a daily fake token.
        if (groupFakeTokens.has(requestToken)) {
            const matchedGroup = groupFakeTokens.get(requestToken);
            return { group: matchedGroup, fakeToken: requestToken };
        }

    } else {
        // Find by token in path (only for permanent tokens).
        const pathToken = url.pathname.slice(1).split('?')[0];
        const group = CONFIG.subscriptionGroups.find(g => g.token === pathToken);
        if (group) {
            const groupFakeToken = await generateMD5(group.token + timeTemp);
            return { group, fakeToken: groupFakeToken };
        }
    }
    
    return { group: null, fakeToken: null };
}

/**
 * Handles unauthorized access by redirecting, proxying, or showing a default page.
 * @param {Request} request
 * @param {URL} url
 * @returns {Promise<Response>}
 */
async function handleUnauthorizedAccess(request, url) {
    if (url.pathname !== "/" && url.pathname !== "/favicon.ico") {
        await sendTelegramMessage(`#异常访问: ${ENV_STATE.fileName}`, request);
    }
    if (ENV_STATE.url302) {
        return Response.redirect(ENV_STATE.url302, 302);
    }
    if (ENV_STATE.proxyUrl) {
        return proxyRequest(ENV_STATE.proxyUrl, request); 
    }
    return new Response(renderNginxWelcomePage(), {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
}

/**
 * Processes the subscription request for an authorized group.
 * @param {Request} request
 * @param {URL} url
 * @param {object} group - The matched subscription group.
 * @param {string} fakeToken - The daily fake token for the admin group.
 * @returns {Promise<Response>}
 */
async function processSubscriptionRequest(request, url, group, fakeToken) {
    const userAgent = (request.headers.get('User-Agent') || '').toLowerCase();
    
    // 1. Gather all data sources
    let allDataSources = [...group.dataSources, ...ENV_STATE.linksub];
    if (group.is_admin && ENV_STATE.kv) {
        await migrateKVData('LINK.txt');
        const kvData = await ENV_STATE.kv.get('LINK.txt');
        if (kvData) allDataSources = kvData.split('\n').filter(Boolean);
    }

    // 2. Separate inline nodes and subscription URLs
    const inlineNodes = [];
    let subscriptionUrls = [];
    allDataSources.forEach(source => {
        if (source.toLowerCase().startsWith('http')) {
            subscriptionUrls.push(source);
        } else {
            inlineNodes.push(source);
        }
    });
    subscriptionUrls = [...new Set(subscriptionUrls)];

    // 3. Fetch remote subscriptions
    const { fetchedNodes, conversionUrls } = await fetchSubscriptionData(subscriptionUrls, request, group.filter);
    
    // 4. Combine, filter, and deduplicate all nodes
    let combinedNodes = [...inlineNodes, ...fetchedNodes];
    let content = applyFilter(combinedNodes.join('\n'), group.filter);
    content = [...new Set(content.split('\n'))].join('\n');
    
    // 5. Determine output format
    const outputFormat = getOutputFormat(url, userAgent);

    // 6. Generate final response
    const base64Content = safeBtoa(content);
    
    // Return raw base64 if requested or if it's a sub-converter request
    const isConverterRequest = url.searchParams.get('token') === fakeToken;
    if (outputFormat === 'base64' || isConverterRequest) {
        return createSubscriptionResponse(base64Content, 'text/plain');
    }

    // Prepare for sub-converter
    let finalConversionUrls = [
        ...conversionUrls,
        ...ENV_STATE.warp,
    ];
    if (content.trim()) {
        const selfUrl = `${url.origin}/sub?token=${fakeToken}`;
        finalConversionUrls.unshift(selfUrl);
    }

    const subConverterUrl = generateSubConverterUrl(outputFormat, finalConversionUrls);
    
    try {
        const subConverterResponse = await fetch(subConverterUrl);
        if (!subConverterResponse.ok) {
            throw new Error(`Sub-converter API error: ${subConverterResponse.status}`);
        }
        let subConverterContent = await subConverterResponse.text();
        if (outputFormat === 'clash') {
            subConverterContent = fixClashWireguard(subConverterContent);
        }
        return createSubscriptionResponse(subConverterContent, 'text/plain', true);
    } catch (error) {
        console.error('Sub-converter fetch failed:', error);
        // Fallback to base64 content
        return createSubscriptionResponse(base64Content, 'text/plain');
    }
}


// ============================================================================================
// ===================================  CORE LOGIC HELPERS  ===================================
// ============================================================================================

/**
 * Fetches and processes data from multiple subscription URLs.
 * @param {string[]} urls - Array of subscription URLs.
 * @param {Request} request
 * @param {object} filterConfig - The filter configuration for this group.
 * @returns {Promise<{fetchedNodes: string[], conversionUrls: string[]}>}
 */
async function fetchSubscriptionData(urls, request, filterConfig) {
    if (!urls || urls.length === 0) {
        return { fetchedNodes: [], conversionUrls: [] };
    }

    const fetchedNodes = [];
    const conversionUrls = [];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const promises = urls.map(url =>
        fetch(url, {
            method: 'GET',
            headers: { 'User-Agent': `v2rayN/6.45 (${request.headers.get('User-Agent') || 'N/A'})` },
            signal: controller.signal,
            cf: { insecureSkipVerify: true }
        }).then(async resp => {
            if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
            return { url, content: await resp.text() };
        }).catch(error => {
            // Wrap the error with the URL for context, but let the promise reject
            // so Promise.allSettled can correctly identify it as 'rejected'.
            return Promise.reject({ url, error });
        })
    );

    const results = await Promise.allSettled(promises);
    clearTimeout(timeoutId);

    for (const result of results) {
        if (result.status === 'fulfilled') {
            // This block handles successfully fetched subscriptions
            const { url, content } = result.value;
            if (content.includes('proxies:') || (content.includes('outbounds') && content.includes('inbounds'))) {
                conversionUrls.push(url); // Clash or Sing-box config
            } else if (isValidBase64(content)) {
                const decoded = atob(content);
                fetchedNodes.push(applyFilter(decoded, filterConfig));
            } else if (content.includes('://')) {
                fetchedNodes.push(applyFilter(content, filterConfig));
            } else {
                console.log(`Unrecognized content from ${url}`);
            }
        } else {
            // This block handles fetch failures (network errors, timeouts, non-ok statuses)
            const { url, error } = result.reason;
            console.error(`Failed to fetch ${url}:`, error.message || error);
        }
    }

    return { fetchedNodes, conversionUrls };
}

/**
 * Determines the requested subscription format.
 * @param {URL} url
 * @param {string} userAgent
 * @returns {string} - The format name (e.g., 'clash', 'singbox', 'base64').
 */
function getOutputFormat(url, userAgent) {
    const formatMap = {
        'clash': 'clash',
        'sing-box': 'singbox', 'singbox': 'singbox',
        'surge': 'surge',
        'quantumult%20x': 'quanx',
        'loon': 'loon',
    };

    const paramMap = {
        'clash': 'clash',
        'sb': 'singbox', 'singbox': 'singbox',
        'surge': 'surge',
        'quanx': 'quanx',
        'loon': 'loon',
        'b64': 'base64', 'base64': 'base64'
    };
    
    for (const [param, format] of Object.entries(paramMap)) {
        if (url.searchParams.has(param)) return format;
    }

    for (const [ua, format] of Object.entries(formatMap)) {
        if (userAgent.includes(ua)) return format;
    }

    return 'base64'; // Default format
}

/**
 * Generates the URL for the sub-converter API.
 * @param {string} targetFormat - The target format ('clash', 'singbox', etc.).
 * @param {string[]} conversionUrls - URLs to be converted.
 * @returns {string} - The full sub-converter URL.
 */
function generateSubConverterUrl(targetFormat, conversionUrls) {
    const urlParams = new URLSearchParams({
        target: targetFormat,
        url: conversionUrls.join('|'),
        insert: 'false',
        config: ENV_STATE.subConverterConfig,
        emoji: 'true',
        list: 'false',
        tfo: 'false',
        scv: 'true',
        fdn: 'false',
        sort: 'false',
    });
    
    if (targetFormat === 'clash' || targetFormat === 'singbox') {
        urlParams.set('new_name', 'true');
    }
    if (targetFormat === 'surge') {
        urlParams.set('ver', '4');
    }
    if (targetFormat === 'quanx') {
        urlParams.set('udp', 'true');
    }
    console.log(`${ENV_STATE.subConverterProtocol}://${ENV_STATE.subConverterUrl}/sub?${urlParams.toString()}`);
    return `${ENV_STATE.subConverterProtocol}://${ENV_STATE.subConverterUrl}/sub?${urlParams.toString()}`;
}


/**
 * Creates the final subscription Response object.
 * @param {string} content - The response body content.
 * @param {string} contentType - The content type.
 * @param {boolean} isConverted - Whether to add the 'Content-Disposition' header.
 * @returns {Response}
 */
function createSubscriptionResponse(content, contentType, isConverted = false) {
    const { totalTB, expireDate } = CONFIG.subscriptionInfo;
    const total = totalTB * 1099511627776;
    const timestamp = new Date(expireDate).getTime();
    const expire = Math.floor(timestamp / 1000);
    const now = Date.now();
    const uploaded = Math.floor(((timestamp - now) / timestamp * total) / 2);

    const headers = {
        'Content-Type': `${contentType}; charset=utf-8`,
        'Profile-Update-Interval': `${ENV_STATE.subUpdateTime}`,
        'Subscription-Userinfo': `upload=${uploaded}; download=${uploaded}; total=${total}; expire=${expire}`,
    };

    // 由于下载附件不符合预期，暂时禁用
    //if (isConverted) {
    //    headers['Content-Disposition'] = `attachment; filename*=utf-8''${encodeURIComponent(ENV_STATE.fileName)}`;
    //}

    return new Response(content, { headers });
}


// ============================================================================================
// ===================================  UTILITY FUNCTIONS  ====================================
// ============================================================================================

/**
 * Applies filtering rules to a string of nodes.
 * @param {string} content - The content to filter.
 * @param {object} filterConfig - The filter configuration object.
 * @returns {string} - The filtered content.
 */
function applyFilter(content, filterConfig) {
    if (!filterConfig || !filterConfig.enabled || !filterConfig.rules || filterConfig.rules.length === 0) {
        return content;
    }
    return content.split('\n')
        .filter(line => {
            if (!line.trim()) return true; // Keep empty lines
            return !filterConfig.rules.some(rule => rule.test(line));
        })
        .join('\n');
}

/**
 * Sends a notification message to Telegram.
 * @param {string} type - The message type/title.
 * @param {Request} request - The incoming request object.
 */
async function sendTelegramMessage(type, request) {
    const { enabled, botToken, chatId, logAllAccess } = CONFIG.telegram;
    if (!enabled || !botToken || !chatId) return;

    if (!logAllAccess && type.startsWith('#获取订阅')) return;

    const ip = request.headers.get('CF-Connecting-IP') || 'N/A';
    const userAgent = request.headers.get('User-Agent') || 'N/A';
    const url = new URL(request.url);

    let ipInfoStr = '';
    try {
        const ipInfo = await (await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN`)).json();
        if (ipInfo.status === 'success') {
            ipInfoStr = `国家: ${ipInfo.country}\n<tg-spoiler>城市: ${ipInfo.city}\n组织: ${ipInfo.org}</tg-spoiler>`;
        }
    } catch (e) { /* Ignore IP API errors */ }

    const msg = [
        `<b>${type}</b>`,
        `IP: ${ip}`,
        ipInfoStr,
        `UA: <tg-spoiler>${userAgent}</tg-spoiler>`,
        `入口: <tg-spoiler>${url.pathname}${url.search}</tg-spoiler>`
    ].filter(Boolean).join('\n');

    const tgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const params = new URLSearchParams({ chat_id: chatId, text: msg, parse_mode: 'HTML' });
    
    try {
        await fetch(`${tgUrl}?${params.toString()}`);
    } catch (error) {
        console.error('Telegram send failed:', error);
    }
}

/**
 * Generates an MD5 hash of the input text.
 * @param {string} text - The text to hash.
 * @returns {Promise<string>} - The MD5 hash.
 */
async function generateMD5(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('MD5', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Checks if a string is a valid Base64 string.
 * @param {string} str - The string to check.
 * @returns {boolean}
 */
function isValidBase64(str) {
    if (!str || typeof str !== 'string') return false;
    const cleanStr = str.replace(/\s/g, '');
    return /^[A-Za-z0-9+/=]+$/.test(cleanStr) && cleanStr.length % 4 === 0;
}

/**
 * Fixes WireGuard configuration in Clash by adding necessary parameters.
 * @param {string} content - The Clash configuration content.
 * @returns {string} - The fixed content.
 */
function fixClashWireguard(content) {
    if (content.includes('type: wireguard') && !content.includes('remote-dns-resolve')) {
        return content.replace(/, mtu: 1280, udp: true/g, ', mtu: 1280, remote-dns-resolve: true, udp: true');
    }
    return content;
}

/**
 * Safely Base64-encodes a string, supporting UTF-8 characters.
 * This is the modern and correct way to handle Unicode for btoa.
 * @param {string} str The string to encode.
 * @returns {string} The Base64-encoded string.
 */
function safeBtoa(str) {
    const utf8Bytes = new TextEncoder().encode(str);
    const binaryString = Array.from(utf8Bytes, byte => String.fromCharCode(byte)).join('');
    return btoa(binaryString);
}


/**
 * Proxies a request to a given URL.
 * @param {string} proxyUrl - The base URL to proxy to.
 * @param {Request} originalRequest - The original incoming Request object.
 * @returns {Promise<Response>}
 */
async function proxyRequest(proxyUrl, originalRequest) {
    const originalUrl = new URL(originalRequest.url);
    const urls = proxyUrl.split('\n').filter(Boolean);
    const targetBaseUrl = new URL(urls[Math.floor(Math.random() * urls.length)]);

    // Construct the new target URL
    const newTargetUrl = new URL(targetBaseUrl);
    newTargetUrl.pathname = (targetBaseUrl.pathname.endsWith('/') ? targetBaseUrl.pathname.slice(0, -1) : targetBaseUrl.pathname) + originalUrl.pathname;
    newTargetUrl.search = originalUrl.search;

    // Create a new Request object.
    // The first argument is the new URL.
    // The second argument is the original Request object, which acts as the `init` object.
    // This effectively clones the method, headers, body, etc., from the original request.
    const newRequest = new Request(newTargetUrl, originalRequest);

    return fetch(newRequest);
}

/**
 * Migrates KV data from an old key format to a new one.
 * @param {string} key - The data key (e.g., 'LINK.txt').
 */
async function migrateKVData(key) {
    if (!ENV_STATE.kv) return;
    const oldKey = `/${key}`;
    const oldData = await ENV_STATE.kv.get(oldKey);
    if (oldData) {
        await ENV_STATE.kv.put(key, oldData);
        await ENV_STATE.kv.delete(oldKey);
    }
}


// ============================================================================================
// =====================================  HTML RENDERING  =====================================
// ============================================================================================

/**
 * Renders the admin page for managing subscriptions.
 * @param {Request} request
 * @param {object} adminGroup - The admin subscription group.
 * @returns {Promise<Response>}
 */
async function renderAdminPage(request, adminGroup) {
    const url = new URL(request.url);

    // Handle POST request to save KV data
    if (request.method === 'POST') {
        if (!ENV_STATE.kv) return new Response("KV namespace not bound.", { status: 400 });
        const content = await request.text();
        await ENV_STATE.kv.put('LINK.txt', content);
        return new Response("Saved successfully.", { status: 200 });
    }

    // Handle GET request to render the page
    const kvContent = ENV_STATE.kv ? (await ENV_STATE.kv.get('LINK.txt') || '') : '';
    const guestGroup = CONFIG.subscriptionGroups.find(g => g.is_guest);

    const generateLinksHTML = (group) => {
        if (!group) return '';
        const baseUrl = `https://${url.hostname}/${group.token}`;
        const formats = {
            '自适应': '', 'Base64': '?b64', 'Clash': '?clash', 
            'Sing-Box': '?sb', 'Surge': '?surge', 'Loon': '?loon'
        };
        return Object.entries(formats).map(([name, param], i) => `
            <p>
                <strong>${name}订阅:</strong><br>
                <a href="javascript:void(0)" onclick="copyAndQR('${baseUrl}${param}', 'qr_${group.id}_${i}')">${baseUrl}${param}</a>
            </p>
            <div id="qr_${group.id}_${i}" class="qrcode"></div>
        `).join('');
    };

    const adminLinksHTML = generateLinksHTML(adminGroup);
    const guestLinksHTML = generateLinksHTML(guestGroup);

    const html = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${ENV_STATE.fileName} - 订阅管理</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; margin: 0; background-color: #f8f9fa; color: #212529; }
            .container { max-width: 800px; margin: 2rem auto; padding: 2rem; background-color: #fff; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            h1, h2 { color: #343a40; border-bottom: 1px solid #dee2e6; padding-bottom: 0.5rem; }
            p { line-height: 1.6; }
            a { color: #007bff; text-decoration: none; }
            a:hover { text-decoration: underline; }
            .section { margin-bottom: 2rem; }
            .editor { width: 100%; height: 250px; padding: 10px; border: 1px solid #ced4da; border-radius: 4px; font-family: "SF Mono", "Fira Code", "Consolas", monospace; font-size: 14px; line-height: 1.5; resize: vertical; }
            .btn { display: inline-block; padding: 10px 20px; font-size: 16px; color: #fff; background-color: #007bff; border: none; border-radius: 5px; cursor: pointer; transition: background-color 0.2s; }
            .btn:hover { background-color: #0056b3; }
            .status { margin-left: 15px; color: #6c757d; }
            .qrcode { margin-top: 10px; padding: 10px; background: #fff; display: inline-block; border-radius: 4px; }
            .collapsible { background-color: #e9ecef; color: #495057; cursor: pointer; padding: 12px; width: 100%; border: none; text-align: left; outline: none; font-size: 16px; font-weight: bold; margin-top: 1rem; border-radius: 4px; }
            .collapsible:hover { background-color: #d8dde2; }
            .collapsible.active:after { content: "−"; }
            .collapsible:after { content: "+"; float: right; }
            .content { padding: 0 18px; max-height: 0; overflow: hidden; transition: max-height 0.2s ease-out; background-color: #f8f9fa; }
        </style>
        <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"></script>
    </head>
    <body>
        <div class="container">
            <h1>${ENV_STATE.fileName} - 订阅管理</h1>
            
            <div class="section">
                <h2>管理员订阅 (${adminGroup.name})</h2>
                ${adminLinksHTML}
            </div>
            
            ${guestGroup ? `
            <button type="button" class="collapsible">访客订阅 (${guestGroup.name})</button>
            <div class="content">
                <div class="section">
                    <p>访客Token: <strong>${guestGroup.token}</strong></p>
                    ${guestLinksHTML}
                </div>
            </div>
            ` : ''}

            <div class="section">
                <h2>订阅源编辑 (仅对管理员生效)</h2>
                ${ENV_STATE.kv ? `
                <textarea id="editor" class="editor" placeholder="每行一个订阅链接或节点信息...">${kvContent}</textarea>
                <button id="saveBtn" class="btn">保存</button>
                <span id="status" class="status"></span>
                ` : '<p><strong>提示:</strong> 请在 Cloudflare Worker 设置中绑定一个 KV 命名空间 (变量名为 <strong>KV</strong>) 以启用在线编辑功能。</p>'}
            </div>

            <div class="section">
                <h2>配置信息</h2>
                <p><strong>订阅转换后端:</strong> ${ENV_STATE.subConverterProtocol}://${ENV_STATE.subConverterUrl}</p>
                <p><strong>订阅转换配置:</strong> <a href="${ENV_STATE.subConverterConfig}" target="_blank">点击查看</a></p>
            </div>
            
            <footer>
                <p><small>User-Agent: ${request.headers.get('User-Agent')}</small></p>
            </footer>
        </div>

        <script>
            function copyAndQR(text, elementId) {
                navigator.clipboard.writeText(text).then(() => {
                    alert('已复制到剪贴板');
                }).catch(err => {
                    console.error('复制失败:', err);
                    alert('复制失败');
                });
                const qrDiv = document.getElementById(elementId);
                qrDiv.innerHTML = '';
                new QRCode(qrDiv, { text: text, width: 128, height: 128 });
            }

            const collapsibles = document.querySelectorAll('.collapsible');
            collapsibles.forEach(item => {
                item.addEventListener('click', function() {
                    this.classList.toggle('active');
                    const content = this.nextElementSibling;
                    if (content.style.maxHeight) {
                        content.style.maxHeight = null;
                    } else {
                        content.style.maxHeight = content.scrollHeight + 'px';
                    }
                });
            });

            const saveBtn = document.getElementById('saveBtn');
            if (saveBtn) {
                saveBtn.addEventListener('click', () => {
                    const content = document.getElementById('editor').value;
                    const statusEl = document.getElementById('status');
                    statusEl.textContent = '保存中...';
                    fetch(window.location.href, {
                        method: 'POST',
                        body: content
                    }).then(response => {
                        if (response.ok) {
                            statusEl.textContent = '保存成功 (' + new Date().toLocaleTimeString() + ')';
                        } else {
                            throw new Error('保存失败');
                        }
                    }).catch(err => {
                        statusEl.textContent = '错误: ' + err.message;
                    });
                });
            }
        </script>
    </body>
    </html>`;

    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/**
 * Renders a simple Nginx-like welcome page for unauthorized access.
 * @returns {string} - The HTML content.
 */
function renderNginxWelcomePage() {
    return `<!DOCTYPE html><html><head><title>Welcome to nginx!</title><style>body{width:35em;margin:0 auto;font-family:Tahoma,Verdana,Arial,sans-serif}</style></head><body><h1>Welcome to nginx!</h1><p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p><p><em>Thank you for using nginx.</em></p></body></html>`;
}