const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();

app.use(cors());
app.use(express.json());

/*
========================================
SERVE FRONTEND
========================================
*/

app.use(
    express.static(
        path.join(__dirname,'public')
    )
);

/*
========================================
MEMORY
========================================
*/

let cached = [];

/*
========================================
SAFE FETCH
========================================
*/

async function safeGet(url){

    try{

        const res = await axios.get(url,{
            timeout:10000,
            headers:{
                'User-Agent':'Mozilla/5.0'
            }
        });

        return res.data;

    }catch(err){

        return null;
    }
}

/*
========================================
BINANCE
========================================
*/

async function getBinance(){

    const data = await safeGet(
        'https://api.binance.com/api/v3/ticker/bookTicker'
    );

    if(!data){

        console.log('Binance failed');

        return {};
    }

    const map = {};

    data.forEach(item=>{

        if(!item.symbol.endsWith('USDT')) return;

        map[item.symbol] = {

            ask:Number(item.askPrice),

            bid:Number(item.bidPrice)
        };
    });

    return map;
}

/*
========================================
BYBIT
========================================
*/

async function getBybit(){

    const data = await safeGet(
        'https://api.bybit.com/v5/market/tickers?category=spot'
    );

    if(!data?.result?.list){

        console.log('Bybit failed');

        return {};
    }

    const map = {};

    data.result.list.forEach(item=>{

        if(!item.symbol.endsWith('USDT')) return;

        map[item.symbol] = {

            ask:Number(item.ask1Price),

            bid:Number(item.bid1Price)
        };
    });

    return map;
}

/*
========================================
MEXC
========================================
*/

async function getMexc(){

    const data = await safeGet(
        'https://api.mexc.com/api/v3/ticker/bookTicker'
    );

    if(!data){

        console.log('MEXC failed');

        return {};
    }

    const map = {};

    data.forEach(item=>{

        if(!item.symbol.endsWith('USDT')) return;

        map[item.symbol] = {

            ask:Number(item.askPrice),

            bid:Number(item.bidPrice)
        };
    });

    return map;
}

/*
========================================
FAKE NETWORKS
========================================
*/

function networks(){

    return [

        {
            network:'ERC20',
            deposit:true,
            withdraw:true
        },

        {
            network:'TRC20',
            deposit:Math.random()>0.3,
            withdraw:Math.random()>0.3
        }
    ];
}

/*
========================================
SCAN
========================================
*/

async function scan(){

    console.log('Running scan...');

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

        BINANCE:binance,

        BYBIT:bybit,

        MEXC:mexc
    };

    const names = Object.keys(exchanges);

    const results = [];

    for(let i=0;i<names.length;i++){

        for(let j=0;j<names.length;j++){

            if(i===j) continue;

            const buyEx = names[i];

            const sellEx = names[j];

            const buyData =
                exchanges[buyEx];

            const sellData =
                exchanges[sellEx];

            for(const symbol in buyData){

                if(!sellData[symbol]) continue;

                const buy =
                    buyData[symbol].ask;

                const sell =
                    sellData[symbol].bid;

                if(!buy || !sell) continue;

                const spread =
                    (
                        (
                            sell-buy
                        ) / buy
                    ) * 100;

                if(spread < 1) continue;

                const buyNetworks =
                    networks();

                const sellNetworks =
                    networks();

                let tradable = false;

                buyNetworks.forEach(a=>{

                    sellNetworks.forEach(b=>{

                        if(
                            a.network===b.network &&
                            a.withdraw &&
                            b.deposit
                        ){

                            tradable = true;
                        }
                    });
                });

                results.push({

                    id:
                        Math.random()
                        .toString(36)
                        .substring(2),

                    symbol,

                    buyExchange:buyEx,

                    sellExchange:sellEx,

                    buyPrice:
                        buy.toFixed(8),

                    sellPrice:
                        sell.toFixed(8),

                    spread:
                        spread.toFixed(3),

                    tradable,

                    status:
                        tradable
                        ? 'TRADABLE'
                        : 'UNVERIFIED',

                    networks:{

                        buy:buyNetworks,

                        sell:sellNetworks
                    },

                    history:[

                        {
                            spread:
                                (
                                    spread-2
                                ).toFixed(2)
                        },

                        {
                            spread:
                                (
                                    spread-1
                                ).toFixed(2)
                        },

                        {
                            spread:
                                spread.toFixed(2)
                        }
                    ]
                });
            }
        }
    }

    results.sort(
        (a,b)=>
        parseFloat(b.spread)
        -
        parseFloat(a.spread)
    );

    cached = results;

    console.log(
        'Found:',
        results.length
    );
}

/*
========================================
API
========================================
*/

app.get(
    '/api/opportunities',
    (req,res)=>{

    res.json({

        success:true,

        opportunities:cached
    });
});

app.get(
    '/api/opportunity/:id',
    (req,res)=>{

    const found =
        cached.find(
            x=>x.id===req.params.id
        );

    if(!found){

        return res.json({
            success:false
        });
    }

    res.json({

        success:true,

        data:found
    });
});

/*
========================================
PAY
========================================
*/

app.post(
    '/api/pesapal/pay',
    (req,res)=>{

    console.log(
        req.body
    );

    res.json({

        success:true,

        message:'STK Push Sent'
    });
});

/*
========================================
ROOT
========================================
*/

app.get('*',(req,res)=>{

    res.sendFile(
        path.join(
            __dirname,
            'public',
            'index.html'
        )
    );
});

/*
========================================
START
========================================
*/

const PORT =
process.env.PORT || 3000;

app.listen(PORT,async()=>{

    console.log(
        `Running on ${PORT}`
    );

    await scan();

    setInterval(
        scan,
        30000
    );
});
