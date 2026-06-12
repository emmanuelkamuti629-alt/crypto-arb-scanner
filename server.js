const express = require('express');
const axios = require('axios');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

/*
==================================================
MEMORY
==================================================
*/

let cachedOpportunities = [];
let historyStore = {};

/*
==================================================
HELPERS
==================================================
*/

function makeId(
    symbol,
    buyExchange,
    sellExchange
){

    return crypto
        .createHash('md5')
        .update(
            `${symbol}_${buyExchange}_${sellExchange}`
        )
        .digest('hex');
}

function saveHistory(id, spread){

    if(!historyStore[id]){
        historyStore[id] = [];
    }

    historyStore[id].push({

        time:Date.now(),

        spread:Number(
            spread.toFixed(2)
        )
    });

    if(
        historyStore[id].length > 50
    ){
        historyStore[id].shift();
    }
}

function normalizeSymbol(symbol){

    return symbol
        .replace(/[-_]/g,'')
        .toUpperCase();
}

/*
==================================================
BINANCE
==================================================
*/

async function getBinance(){

    try{

        const res =
            await axios.get(
                'https://api.binance.com/api/v3/ticker/bookTicker'
            );

        const map = {};

        res.data.forEach(item=>{

            if(
                !item.symbol.endsWith('USDT')
            ) return;

            map[item.symbol] = {

                ask:parseFloat(
                    item.askPrice
                ),

                bid:parseFloat(
                    item.bidPrice
                )
            };
        });

        return map;

    }catch(err){

        console.log(
            'Binance error'
        );

        return {};
    }
}

/*
==================================================
BYBIT
==================================================
*/

async function getBybit(){

    try{

        const res =
            await axios.get(
                'https://api.bybit.com/v5/market/tickers?category=spot'
            );

        const map = {};

        res.data.result.list.forEach(item=>{

            if(
                !item.symbol.endsWith('USDT')
            ) return;

            map[item.symbol] = {

                ask:parseFloat(
                    item.ask1Price
                ),

                bid:parseFloat(
                    item.bid1Price
                )
            };
        });

        return map;

    }catch(err){

        console.log(
            'Bybit error'
        );

        return {};
    }
}

/*
==================================================
MEXC
==================================================
*/

async function getMexc(){

    try{

        const res =
            await axios.get(
                'https://api.mexc.com/api/v3/ticker/bookTicker'
            );

        const map = {};

        res.data.forEach(item=>{

            if(
                !item.symbol.endsWith('USDT')
            ) return;

            map[item.symbol] = {

                ask:parseFloat(
                    item.askPrice
                ),

                bid:parseFloat(
                    item.bidPrice
                )
            };
        });

        return map;

    }catch(err){

        console.log(
            'MEXC error'
        );

        return {};
    }
}

/*
==================================================
NETWORK MOCK
==================================================
*/

function randomNetworks(){

    return [

        {
            network:'ERC20',
            depositEnable:
                Math.random() > 0.2,

            withdrawEnable:
                Math.random() > 0.2,

            withdrawFee:'5'
        },

        {
            network:'TRC20',
            depositEnable:
                Math.random() > 0.2,

            withdrawEnable:
                Math.random() > 0.2,

            withdrawFee:'1'
        }
    ];
}

/*
==================================================
SCAN
==================================================
*/

async function scanMarkets(){

    const [

        binance,
        bybit,
        mexc

    ] = await Promise.all([

        getBinance(),
        getBybit(),
        getMexc()
    ]);

    const exchanges = {

        Binance:binance,
        Bybit:bybit,
        MEXC:mexc
    };

    const results = [];

    const names =
        Object.keys(exchanges);

    for(
        let i = 0;
        i < names.length;
        i++
    ){

        for(
            let j = 0;
            j < names.length;
            j++
        ){

            if(i === j) continue;

            const buyExchange =
                names[i];

            const sellExchange =
                names[j];

            const buyData =
                exchanges[
                    buyExchange
                ];

            const sellData =
                exchanges[
                    sellExchange
                ];

            for(const symbol in buyData){

                if(
                    !sellData[symbol]
                ) continue;

                const buyPrice =
                    buyData[symbol].ask;

                const sellPrice =
                    sellData[symbol].bid;

                if(
                    !buyPrice ||
                    !sellPrice
                ) continue;

                const spread =
                    (
                        (
                            sellPrice -
                            buyPrice
                        ) / buyPrice
                    ) * 100;

                if(spread <= 0.5){
                    continue;
                }

                const buyNetworks =
                    randomNetworks();

                const sellNetworks =
                    randomNetworks();

                let tradable = false;

                buyNetworks.forEach(buyNet=>{

                    sellNetworks.forEach(
                        sellNet=>{

                        if(
                            buyNet.network ===
                            sellNet.network
                        ){

                            if(
                                buyNet.withdrawEnable &&
                                sellNet.depositEnable
                            ){

                                tradable = true;
                            }
                        }
                    });
                });

                const id =
                    makeId(
                        symbol,
                        buyExchange,
                        sellExchange
                    );

                saveHistory(
                    id,
                    spread
                );

                results.push({

                    id,

                    symbol,

                    coin:
                        symbol.replace(
                            'USDT',
                            ''
                        ),

                    buyExchange,

                    sellExchange,

                    buyPrice:
                        Number(
                            buyPrice.toFixed(8)
                        ),

                    sellPrice:
                        Number(
                            sellPrice.toFixed(8)
                        ),

                    spread:
                        Number(
                            spread.toFixed(2)
                        ),

                    estimatedProfit:
                        Number(
                            (
                                spread * 10
                            ).toFixed(2)
                        ),

                    tradable,

                    status:
                        tradable
                        ? 'tradable'
                        : 'unverified',

                    warning:
                        tradable
                        ? ''
                        : 'Check manually',

                    networks:{

                        buy:
                            buyNetworks,

                        sell:
                            sellNetworks
                    },

                    history:
                        historyStore[id]
                        || [],

                    firstDetected:
                        historyStore[id]?.[0]
                        ?.time
                        || Date.now()
                });
            }
        }
    }

    results.sort(
        (a,b)=> b.spread - a.spread
    );

    cachedOpportunities = results;

    return results;
}

/*
==================================================
AUTO SCAN
==================================================
*/

setInterval(async()=>{

    console.log(
        'Scanning markets...'
    );

    await scanMarkets();

    console.log(
        'Found:',
        cachedOpportunities.length
    );

},30000);

/*
==================================================
ROOT
==================================================
*/

app.get('/',(req,res)=>{

    res.json({

        status:
            'ArbiMine API Live',

        opportunities:
            cachedOpportunities.length
    });
});

/*
==================================================
ALL OPPORTUNITIES
==================================================
*/

app.get(
    '/api/opportunities',
    async(req,res)=>{

    try{

        if(
            cachedOpportunities.length === 0
        ){
            await scanMarkets();
        }

        res.json({

            success:true,

            total:
                cachedOpportunities.length,

            opportunities:
                cachedOpportunities
        });

    }catch(err){

        res.status(500).json({

            success:false,

            error:err.message
        });
    }
});

/*
==================================================
DETAILS
==================================================
*/

app.get(
    '/api/opportunity/:id',
    async(req,res)=>{

    try{

        const found =
            cachedOpportunities.find(
                item =>
                item.id ===
                req.params.id
            );

        if(!found){

            return res.status(404).json({

                success:false,

                message:
                    'Opportunity not found'
            });
        }

        res.json({

            success:true,

            data:found
        });

    }catch(err){

        res.status(500).json({

            success:false,

            error:err.message
        });
    }
});

/*
==================================================
PAY
==================================================
*/

app.post(
    '/api/pesapal/pay',
    async(req,res)=>{

    try{

        const {

            phone,
            amount,
            plan

        } = req.body;

        console.log(
            'PAYMENT:',
            phone,
            amount,
            plan
        );

        res.json({

            success:true,

            message:
                'STK Push Sent'
        });

    }catch(err){

        res.status(500).json({

            success:false,

            error:err.message
        });
    }
});

/*
==================================================
START
==================================================
*/

app.listen(PORT,async()=>{

    console.log(
        `ArbiMine running on ${PORT}`
    );

    await scanMarkets();
});
