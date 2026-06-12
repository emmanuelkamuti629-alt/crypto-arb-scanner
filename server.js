const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
const { spawn } = require('child_process');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/*
====================================================
MEMORY STORE
====================================================
*/

const historyStore = {};
const cachedOpportunities = [];

/*
====================================================
HELPERS
====================================================
*/

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function createId(symbol, buyExchange, sellExchange) {

    return crypto
        .createHash('md5')
        .update(`${symbol}_${buyExchange}_${sellExchange}`)
        .digest('hex');
}

function saveHistory(id, spread) {

    if (!historyStore[id]) {
        historyStore[id] = [];
    }

    historyStore[id].push({
        time: Date.now(),
        spread: Number(spread.toFixed(2))
    });

    // Keep last 200 points
    if (historyStore[id].length > 200) {
        historyStore[id].shift();
    }
}

function normalizeSymbol(symbol) {

    return symbol
        .replace('-', '')
        .replace('_', '')
        .toUpperCase();
}

function getVerificationStatus(
    buyNetworks,
    sellNetworks
) {

    let tradable = false;

    const matchedNetworks = [];

    for (const buyNet of buyNetworks) {

        for (const sellNet of sellNetworks) {

            if (
                buyNet.network.toUpperCase() ===
                sellNet.network.toUpperCase()
            ) {

                matchedNetworks.push({
                    network: buyNet.network,

                    buyWithdraw:
                        buyNet.withdrawEnable,

                    buyDeposit:
                        buyNet.depositEnable,

                    sellWithdraw:
                        sellNet.withdrawEnable,

                    sellDeposit:
                        sellNet.depositEnable
                });

                if (
                    buyNet.withdrawEnable === true &&
                    sellNet.depositEnable === true
                ) {
                    tradable = true;
                }
            }
        }
    }

    return {
        verified: tradable,
        label: tradable
            ? 'tradable'
            : 'unverified',

        color: tradable
            ? 'green'
            : 'orange',

        message: tradable
            ? 'Ready for arbitrage'
            : 'Check manually',

        matchedNetworks
    };
}

/*
====================================================
BINANCE
====================================================
*/

async function fetchBinancePrices() {

    try {

        const res = await axios.get(
            'https://api.binance.com/api/v3/ticker/bookTicker',
            {
                timeout: 15000
            }
        );

        const map = {};

        res.data.forEach(item => {

            if (!item.symbol.endsWith('USDT')) return;

            map[normalizeSymbol(item.symbol)] = {

                symbol: normalizeSymbol(item.symbol),

                ask: parseFloat(item.askPrice),

                bid: parseFloat(item.bidPrice)
            };
        });

        return map;

    } catch (err) {

        console.log('Binance prices failed');

        return {};
    }
}

async function fetchBinanceNetworks() {

    try {

        const timestamp = Date.now();

        const queryString = `timestamp=${timestamp}`;

        const signature = crypto
            .createHmac(
                'sha256',
                process.env.BINANCE_SECRET
            )
            .update(queryString)
            .digest('hex');

        const url =
            `https://api.binance.com/sapi/v1/capital/config/getall?${queryString}&signature=${signature}`;

        const res = await axios.get(url, {
            headers: {
                'X-MBX-APIKEY':
                    process.env.BINANCE_KEY
            },
            timeout: 15000
        });

        const networks = {};

        res.data.forEach(coin => {

            networks[coin.coin] =
                coin.networkList.map(net => ({

                    network: net.network,

                    withdrawEnable:
                        net.withdrawEnable,

                    depositEnable:
                        net.depositEnable,

                    withdrawFee:
                        net.withdrawFee,

                    withdrawMin:
                        net.withdrawMin
                }));
        });

        return networks;

    } catch (err) {

        console.log(
            'Binance networks unavailable'
        );

        return {};
    }
}

/*
====================================================
BYBIT
====================================================
*/

async function fetchBybitPrices() {

    try {

        const res = await axios.get(
            'https://api.bybit.com/v5/market/tickers?category=spot',
            {
                timeout: 15000
            }
        );

        const map = {};

        res.data.result.list.forEach(item => {

            if (!item.symbol.endsWith('USDT')) return;

            map[normalizeSymbol(item.symbol)] = {

                symbol: normalizeSymbol(item.symbol),

                ask: parseFloat(item.ask1Price),

                bid: parseFloat(item.bid1Price)
            };
        });

        return map;

    } catch (err) {

        console.log('Bybit prices failed');

        return {};
    }
}

async function fetchBybitNetworks() {

    try {

        const res = await axios.get(
            'https://api.bybit.com/v5/asset/coin/query-info',
            {
                timeout: 15000
            }
        );

        const networks = {};

        if (
            !res.data.result ||
            !res.data.result.rows
        ) {
            return {};
        }

        res.data.result.rows.forEach(coin => {

            networks[coin.coin] =
                coin.chains.map(chain => ({

                    network:
                        chain.chain,

                    withdrawEnable:
                        chain.chainWithdraw === '1',

                    depositEnable:
                        chain.chainDeposit === '1',

                    withdrawFee:
                        chain.withdrawFee,

                    withdrawMin:
                        chain.withdrawMin
                }));
        });

        return networks;

    } catch (err) {

        console.log('Bybit networks unavailable');

        return {};
    }
}

/*
====================================================
MEXC
====================================================
*/

async function fetchMexcPrices() {

    try {

        const res = await axios.get(
            'https://api.mexc.com/api/v3/ticker/bookTicker',
            {
                timeout: 15000
            }
        );

        const map = {};

        res.data.forEach(item => {

            if (!item.symbol.endsWith('USDT')) return;

            map[normalizeSymbol(item.symbol)] = {

                symbol: normalizeSymbol(item.symbol),

                ask: parseFloat(item.askPrice),

                bid: parseFloat(item.bidPrice)
            };
        });

        return map;

    } catch (err) {

        console.log('MEXC prices failed');

        return {};
    }
}

async function fetchMexcNetworks() {

    try {

        const timestamp = Date.now();

        const queryString =
            `timestamp=${timestamp}`;

        const signature = crypto
            .createHmac(
                'sha256',
                process.env.MEXC_SECRET
            )
            .update(queryString)
            .digest('hex');

        const url =
            `https://api.mexc.com/api/v3/capital/config/getall?${queryString}&signature=${signature}`;

        const res = await axios.get(url, {
            headers: {
                'X-MEXC-APIKEY':
                    process.env.MEXC_KEY
            },
            timeout: 15000
        });

        const networks = {};

        res.data.forEach(coin => {

            networks[coin.coin] =
                coin.networkList.map(net => ({

                    network:
                        net.network,

                    withdrawEnable:
                        net.withdrawEnable,

                    depositEnable:
                        net.depositEnable,

                    withdrawFee:
                        net.withdrawFee,

                    withdrawMin:
                        net.withdrawMin
                }));
        });

        return networks;

    } catch (err) {

        console.log('MEXC networks unavailable');

        return {};
    }
}

/*
====================================================
LOAD ALL MARKETS
====================================================
*/

async function loadAllMarkets() {

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

        Binance: {
            prices: binancePrices,
            networks: binanceNetworks
        },

        Bybit: {
            prices: bybitPrices,
            networks: bybitNetworks
        },

        MEXC: {
            prices: mexcPrices,
            networks: mexcNetworks
        }
    };
}

/*
====================================================
MONITOR PY SENDER
====================================================
*/

function sendToMonitor(opportunity) {

    try {

        const py = spawn('python', ['monitor.py']);

        py.stdin.write(
            JSON.stringify(opportunity)
        );

        py.stdin.end();

    } catch (err) {

        console.log(
            'monitor.py send failed'
        );
    }
}

/*
====================================================
SCAN ENGINE
====================================================
*/

async function scanMarkets() {

    const markets = await loadAllMarkets();

    const opportunities = [];

    const exchanges = Object.keys(markets);

    for (let i = 0; i < exchanges.length; i++) {

        for (let j = 0; j < exchanges.length; j++) {

            if (i === j) continue;

            const buyExchange = exchanges[i];
            const sellExchange = exchanges[j];

            const buyPrices =
                markets[buyExchange].prices;

            const sellPrices =
                markets[sellExchange].prices;

            for (const symbol in buyPrices) {

                if (!sellPrices[symbol]) continue;

                const buy =
                    buyPrices[symbol];

                const sell =
                    sellPrices[symbol];

                if (
                    !buy.ask ||
                    !sell.bid ||
                    buy.ask <= 0
                ) {
                    continue;
                }

                const spread =
                    (
                        (
                            sell.bid -
                            buy.ask
                        ) / buy.ask
                    ) * 100;

                if (spread <= 0.5) continue;

                const coin =
                    symbol.replace('USDT', '');

                const buyNetworks =
                    markets[
                        buyExchange
                    ].networks[coin] || [];

                const sellNetworks =
                    markets[
                        sellExchange
                    ].networks[coin] || [];

                const verification =
                    getVerificationStatus(
                        buyNetworks,
                        sellNetworks
                    );

                const id = createId(
                    symbol,
                    buyExchange,
                    sellExchange
                );

                saveHistory(id, spread);

                const opportunity = {

                    id,

                    symbol,

                    coin,

                    buyExchange,

                    sellExchange,

                    buyPrice:
                        Number(
                            buy.ask.toFixed(8)
                        ),

                    sellPrice:
                        Number(
                            sell.bid.toFixed(8)
                        ),

                    spread:
                        Number(
                            spread.toFixed(2)
                        ),

                    estimatedProfit:
                        Number(
                            (
                                (spread / 100) *
                                1000
                            ).toFixed(2)
                        ),

                    status:
                        verification.label,

                    statusColor:
                        verification.color,

                    verified:
                        verification.verified,

                    warning:
                        verification.message,

                    tradable:
                        verification.verified,

                    networks: {

                        buy:
                            buyNetworks,

                        sell:
                            sellNetworks,

                        matched:
                            verification.matchedNetworks
                    },

                    history:
                        historyStore[id] || [],

                    firstFound:
                        historyStore[id]?.[0]
                            ?.time || Date.now(),

                    updatedAt:
                        Date.now()
                };

                opportunities.push(
                    opportunity
                );

                sendToMonitor(opportunity);
            }
        }
    }

    opportunities.sort(
        (a, b) => b.spread - a.spread
    );

    cachedOpportunities.length = 0;

    opportunities.forEach(item => {
        cachedOpportunities.push(item);
    });

    return opportunities;
}

/*
====================================================
AUTO SCANNER
====================================================
*/

setInterval(async () => {

    try {

        console.log('Running scan...');

        await scanMarkets();

        console.log(
            'Scan complete:',
            cachedOpportunities.length
        );

    } catch (err) {

        console.log(
            'Auto scan failed'
        );
    }

}, 30000);

/*
====================================================
ROOT
====================================================
*/

app.get('/', (req, res) => {

    res.json({

        status: 'ArbiMine API Running',

        totalCached:
            cachedOpportunities.length,

        endpoints: [

            '/api/scan',

            '/api/opportunities',

            '/api/opportunity/:id'
        ]
    });
});

/*
====================================================
GET ALL OPPORTUNITIES
====================================================
*/

app.get(
    '/api/opportunities',
    async (req, res) => {

        try {

            if (
                cachedOpportunities.length === 0
            ) {

                await scanMarkets();
            }

            res.json({

                success: true,

                total:
                    cachedOpportunities.length,

                opportunities:
                    cachedOpportunities
            });

        } catch (err) {

            res.status(500).json({

                success: false,

                error: err.message
            });
        }
    }
);

/*
====================================================
MANUAL SCAN
====================================================
*/

app.get('/api/scan', async (req, res) => {

    try {

        const opportunities =
            await scanMarkets();

        res.json({

            success: true,

            total:
                opportunities.length,

            opportunities
        });

    } catch (err) {

        res.status(500).json({

            success: false,

            error: err.message
        });
    }
});

/*
====================================================
SINGLE OPPORTUNITY
====================================================
*/

app.get(
    '/api/opportunity/:id',
    async (req, res) => {

        try {

            const id =
                req.params.id;

            let found =
                cachedOpportunities.find(
                    item => item.id === id
                );

            if (!found) {

                await scanMarkets();

                found =
                    cachedOpportunities.find(
                        item =>
                            item.id === id
                    );
            }

            if (!found) {

                return res
                    .status(404)
                    .json({

                        success: false,

                        message:
                            'Opportunity not found'
                    });
            }

            res.json({

                success: true,

                data: found
            });

        } catch (err) {

            res.status(500).json({

                success: false,

                error: err.message
            });
        }
    }
);

/*
====================================================
SERVER START
====================================================
*/

app.listen(PORT, async () => {

    console.log(
        `ArbiMine server running on ${PORT}`
    );

    try {

        await scanMarkets();

        console.log(
            'Initial scan completed'
        );

    } catch (err) {

        console.log(
            'Initial scan failed'
        );
    }
});
