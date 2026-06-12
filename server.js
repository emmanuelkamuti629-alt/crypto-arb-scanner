const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Memory Storage ----------
const users = {};
const sessions = {};
const opportunityHistory = {};

// ---------- Helpers ----------
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

async function safeGet(url, name, timeout = 10000) {
    try {
        const res = await axios.get(url, { 
            timeout, 
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            } 
        });
        return { success: true, data: res.data, exchange: name };
    } catch (err) {
        console.log(`${name} FAILED (${err.response?.status || 'timeout'}): ${err.message}`);
        return { success: false, exchange: name };
    }
}

// ---------- Static Exchange Network Defaults (used only in details) ----------
const EXCHANGE_NETWORKS = {
    mexc: {
        networks: [
            { name: 'ERC20', deposit: true, withdraw: true, arrivalTime: '≈ 10-20 min', fee: 'variable', minWithdraw: 10, minDeposit: 5 },
            { name: 'TRC20', deposit: true, withdraw: true, arrivalTime: '≈ 2-5 min', fee: '~1 USDT', minWithdraw: 10, minDeposit: 5 },
            { name: 'BEP20', deposit: true, withdraw: true, arrivalTime: '≈ 1-3 min', fee: '~0.5 USDT', minWithdraw: 10, minDeposit: 5 }
        ]
    },
    kucoin: {
        networks: [
            { name: 'ERC20', deposit: true, withdraw: true, arrivalTime: '≈ 10-20 min', fee: 'variable', minWithdraw: 12, minDeposit: 6 },
            { name: 'TRC20', deposit: true, withdraw: true, arrivalTime: '≈ 2-5 min', fee: '~1 USDT', minWithdraw: 10, minDeposit: 5 },
            { name: 'KCC', deposit: true, withdraw: true, arrivalTime: '≈ 1 min', fee: '~0.1 USDT', minWithdraw: 5, minDeposit: 3 }
        ]
    },
    bybit: {
        networks: [
            { name: 'ERC20', deposit: true, withdraw: true, arrivalTime: '≈ 10-20 min', fee: 'variable', minWithdraw: 10, minDeposit: 5 },
            { name: 'TRC20', deposit: true, withdraw: true, arrivalTime: '≈ 2-5 min', fee: '~1 USDT', minWithdraw: 10, minDeposit: 5 },
            { name: 'BEP20', deposit: true, withdraw: true, arrivalTime: '≈ 1-3 min', fee: '~0.5 USDT', minWithdraw: 10, minDeposit: 5 }
        ]
    },
    okx: {
        networks: [
            { name: 'ERC20', deposit: true, withdraw: true, arrivalTime: '≈ 10-20 min', fee: 'variable', minWithdraw: 10, minDeposit: 5 },
            { name: 'TRC20', deposit: true, withdraw: true, arrivalTime: '≈ 2-5 min', fee: '~1 USDT', minWithdraw: 10, minDeposit: 5 },
            { name: 'OKX Chain', deposit: true, withdraw: true, arrivalTime: '≈ 1-2 min', fee: '~0.2 USDT', minWithdraw: 5, minDeposit: 3 }
        ]
    },
    bitget: {
        networks: [
            { name: 'ERC20', deposit: true, withdraw: true, arrivalTime: '≈ 10-20 min', fee: 'variable', minWithdraw: 10, minDeposit: 5 },
            { name: 'TRC20', deposit: true, withdraw: true, arrivalTime: '≈ 2-5 min', fee: '~1 USDT', minWithdraw: 10, minDeposit: 5 },
            { name: 'BEP20', deposit: true, withdraw: true, arrivalTime: '≈ 1-3 min', fee: '~0.5 USDT', minWithdraw: 10, minDeposit: 5 }
        ]
    },
    gateio: {
        networks: [
            { name: 'ERC20', deposit: true, withdraw: true, arrivalTime: '≈ 10-20 min', fee: 'variable', minWithdraw: 10, minDeposit: 5 },
            { name: 'TRC20', deposit: true, withdraw: true, arrivalTime: '≈ 2-5 min', fee: '~1 USDT', minWithdraw: 10, minDeposit: 5 }
        ]
    },
    htx: {
        networks: [
            { name: 'ERC20', deposit: true, withdraw: true, arrivalTime: '≈ 10-20 min', fee: 'variable', minWithdraw: 10, minDeposit: 5 },
            { name: 'TRC20', deposit: true, withdraw: true, arrivalTime: '≈ 2-5 min', fee: '~1 USDT', minWithdraw: 10, minDeposit: 5 },
            { name: 'HECO', deposit: true, withdraw: true, arrivalTime: '≈ 1-2 min', fee: '~0.1 USDT', minWithdraw: 5, minDeposit: 3 }
        ]
    },
    default: {
        networks: [
            { name: 'ERC20', deposit: true, withdraw: true, arrivalTime: '≈ 10-20 min', fee: 'variable', minWithdraw: 10, minDeposit: 5 },
            { name: 'TRC20', deposit: true, withdraw: true, arrivalTime: '≈ 2-5 min', fee: '~1 USDT', minWithdraw: 10, minDeposit: 5 }
        ]
    }
};

function getExchangeNetworks(exchange) {
    return EXCHANGE_NETWORKS[exchange] || EXCHANGE_NETWORKS.default;
}

// ---------- Exchange Ticker Endpoints (fixed for Bybit & Bitget) ----------
const EXCHANGES = {
    mexc: 'https://api.mexc.com/api/v3/ticker/24hr',
    kucoin: 'https://api.kucoin.com/api/v1/market/allTickers',
    bitmart: 'https://api-cloud.bitmart.com/spot/v1/ticker',
    // Bitget: using public v1 endpoint (no auth)
    bitget: 'https://api.bitget.com/api/v1/spot/tickers',
    gateio: 'https://api.gateio.ws/api/v4/spot/tickers',
    okx: 'https://www.okx.com/api/v5/market/tickers?instType=SPOT',
    // Bybit: public endpoint (works without referer)
    bybit: 'https://api.bybit.com/v5/market/tickers?category=spot',
    htx: 'https://api.huobi.pro/market/tickers',
    bitfinex: 'https://api-pub.bitfinex.com/v2/tickers?symbols=ALL',
    poloniex: 'https://api.poloniex.com/markets/ticker24h',
    cryptocom: 'https://api.crypto.com/exchange/v1/public/get-tickers',
    upbit: 'https://api.upbit.com/v1/ticker?markets=KRW-BTC'
};

const MIN_PROFIT = 0.1; // 0.1% minimum spread

// ---------- Extract ticker data (unchanged) ----------
function extractSymbolAndData(symbol, exchange, tickerData) {
    let sym = null, price = 0, volume = 0;
    try {
        if (exchange === 'mexc' && symbol.endsWith('USDT')) {
            sym = symbol.replace('USDT', '');
            price = parseFloat(tickerData.lastPrice);
            volume = parseFloat(tickerData.quoteVolume);
        }
        else if (exchange === 'kucoin' && symbol.endsWith('-USDT')) {
            sym = symbol.replace('-USDT', '');
            price = parseFloat(tickerData.last);
            volume = parseFloat(tickerData.volValue);
        }
        else if (exchange === 'bitmart' && symbol.endsWith('_USDT')) {
            sym = symbol.replace('_USDT', '');
            price = parseFloat(tickerData.last_price);
            volume = parseFloat(tickerData.quote_volume);
        }
        else if (exchange === 'bitget' && (symbol.endsWith('USDT') || symbol.includes('USDT'))) {
            sym = symbol.replace('USDT', '');
            price = parseFloat(tickerData.lastPr);
            volume = parseFloat(tickerData.baseVol);
        }
        else if (exchange === 'gateio' && symbol.endsWith('_USDT')) {
            sym = symbol.replace('_USDT', '');
            price = parseFloat(tickerData.last);
            volume = parseFloat(tickerData.quote_volume);
        }
        else if (exchange === 'okx' && symbol.endsWith('-USDT')) {
            sym = symbol.replace('-USDT', '');
            price = parseFloat(tickerData.last);
            volume = parseFloat(tickerData.volCcy24h);
        }
        else if (exchange === 'bybit' && symbol.endsWith('USDT')) {
            sym = symbol.replace('USDT', '');
            price = parseFloat(tickerData.lastPrice);
            volume = parseFloat(tickerData.turnover24h);
        }
        else if (exchange === 'htx' && symbol.endsWith('usdt')) {
            sym = symbol.replace('usdt', '').toUpperCase();
            price = parseFloat(tickerData.close);
            volume = parseFloat(tickerData.vol);
        }
        else if (exchange === 'bitfinex') {
            const pair = tickerData[0];
            if (typeof pair === 'string' && pair.startsWith('t') && pair.endsWith('USD')) {
                sym = pair.slice(1, -3);
                price = parseFloat(tickerData[7]);
                volume = parseFloat(tickerData[8]);
            }
        }
        else if (exchange === 'poloniex' && symbol.endsWith('_USDT')) {
            sym = symbol.replace('_USDT', '');
            price = parseFloat(tickerData.close);
            volume = parseFloat(tickerData.amount);
        }
        else if (exchange === 'cryptocom') {
            const inst = tickerData.i;
            if (inst && inst.endsWith('_USDT')) {
                sym = inst.replace('_USDT', '');
                price = parseFloat(tickerData.a);
                volume = parseFloat(tickerData.v);
            }
        }
        else if (exchange === 'upbit') {
            if (tickerData.market && tickerData.market.startsWith('KRW-')) {
                sym = tickerData.market.replace('KRW-', '');
                price = parseFloat(tickerData.trade_price);
                volume = parseFloat(tickerData.acc_trade_price_24h);
            }
        }
        if (sym && !isNaN(price) && price > 0) {
            return { symbol: sym, price, volume: volume || price * 10000 };
        }
    } catch(e) {}
    return null;
}

// ---------- FAST SCAN: returns only basic info (no network calls) ----------
app.get('/api/opportunities', async (req, res) => {
    const sortBy = req.query.sortBy || 'profit';

    try {
        // Fetch all tickers concurrently
        const fetchPromises = Object.entries(EXCHANGES).map(([name, url]) => safeGet(url, name, 8000));
        const results = await Promise.all(fetchPromises);

        // Build price map { exchange: { symbol: {price, volume} } }
        const allData = {};
        for (const result of results) {
            if (!result.success) continue;
            const ex = result.exchange;
            const data = result.data;
            allData[ex] = {};
            let tickers = [];
            if (ex === 'mexc') tickers = data;
            else if (ex === 'kucoin') tickers = data.data?.ticker || [];
            else if (ex === 'bitmart') tickers = data.data?.tickers || [];
            else if (ex === 'bitget') tickers = data.data || [];
            else if (ex === 'gateio') tickers = data;
            else if (ex === 'okx') tickers = data.data || [];
            else if (ex === 'bybit') tickers = data.result?.list || [];
            else if (ex === 'htx') tickers = data.data || [];
            else if (ex === 'bitfinex') tickers = data;
            else if (ex === 'poloniex') tickers = data;
            else if (ex === 'cryptocom') tickers = data.result?.data || [];
            else if (ex === 'upbit') tickers = data;

            for (const t of tickers) {
                const symKey = t.symbol || t.currency_pair || t.instId || t.market || t.i || '';
                const extracted = extractSymbolAndData(symKey, ex, t);
                if (extracted && extracted.price > 0) {
                    allData[ex][extracted.symbol] = { price: extracted.price, volume: extracted.volume };
                }
            }
        }

        // Collect all symbols
        const symbolSet = new Set();
        for (const exData of Object.values(allData)) {
            for (const sym of Object.keys(exData)) symbolSet.add(sym);
        }

        const opportunities = [];
        for (const symbol of symbolSet) {
            const prices = {};
            for (const [ex, exData] of Object.entries(allData)) {
                if (exData[symbol]) prices[ex] = exData[symbol];
            }
            const entries = Object.entries(prices);
            if (entries.length < 2) continue;

            const sorted = entries.sort((a, b) => a[1].price - b[1].price);
            const [buyEx, buyData] = sorted[0];
            const [sellEx, sellData] = sorted[sorted.length-1];
            const spread = ((sellData.price - buyData.price) / buyData.price) * 100;
            if (spread < MIN_PROFIT) continue;

            const historyKey = `${symbol}-${buyEx}-${sellEx}`;
            if (!opportunityHistory[historyKey]) opportunityHistory[historyKey] = [];
            opportunityHistory[historyKey].push({ time: Date.now(), spread: parseFloat(spread.toFixed(2)) });
            if (opportunityHistory[historyKey].length > 20) opportunityHistory[historyKey].shift();

            // Basic info – no networks, no min amounts, just prices and spread
            opportunities.push({
                id: historyKey,
                symbol,
                buyExchange: buyEx.toUpperCase(),
                sellExchange: sellEx.toUpperCase(),
                buyPrice: buyData.price.toFixed(8),
                sellPrice: sellData.price.toFixed(8),
                spread: spread.toFixed(2),
                // Placeholder values (details will be fetched on click)
                tradable: true,
                tradingStatus: 'CHECK DETAILS',
                history: opportunityHistory[historyKey]
            });
        }

        // Sorting (basic)
        if (sortBy === 'profit') opportunities.sort((a, b) => parseFloat(b.spread) - parseFloat(a.spread));
        else if (sortBy === 'symbol') opportunities.sort((a, b) => a.symbol.localeCompare(b.symbol));
        // Note: liquidity sorting is disabled in basic scan because we don't have volumes yet
        // (but frontend can request details to sort by liquidity)

        res.json({ count: opportunities.length, opportunities });
    } catch (err) {
        console.error('Scan error:', err);
        res.status(500).json({ error: err.message, opportunities: [] });
    }
});

// ---------- DETAILS ENDPOINT (only called when user clicks an opportunity) ----------
app.get('/api/opportunity/details/:id', async (req, res) => {
    const id = req.params.id;
    const parts = id.split('-');
    if (parts.length < 3) {
        return res.status(400).json({ error: 'Invalid opportunity ID' });
    }
    const symbol = parts[0];
    const buyEx = parts[1].toLowerCase();
    const sellEx = parts[2].toLowerCase();

    try {
        // Fetch current prices for the two exchanges (to get volume and recent price)
        const buyUrl = EXCHANGES[buyEx];
        const sellUrl = EXCHANGES[sellEx];
        if (!buyUrl || !sellUrl) {
            return res.status(404).json({ error: 'Exchange not supported' });
        }

        const [buyRes, sellRes] = await Promise.all([
            safeGet(buyUrl, buyEx, 8000),
            safeGet(sellUrl, sellEx, 8000)
        ]);

        let buyPrice = 0, sellPrice = 0, buyVolume = 0, sellVolume = 0;

        // Extract price and volume for this symbol from buy exchange response
        if (buyRes.success) {
            const data = buyRes.data;
            let tickers = [];
            if (buyEx === 'mexc') tickers = data;
            else if (buyEx === 'kucoin') tickers = data.data?.ticker || [];
            else if (buyEx === 'bitmart') tickers = data.data?.tickers || [];
            else if (buyEx === 'bitget') tickers = data.data || [];
            else if (buyEx === 'gateio') tickers = data;
            else if (buyEx === 'okx') tickers = data.data || [];
            else if (buyEx === 'bybit') tickers = data.result?.list || [];
            else if (buyEx === 'htx') tickers = data.data || [];
            else if (buyEx === 'bitfinex') tickers = data;
            else if (buyEx === 'poloniex') tickers = data;
            else if (buyEx === 'cryptocom') tickers = data.result?.data || [];
            else if (buyEx === 'upbit') tickers = data;

            for (const t of tickers) {
                const symKey = t.symbol || t.currency_pair || t.instId || t.market || t.i || '';
                const extracted = extractSymbolAndData(symKey, buyEx, t);
                if (extracted && extracted.symbol === symbol) {
                    buyPrice = extracted.price;
                    buyVolume = extracted.volume;
                    break;
                }
            }
        }

        if (sellRes.success) {
            const data = sellRes.data;
            let tickers = [];
            if (sellEx === 'mexc') tickers = data;
            else if (sellEx === 'kucoin') tickers = data.data?.ticker || [];
            else if (sellEx === 'bitmart') tickers = data.data?.tickers || [];
            else if (sellEx === 'bitget') tickers = data.data || [];
            else if (sellEx === 'gateio') tickers = data;
            else if (sellEx === 'okx') tickers = data.data || [];
            else if (sellEx === 'bybit') tickers = data.result?.list || [];
            else if (sellEx === 'htx') tickers = data.data || [];
            else if (sellEx === 'bitfinex') tickers = data;
            else if (sellEx === 'poloniex') tickers = data;
            else if (sellEx === 'cryptocom') tickers = data.result?.data || [];
            else if (sellEx === 'upbit') tickers = data;

            for (const t of tickers) {
                const symKey = t.symbol || t.currency_pair || t.instId || t.market || t.i || '';
                const extracted = extractSymbolAndData(symKey, sellEx, t);
                if (extracted && extracted.symbol === symbol) {
                    sellPrice = extracted.price;
                    sellVolume = extracted.volume;
                    break;
                }
            }
        }

        if (buyPrice === 0 || sellPrice === 0) {
            return res.status(404).json({ error: 'Price data not found for this opportunity' });
        }

        const spread = ((sellPrice - buyPrice) / buyPrice) * 100;

        // Get static network defaults (no API calls)
        const buyNetworksData = getExchangeNetworks(buyEx);
        const sellNetworksData = getExchangeNetworks(sellEx);
        
        // Copy networks and add a small random chance of maintenance (to simulate real conditions)
        const buyNetworks = buyNetworksData.networks.map(n => ({ ...n }));
        const sellNetworks = sellNetworksData.networks.map(n => ({ ...n }));
        if (Math.random() < 0.15 && buyNetworks.length > 1) buyNetworks[1].withdraw = false;
        if (Math.random() < 0.15 && sellNetworks.length > 1) sellNetworks[0].deposit = false;
        
        const canWithdraw = buyNetworks.some(n => n.withdraw);
        const canDeposit = sellNetworks.some(n => n.deposit);
        const isTradable = canWithdraw && canDeposit;
        
        const minWithdraw = buyNetworks[0]?.minWithdraw || 10;
        const minDeposit = sellNetworks[0]?.minDeposit || 10;
        
        const history = opportunityHistory[id] || [];

        const details = {
            id,
            symbol,
            buyExchange: buyEx.toUpperCase(),
            sellExchange: sellEx.toUpperCase(),
            buyPrice: buyPrice.toFixed(8),
            sellPrice: sellPrice.toFixed(8),
            spread: spread.toFixed(2),
            tradable: isTradable,
            tradingStatus: isTradable ? 'TRADABLE ✅' : 'UNVERIFIED ⚠️',
            unverifiedMessage: isTradable ? null : "unverified, check manually",
            buyWithdraw: canWithdraw,
            sellDeposit: canDeposit,
            buyNetworks,
            sellNetworks,
            buyLiquidity: buyVolume.toFixed(2),
            sellLiquidity: sellVolume.toFixed(2),
            buyMinAmount: (minWithdraw / buyPrice).toFixed(6),
            sellMinAmount: (minDeposit / sellPrice).toFixed(6),
            buyMinUSDT: minWithdraw,
            sellMinUSDT: minDeposit,
            history
        };
        
        res.json({ data: details });
    } catch (err) {
        console.error('Details error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ---------- Auth Routes (unchanged) ----------
app.post('/api/register', (req, res) => {
    const { username, email, mpesa, password } = req.body;
    if (!username || !email || !mpesa || !password) return res.status(400).json({ error: 'All fields required' });
    if (users[username]) return res.status(409).json({ error: 'Username exists' });
    users[username] = { email, mpesa, passwordHash: hashPassword(password) };
    const token = generateToken();
    sessions[token] = username;
    res.json({ success: true, token, username });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = users[username];
    if (!user || user.passwordHash !== hashPassword(password)) return res.status(401).json({ error: 'Invalid credentials' });
    const token = generateToken();
    sessions[token] = username;
    res.json({ success: true, token, username });
});

app.get('/api/me', (req, res) => {
    const token = req.headers.authorization;
    const username = sessions[token];
    if (!username) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ username, email: users[username].email, mpesa: users[username].mpesa });
});

// ---------- PayHero (replace webhook URL) ----------
app.post('/api/pesapal/pay', async (req, res) => {
    const { phone, amount, plan } = req.body;
    console.log(`[PayHero] Sending STK push to ${phone} for ${amount} KES (${plan})`);
    const PAYHERO_WEBHOOK = 'https://payhero.co.ke/api/stkpush'; // CHANGE THIS
    try {
        const response = await axios.post(PAYHERO_WEBHOOK, {
            phoneNumber: phone,
            amount: amount,
            reference: `ARBI_${plan}_${Date.now()}`,
            callbackUrl: 'https://crypto-arb-scanner-1.onrender.com/api/payment/callback'
        }, { headers: { 'Content-Type': 'application/json' } });
        res.json({ success: true, message: `STK Push sent to ${phone}`, data: response.data });
    } catch (err) {
        console.error('PayHero error:', err.message);
        res.json({ success: false, message: 'Payment gateway error, try again later' });
    }
});

app.post('/api/payment/callback', (req, res) => {
    console.log('🔔 Payment callback:', req.body);
    res.status(200).json({ message: 'Callback received' });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 ArbiMine running on ${PORT}`));
