const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const { spawn } = require('child_process');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/*
==================================================
RATE LIMITING
==================================================
*/

const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    message: 'Too many requests, slow down'
});

app.use('/api/', apiLimiter);

/*
==================================================
MEMORY STORE
==================================================
*/

const historyStore = {};
const cachedOpportunities = [];
let lastScanTime = null;
let scanErrors = [];

/*
==================================================
HELPERS
==================================================
*/

function normalizeSymbol(symbol){
    return symbol.replace(/[-_]/g,'').toUpperCase();
}

function createId(symbol, buyExchange, sellExchange){
    return crypto
       .createHash('md5')
       .update(`${symbol}_${buyExchange}_${sellExchange}`)
       .digest('hex');
}

function saveHistory(id, spread){
    if(!historyStore[id]){
        historyStore[id] = [];
    }

    historyStore[id].push({
        time: Date.now(),
        spread: Number(spread.toFixed(2))
    });

    /*
    KEEP LAST 200 POINTS
    */
    if(historyStore[id].length > 200){
        historyStore[id].shift();
    }
}

function getSpreadColor(spread){
    if(spread >= 5) return '#10b981'; // green
    if(spread >= 2) return '#00ffae'; // mint
    if(spread >= 1) return '#3b82f6'; // blue
    if(spread >= 0.5) return '#f59e0b'; // amber
    return '#94a3b8'; // gray
}

function sendToMonitor(opportunity){
    try{
        const py = spawn('python', ['monitor.py']);
        py.stdin.write(JSON.stringify(opportunity));
        py.stdin.end();
        
        py.stderr.on('data', (data) => {
            console.error(`monitor.py error: ${data}`);
        });
    }catch(err){
        console.error('monitor.py spawn failed:', err.message);
    }
}

/*
==================================================
VERIFICATION
==================================================
*/

function getVerificationStatus(buyNetworks, sellNetworks){
    let tradable = false;
    const matchedNetworks = [];

    for(const buyNet of buyNetworks){
        for(const sellNet of sellNetworks){
            const buyName = String(buyNet.network || '').toUpperCase();
            const sellName = String(sellNet.network || '').toUpperCase();

            if(buyName === sellName){
                const isTradable = buyNet.withdrawEnable === true && sellNet.depositEnable === true;
                
                matchedNetworks.push({
                    network: buyNet.network,
                    buyDeposit: buyNet.depositEnable,
                    buyWithdraw: buyNet.withdrawEnable,
                    sellDeposit: sellNet.depositEnable,
                    sellWithdraw: sellNet.withdrawEnable,
                    color: isTradable? '#10b981' : '#ef4444'
                });

                if(isTradable){
                    tradable = true;
                }
            }
        }
    }

    return {
        tradable,
        status: tradable? 'tradable' : 'unverified',
        warning: tradable? '' : 'Check manually',
        matchedNetworks,
        color: tradable? '#10b981' : '#f59e0b'
    };
}

/*
==================================================
BINANCE
==================================================
*/

async function fetchBinancePrices(){
    try{
        const res = await axios.get(
            'https://api.binance.com/api/v3/ticker/bookTicker',
            { timeout: 15000 }
        );

        const map = {};
        res.data.forEach(item => {
            if(!item.symbol.endsWith('USDT')) return;
            map[normalizeSymbol(item.symbol)] = {
                ask: parseFloat(item.askPrice),
                bid: parseFloat(item.bidPrice)
            };
        });
        return map;
    }catch(err){
        console.error('Binance prices failed:', err.message);
        scanErrors.push({ exchange: 'Binance', type: 'prices', time: Date.now() });
        return {};
    }
}

async function fetchBinanceNetworks(){
    if(!process.env.BINANCE_KEY ||!process.env.BINANCE_SECRET){
        console.log('Binance API keys missing, skipping networks');
        return {};
    }

    try{
        const timestamp = Date.now();
        const query = `timestamp=${timestamp}`;
        const signature = crypto
           .createHmac('sha256', process.env.BINANCE_SECRET)
           .update(query)
           .digest('hex');

        const url = `https://api.binance.com/sapi/v1/capital/config/getall?${query}&signature=${signature}`;

        const res = await axios.get(url, {
            headers: { 'X-MBX-APIKEY': process.env.BINANCE_KEY },
            timeout: 15000
        });

        const networks = {};
        res.data.forEach(coin => {
            networks[coin.coin] = coin.networkList.map(net => ({
                network: net.network,
                depositEnable: net.depositEnable,
                withdrawEnable: net.withdrawEnable,
                withdrawFee: net.withdrawFee,
                withdrawMin: net.withdrawMin
            }));
        });
        return networks;
    }catch(err){
        console.error('Binance networks failed:', err.message);
        scanErrors.push({ exchange: 'Binance', type: 'networks', time: Date.now() });
        return {};
    }
}

/*
==================================================
BYBIT
==================================================
*/

async function fetchBybitPrices(){
    try{
        const res = await axios.get(
            'https://api.bybit.com/v5/market/tickers?category=spot',
            { timeout: 15000 }
        );

        const map = {};
        res.data.result.list.forEach(item => {
            if(!item.symbol.endsWith('USDT')) return;
            map[normalizeSymbol(item.symbol)] = {
                ask: parseFloat(item.ask1Price),
                bid: parseFloat(item.bid1Price)
            };
        });
        return map;
    }catch(err){
        console.error('Bybit prices failed:', err.message);
        scanErrors.push({ exchange: 'Bybit', type: 'prices', time: Date.now() });
        return {};
    }
}

async function fetchBybitNetworks(){
    try{
        const res = await axios.get(
            'https://api.bybit.com/v5/asset/coin/query-info',
            { timeout: 15000 }
        );

        const networks = {};
        if(!res.data.result ||!res.data.result.rows){
            return {};
        }

        res.data.result.rows.forEach(coin => {
            networks[coin.coin] = coin.chains.map(chain => ({
                network: chain.chain,
                depositEnable: chain.chainDeposit === '1',
                withdrawEnable: chain.chainWithdraw === '1',
                withdrawFee: chain.withdrawFee,
                withdrawMin: chain.withdrawMin
            }));
        });
        return networks;
    }catch(err){
        console.error('Bybit networks failed:', err.message);
        scanErrors.push({ exchange: 'Bybit', type: 'networks', time: Date.now() });
        return {};
    }
}

/*
==================================================
MEXC
==================================================
*/

async function fetchMexcPrices(){
    try{
        const res = await axios.get(
            'https://api.mexc.com/api/v3/ticker/bookTicker',
            { timeout: 15000 }
        );

        const map = {};
        res.data.forEach(item => {
            if(!item.symbol.endsWith('USDT')) return;
            map[normalizeSymbol(item.symbol)] = {
                ask: parseFloat(item.askPrice),
                bid: parseFloat(item.bidPrice)
            };
        });
        return map;
    }catch(err){
        console.error('MEXC prices failed:', err.message);
        scanErrors.push({ exchange: 'MEXC', type: 'prices', time: Date.now() });
        return {};
    }
}

async function fetchMexcNetworks(){
    if(!process.env.MEXC_KEY ||!process.env.MEXC_SECRET){
        console.log('MEXC API keys missing, skipping networks');
        return {};
    }

    try{
        const timestamp = Date.now();
        const query = `timestamp=${timestamp}`;
        const signature = crypto
           .createHmac('sha256', process.env.MEXC_SECRET)
           .update(query)
           .digest('hex');

        const url = `https://api.mexc.com/api/v3/capital/config/getall?${query}&signature=${signature}`;

        const res = await axios.get(url, {
            headers: { 'X-MEXC-APIKEY': process.env.MEXC_KEY },
            timeout: 15000
        });

        const networks = {};
        res.data.forEach(coin => {
            networks[coin.coin] = coin.networkList.map(net => ({
                network: net.network,
                depositEnable: net.depositEnable,
                withdrawEnable: net.withdrawEnable,
                withdrawFee: net.withdrawFee,
                withdrawMin: net.withdrawMin
            }));
        });
        return networks;
    }catch(err){
        console.error('MEXC networks failed:', err.message);
        scanErrors.push({ exchange: 'MEXC', type: 'networks', time: Date.now() });
        return {};
    }
}

/*
==================================================
LOAD MARKETS
==================================================
*/

async function loadMarkets(){
    const [
        binancePrices,
        bybitPrices,
        mexcPrices,
        binanceNetworks,
        bybitNetworks,
        mexcNetworks
    ] = await Promise.all([
        fetchBinancePrices(),
        fetchBybitPrices(),
        fetchMexcPrices(),
        fetchBinanceNetworks(),
        fetchBybitNetworks(),
        fetchMexcNetworks()
    ]);

    return {
        Binance: { prices: binancePrices, networks: binanceNetworks, color: '#F0B90B' },
        Bybit: { prices: bybitPrices, networks: bybitNetworks, color: '#F7A600' },
        MEXC: { prices: mexcPrices, networks: mexcNetworks, color: '#00D4AA' }
    };
}

/*
==================================================
SCAN ENGINE
==================================================
*/

async function scanMarkets(){
    const markets = await loadMarkets();
    const opportunities = [];
    const exchangeNames = Object.keys(markets);

    for(let i = 0; i < exchangeNames.length; i++){
        for(let j = 0; j < exchangeNames.length; j++){
            if(i === j) continue;

            const buyExchange = exchangeNames[i];
            const sellExchange = exchangeNames[j];
            const buyPrices = markets[buyExchange].prices;
            const sellPrices = markets[sellExchange].prices;

            for(const symbol in buyPrices){
                if(!sellPrices[symbol]) continue;

                const buy = buyPrices[symbol];
                const sell = sellPrices[symbol];

                if(!buy.ask ||!sell.bid || buy.ask <= 0){
                    continue;
                }

                const spread = ((sell.bid - buy.ask) / buy.ask) * 100;
                if(spread <= 0.5) continue;

                const coin = symbol.replace('USDT', '');
                const buyNetworks = markets[buyExchange].networks[coin] || [];
                const sellNetworks = markets[sellExchange].networks[coin] || [];
                const verification = getVerificationStatus(buyNetworks, sellNetworks);
                const id = createId(symbol, buyExchange, sellExchange);

                saveHistory(id, spread);

                const opportunity = {
                    id,
                    symbol,
                    coin,
                    buyExchange,
                    sellExchange,
                    buyExchangeColor: markets[buyExchange].color,
                    sellExchangeColor: markets[sellExchange].color,
                    buyPrice: Number(buy.ask.toFixed(8)),
                    sellPrice: Number(sell.bid.toFixed(8)),
                    spread: Number(spread.toFixed(2)),
                    spreadColor: getSpreadColor(spread),
                    estimatedProfit: Number(((spread / 100) * 1000).toFixed(2)),
                    tradable: verification.tradable,
                    status: verification.status,
                    warning: verification.warning,
                    statusColor: verification.color,
                    networks: {
                        buy: buyNetworks,
                        sell: sellNetworks,
                        matched: verification.matchedNetworks
                    },
                    history: historyStore[id] || [],
                    firstFound: historyStore[id]?.[0]?.time || Date.now(),
                    updatedAt: Date.now()
                };

                opportunities.push(opportunity);
                sendToMonitor(opportunity);
            }
        }
    }

    opportunities.sort((a,b) => b.spread - a.spread);
    cachedOpportunities.length = 0;
    opportunities.forEach(item => cachedOpportunities.push(item));
    lastScanTime = Date.now();

    // Clear old errors
    scanErrors = scanErrors.filter(e => Date.now() - e.time < 300000);

    return opportunities;
}

/*
==================================================
AUTO SCAN
==================================================
*/

setInterval(async ()=>{
    try{
        console.log('Running scan...');
        const start = Date.now();
        await scanMarkets();
        console.log(`Scan complete: ${cachedOpportunities.length} opps in ${Date.now() - start}ms`);
    }catch(err){
        console.error('Auto scan failed:', err.message);
    }
}, 30000);

/*
==================================================
HEALTH CHECK
==================================================
*/

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        lastScan: lastScanTime,
        cached: cachedOpportunities.length,
        errors: scanErrors.length,
        uptime: process.uptime()
    });
});

/*
==================================================
ROOT
==================================================
*/

app.get('/', (req, res) => {
    res.json({
        status: 'ArbiMine API Running',
        version: '2.0',
        totalCached: cachedOpportunities.length,
        lastScan: lastScanTime,
        endpoints: [
            '/api/opportunities?minSpread=1&tradable=true&limit=50',
            '/api/opportunity/:id',
            '/api/scan',
            '/api/stats',
            '/health'
        ]
    });
});

/*
==================================================
STATS ENDPOINT
==================================================
*/

app.get('/api/stats', (req, res) => {
    const tradable = cachedOpportunities.filter(o => o.tradable).length;
    const avgSpread = cachedOpportunities.length 
       ? cachedOpportunities.reduce((sum, o) => sum + o.spread, 0) / cachedOpportunities.length 
        : 0;

    res.json({
        success: true,
        total: cachedOpportunities.length,
        tradable,
        unverified: cachedOpportunities.length - tradable,
        avgSpread: Number(avgSpread.toFixed(2)),
        highestSpread: cachedOpportunities[0]?.spread || 0,
        lastScan: lastScanTime,
        errors: scanErrors
    });
});

/*
==================================================
ALL OPPORTUNITIES
==================================================
*/

app.get('/api/opportunities', async (req, res) => {
    try{
        const { minSpread = 0, tradable, limit = 100, offset = 0 } = req.query;

        if(cachedOpportunities.length === 0){
            await scanMarkets();
        }

        let filtered = cachedOpportunities.filter(o => o.spread >= parseFloat(minSpread));
        
        if(tradable!== undefined){
            filtered = filtered.filter(o => o.tradable === (tradable === 'true'));
        }

        const paginated = filtered.slice(
            parseInt(offset), 
            parseInt(offset) + parseInt(limit)
        );

        res.json({
            success: true,
            total: filtered.length,
            returned: paginated.length,
            opportunities: paginated
        });
    }catch(err){
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/*
==================================================
MANUAL SCAN
==================================================
*/

app.get('/api/scan', async (req, res) => {
    try{
        const opportunities = await scanMarkets();
        res.json({
            success: true,
            total: opportunities.length,
            opportunities
        });
    }catch(err){
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/*
==================================================
SINGLE OPPORTUNITY
==================================================
*/

app.get('/api/opportunity/:id', async (req, res) => {
    try{
        const id = req.params.id;
        let found = cachedOpportunities.find(item => item.id === id);

        if(!found){
            await scanMarkets();
            found = cachedOpportunities.find(item => item.id === id);
        }

        if(!found){
            return res.status(404).json({
                success: false,
                message: 'Opportunity not found'
            });
        }

        res.json({
            success: true,
            data: found
        });
    }catch(err){
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

/*
==================================================
START SERVER
==================================================
*/

app.listen(PORT, async () => {
    console.log(`ArbiMine running on ${PORT}`);
    try{
        await scanMarkets();
        console.log('Initial scan complete');
    }catch(err){
        console.error('Initial scan failed:', err.message);
    }

