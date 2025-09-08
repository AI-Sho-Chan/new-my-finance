# **【開発引継】React製 資産管理アプリケーションの機能実装とバグ修正依頼**

## **1\. プロジェクト概要**

個人の資産状況を一元的に管理・可視化するための、モダンなUIを持つWebアプリケーションの開発プロジェクトです。PC、スマートフォンなど、あらゆるデバイスから快適に利用できることを目標としています。

## **2\. 実現したいアプリケーションの最終要件**

### **A. ダッシュボード機能**

* 現在の市況と、ユーザーが設定したウォッチリストの銘柄をカード形式で一覧表示する。  
* **株式カードの要件:**  
  * コンパクトなデザインで、スマホ画面では横に2枚並べて表示。  
  * \*\*前日比（%）\*\*を最も目立つように表示し、プラスは緑、マイナスは赤で色分けする。5%以上の変動はさらに強調する。  
  * 企業名（日本株は日本語、米国株は英語）、ティッカーシンボルを表示。  
  * **中長期的な上昇/下降トレンド判定**を矢印アイコンで表示。（ロジック: 200日・50日移動平均線が共に右肩上がり、かつ50日線 \> 200日線、かつ現在価格 \> 50日線）  
  * PER, PBR, 配当利回り, 時価総額, 四半期業績（売上・営業益）の前年同期比成長率を表示。  
  * カードクリックで後述の**詳細チャートモーダル**を表示。  
* ウォッチリストはユーザーが自由に追加・編集・並び替え可能。

### **B. 資産管理（ポートフォリオ）機能**

* ユーザーが保有する全資産（銀行預金、日本株、米国株、暗号資産）を一覧で表示。  
* **資産リストの要件:**  
  * 資産の追加、編集、削除、並び替えが可能。  
  * **銀行預金:** JPY、USDで手入力。USDは最新レートで自動的に円換算。  
  * **株式:** 銘柄、取得単価、株数を入力。最新株価を自動取得し、「現在評価額」と「購入時からの騰落率（%）」を自動計算して表示。  
* 総資産額、現金資産、投資資産の合計額と、それぞれの\*\*対前日比（%）\*\*を表示。  
* 資産推移（総資産、現金、投資）を日次/週次/月次で表示するグラフ機能。

### **C. 詳細チャート機能**

* 株式カードクリック時に、モーダルウィンドウで表示。  
* ローソク足チャートで、日足/週足/月足の切り替えが可能。  
* **表示するテクニカル指標:** 50日移動平均線, 200日移動平均線, ボリンジャーバンド, 出来高。

### **D. その他**

* ログイン機能は不要（ただし将来的な拡張性は考慮）。  
* 金融データの取得は、ユーザーのAPIキー設定などが不要な、自律的な方法を希望。

## **3\. 現在の実装状況と課題**

* **実装済み:**  
  * Reactによる基本的なアプリケーションの骨格。  
  * ダッシュボード、ポートフォリオ、設定画面のUIコンポーネント。  
  * fetchMarketDataFromGemini fetchHistoricalDataFromGemini というシミュレーション関数による、ダミーデータでの画面表示。  
* **未実装:**  
  * Firebase等を利用したデータ永続化（ウォッチリスト、ポートフォリオ情報の保存）。  
  * 資産の追加・編集・削除機能。  
  * 資産推移グラフの描画。  
  * 実際の金融データAPIとの連携。  
* **最優先で解決すべき技術的課題:**  
  * **StockChartModalコンポーネントにおける、TypeError: chart.addCandlestickSeries is not a functionというエラーが、複数回の修正にもかかわらず解決していません。**  
  * **経緯:**  
    1. 当初、useEffectと動的\<script\>タグ注入による非同期処理の競合が原因と推測し、複雑な状態管理を行いましたが失敗しました。  
    2. 次に、ESM形式でlightweight-chartsをimportする方法を試みましたが、実行環境の制約によりCould not resolve "lightweight-charts"というコンパイルエラーが発生し、断念しました。  
    3. 再度、動的スクリプト注入方式に戻し、ロジックを単純化するなどの修正を加えましたが、根本的なTypeErrorは解決しませんでした。  
  * **原因推測:** ライブラリのスクリプト読み込みと、Reactのレンダリングライフサイクル（特にモーダルの表示・非表示）の間に、非常に根深い競合問題が存在すると考えられます。実行環境（iframe）に起因する制約の可能性も否定できません。

## **4\. 依頼事項**

1. **最優先:** 上記の**チャート表示に関するTypeErrorを完全に解決**し、要件通りのインタラクティブチャートを安定して動作させてください。これまでのアプローチに固執せず、最も確実な方法での再実装をお願いします。  
2. **次点:** チャート機能が安定動作することを確認後、未実装機能である**Firebase Firestoreを用いたデータ永続化機能**（ウォッチリストとポートフォリオ）の開発に着手してください。

## **5\. 修正対象の最新ソースコード**

以下のコードが、現在問題が発生しているアプリケーションの全ソースコードです。このファイルを修正・更新してください。

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';  
import { initializeApp } from 'firebase/app';  
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';  
import { getFirestore, collection, doc, onSnapshot, setDoc, addDoc, deleteDoc, query, getDocs, updateDoc } from 'firebase/firestore';

// \--- アイコンコンポーネント \---  
const ArrowUp \= () \=\> \<svg xmlns="\[http://www.w3.org/2000/svg\](http://www.w3.org/2000/svg)" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"\>\<line x1="12" y1="19" x2="12" y2="5"\>\</line\>\<polyline points="5 12 12 5 19 12"\>\</polyline\>\</svg\>;  
const ArrowDown \= () \=\> \<svg xmlns="\[http://www.w3.org/2000/svg\](http://www.w3.org/2000/svg)" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"\>\<line x1="12" y1="5" x2="12" y2="19"\>\</line\>\<polyline points="19 12 12 19 5 12"\>\</polyline\>\</svg\>;  
const TrendingUp \= () \=\> \<svg xmlns="\[http://www.w3.org/2000/svg\](http://www.w3.org/2000/svg)" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"\>\<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"\>\</polyline\>\<polyline points="17 6 23 6 23 12"\>\</polyline\>\</svg\>;  
const TrendingDown \= () \=\> \<svg xmlns="\[http://www.w3.org/2000/svg\](http://www.w3.org/2000/svg)" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"\>\<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"\>\</polyline\>\<polyline points="17 18 23 18 23 12"\>\</polyline\>\</svg\>;  
const PlusCircle \= () \=\> \<svg xmlns="\[http://www.w3.org/2000/svg\](http://www.w3.org/2000/svg)" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"\>\<circle cx="12" cy="12" r="10"\>\</circle\>\<line x1="12" y1="8" x2="12" y2="16"\>\</line\>\<line x1="8" y1="12" x2="16" y2="12"\>\</line\>\</svg\>;  
const MoreVertical \= () \=\> \<svg xmlns="\[http://www.w3.org/2000/svg\](http://www.w3.org/2000/svg)" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"\>\<circle cx="12" cy="12" r="1"\>\</circle\>\<circle cx="12" cy="5" r="1"\>\</circle\>\<circle cx="12" cy="19" r="1"\>\</circle\>\</svg\>;  
const SettingsIcon \= () \=\> \<svg xmlns="\[http://www.w3.org/2000/svg\](http://www.w3.org/2000/svg)" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"\>\<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 0 2l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l-.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1 0-2l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"\>\</path\>\<circle cx="12" cy="12" r="3"\>\</circle\>\</svg\>;  
const HomeIcon \= () \=\> \<svg xmlns="\[http://www.w3.org/2000/svg\](http://www.w3.org/2000/svg)" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"\>\<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"\>\</path\>\<polyline points="9 22 9 12 15 12 15 22"\>\</polyline\>\</svg\>;  
const PieChartIcon \= () \=\> \<svg xmlns="\[http://www.w3.org/2000/svg\](http://www.w3.org/2000/svg)" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"\>\<path d="M21.21 15.89A10 10 0 1 1 8 2.83"\>\</path\>\<path d="M22 12A10 10 0 0 0 12 2v10z"\>\</path\>\</svg\>;  
const Loader \= () \=\> \<svg xmlns="\[http://www.w3.org/2000/svg\](http://www.w3.org/2000/svg)" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"\>\<line x1="12" y1="2" x2="12" y2="6"\>\</line\>\<line x1="12" y1="18" x2="12" y2="22"\>\</line\>\<line x1="4.93" y1="4.93" x2="7.76" y2="7.76"\>\</line\>\<line x1="16.24" y1="16.24" x2="19.07" y2="19.07"\>\</line\>\<line x1="2" y1="12" x2="6" y2="12"\>\</line\>\<line x1="18" y1="12" x2="22" y2="12"\>\</line\>\<line x1="4.93" y1="19.07" x2="7.76" y2="16.24"\>\</line\>\<line x1="16.24" y1="7.76" x2="19.07" y2="4.93"\>\</line\>\</svg\>;

// \--- 初期データ構造 \---  
const initialWatchlistData \= \[  
  { id: 1, name: '日経平均株価', symbol: '^N225' },  
  { id: 2, name: 'S\&P 500', symbol: '^GSPC' },  
  { id: 3, name: 'トヨタ自動車', symbol: '7203.T' },  
  { id: 4, name: 'Apple Inc.', symbol: 'AAPL' },  
  { id: 5, name: 'USD/JPY', symbol: 'JPY=X' },  
  { id: 6, name: 'S\&P 500 VIX', symbol: '^VIX' },  
\];

const initialPortfolioData \= \[  
    { id: 'bank1', type: '現金', name: 'A銀行 (JPY)', value: 1500000, details: { currency: 'JPY' }},  
    { id: 'bank2', type: '現金', name: 'B銀行 (USD)', value: 10000, details: { currency: 'USD', symbol: 'JPY=X' }},  
    { id: 'stock1', type: '日本株', name: 'ソニーグループ', value: 0, details: { symbol: '6758.T', qty: 100, avgPrice: 12500 }},  
    { id: 'stock2', type: '米国株', name: 'NVIDIA Corp', value: 0, details: { symbol: 'NVDA', qty: 10, avgPrice: 600 }},  
    { id: 'crypto1', type: '暗号資産', name: 'Bitcoin (JPY)', value: 0, details: { symbol: 'BTC-JPY', avgPrice: 8000000, qty: 0.125 }},  
\];

// \--- Gemini APIをシミュレートする関数 \---  
const fetchMarketDataFromGemini \= async (symbols) \=\> {  
    console.log(\`Fetching data for: ${symbols.join(', ')}\`);  
    await new Promise(resolve \=\> setTimeout(resolve, 1500)); 

    const simulatedData \= {  
        '^N225': { price: 38750.50, change: 250.75, changePercent: 0.65, trend: 'up', name: '日経平均株価' },  
        '^GSPC': { price: 5175.20, change: \-40.10, changePercent: \-0.77, trend: 'down', name: 'S\&P 500' },  
        '7203.T': { price: 3520, change: 230.00, changePercent: 6.99, trend: 'up', name: 'トヨタ自動車', per: 10.5, pbr: 1.2, dividendYield: 2.5, quarterlySalesGrowth: 10.2, quarterlyOperatingIncomeGrowth: 15.5 },  
        'AAPL': { price: 172.12, change: \-1.50, changePercent: \-0.86, trend: 'down', name: 'Apple Inc.', per: 26.5, pbr: 39.1, dividendYield: 0.5, quarterlySalesGrowth: \-1.4, quarterlyOperatingIncomeGrowth: 2.1 },  
        'JPY=X': { price: 150.85, change: 0.60, changePercent: 0.40, trend: 'up', name: 'USD/JPY' },  
        '^VIX': { price: 15.10, change: 1.80, changePercent: 13.53, trend: 'up', name: 'S\&P 500 VIX' },  
        '6758.T': { price: 13150, change: 150, changePercent: 1.15, trend: 'up', name: 'ソニーグループ' },  
        'NVDA': { price: 905.50, change: 5.20, changePercent: 0.58, trend: 'up', name: 'NVIDIA Corp' },  
        'BTC-JPY': { price: 10150000, change: 150000, changePercent: 1.50, trend: 'up', name: 'Bitcoin (JPY)' },  
    };  
    return symbols.reduce((acc, symbol) \=\> {  
        if (simulatedData\[symbol\]) {  
            acc\[symbol\] \= simulatedData\[symbol\];  
        }  
        return acc;  
    }, {});  
};

// \--- チャート用の時系列データをシミュレートする関数 \---  
const fetchHistoricalDataFromGemini \= async (symbol, timeframe) \=\> {  
    console.log(\`Fetching historical data for ${symbol} with timeframe ${timeframe}\`);  
    await new Promise(resolve \=\> setTimeout(resolve, 1000));

    const data \= \[\];  
    let date \= new Date();  
    date.setHours(0, 0, 0, 0);  
    let price \= 5000 \+ Math.random() \* 500;  
    const days \= timeframe \=== 'D' ? 365 : (timeframe \=== 'W' ? 52 \* 5 : 12 \* 15);  
    const interval \= timeframe \=== 'D' ? 1 : (timeframe \=== 'W' ? 7 : 30);

    for (let i \= 0; i \< days; i++) {  
        const movement \= (Math.random() \- 0.48) \* (price \* 0.05);  
        const open \= price;  
        const close \= price \+ movement;  
        const high \= Math.max(open, close) \+ Math.random() \* 20;  
        const low \= Math.min(open, close) \- Math.random() \* 20;  
        const volume \= Math.random() \* 100000 \+ 50000;  
          
        const currentDate \= new Date(date.getTime());  
        currentDate.setDate(date.getDate() \- (i \* interval));

        data.push({  
            time: currentDate.getTime() / 1000,  
            open,  
            high,  
            low,  
            close,  
            value: volume,  
            color: close \>= open ? 'rgba(0, 150, 136, 0.2)' : 'rgba(255, 82, 82, 0.2)',  
        });  
        price \= close;  
    }

    return data.reverse();  
};

const App \= () \=\> {  
  const \[activeTab, setActiveTab\] \= useState('dashboard');  
  const \[watchlist, setWatchlist\] \= useState(\[\]);  
  const \[portfolio, setPortfolio\] \= useState(\[\]);  
  const \[isLoading, setIsLoading\] \= useState(true);  
  const \[isModalOpen, setIsModalOpen\] \= useState(false);  
  const \[selectedStock, setSelectedStock\] \= useState(null);

  useEffect(() \=\> {  
    const fetchData \= async () \=\> {  
        setIsLoading(true);  
        const watchlistSymbols \= initialWatchlistData.map(item \=\> item.symbol);  
        const portfolioSymbols \= initialPortfolioData  
            .filter(item \=\> item.details.symbol)  
            .map(item \=\> item.details.symbol);  
          
        const allSymbols \= \[...new Set(\[...watchlistSymbols, ...portfolioSymbols\])\];  
          
        try {  
            const marketData \= await fetchMarketDataFromGemini(allSymbols);  
              
            const updatedWatchlist \= initialWatchlistData.map(item \=\> {  
                const data \= marketData\[item.symbol\] || {};  
                return { ...item, ...data };  
            });  
            setWatchlist(updatedWatchlist);

            const updatedPortfolio \= initialPortfolioData.map(asset \=\> {  
                if (asset.details.symbol) {  
                    const data \= marketData\[asset.details.symbol\];  
                    if (data) {  
                        if (asset.type \=== '現金' && asset.details.currency \=== 'USD') {  
                           return { ...asset, details: { ...asset.details, rate: data.price }};  
                        }  
                        const currentValue \= data.price \* asset.details.qty;  
                        const cost \= asset.details.avgPrice \* asset.details.qty;  
                        const gainLossPercent \= cost \> 0 ? ((currentValue \- cost) / cost) \* 100 : 0;  
                        return { ...asset, value: currentValue, gainLossPercent };  
                    }  
                }  
                return asset;  
            });  
            setPortfolio(updatedPortfolio);

        } catch (error) {  
            console.error("Failed to fetch market data:", error);  
            setWatchlist(initialWatchlistData);  
            setPortfolio(initialPortfolioData);  
        } finally {  
            setIsLoading(false);  
        }  
    };

    fetchData();  
  }, \[\]);  
    
  const handleCardClick \= (stock) \=\> {  
    setSelectedStock(stock);  
    setIsModalOpen(true);  
  };  
    
  const closeModal \= () \=\> {  
    setIsModalOpen(false);  
    setSelectedStock(null);  
  };

  const renderContent \= () \=\> {  
    if (isLoading) {  
        return (  
            \<div className="flex justify-center items-center h-64"\>  
                \<Loader /\>  
                \<span className="ml-4 text-lg text-gray-400"\>市場データを取得中...\</span\>  
            \</div\>  
        );  
    }

    switch (activeTab) {  
      case 'dashboard':  
        return \<Dashboard watchlist={watchlist} onCardClick={handleCardClick} /\>;  
      case 'portfolio':  
        return \<Portfolio portfolio={portfolio} /\>;  
      case 'settings':  
        return \<Settings /\>;  
      default:  
        return \<Dashboard watchlist={watchlist} onCardClick={handleCardClick} /\>;  
    }  
  };

  return (  
    \<div className="bg-gray-900 text-white min-h-screen font-sans antialiased"\>  
      \<div className="container mx-auto px-4 pb-20"\>  
        \<Header /\>  
        \<main\>{renderContent()}\</main\>  
      \</div\>  
      \<BottomNav activeTab={activeTab} setActiveTab={setActiveTab} /\>  
      {isModalOpen && \<StockChartModal stock={selectedStock} onClose={closeModal} /\>}  
    \</div\>  
  );  
};

const Header \= () \=\> (  
  \<header className="py-6"\>  
    \<h1 className="text-3xl font-bold text-gray-100"\>資産マネージャー\</h1\>  
    \<p className="text-md text-gray-400"\>あなたの資産と市場を、ここに集約。\</p\>  
  \</header\>  
);

const Dashboard \= ({ watchlist, onCardClick }) \=\> (  
  \<div\>  
    \<h2 className="text-2xl font-semibold mb-4 text-gray-200"\>ダッシュボード\</h2\>  
    \<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-4"\>  
      {watchlist.map((item) \=\> (  
        \<StockCard key={item.id} item={item} onClick={() \=\> onCardClick(item)} /\>  
      ))}  
    \</div\>  
  \</div\>  
);

const StockCard \= ({ item, onClick }) \=\> {  
  const isPositive \= (item.changePercent || 0\) \>= 0;  
  const changePercentAbs \= Math.abs(item.changePercent || 0);  
  const isVolatile \= changePercentAbs \>= 5;

  const cardStyle \= \`  
    bg-gray-800 rounded-lg p-3 shadow-lg transform hover:scale-105 transition-transform duration-300 cursor-pointer  
    flex flex-col justify-between h-full aspect-\[4/5\]  
    ${isVolatile ? 'ring-2 ring-yellow-400 shadow-yellow-400/20' : ''}  
  \`;

  const formatGrowth \= (value) \=\> {  
      if (value \=== undefined || value \=== null) return '-';  
      const sign \= value \>= 0 ? '+' : '';  
      return \`${sign}${value.toFixed(1)}%\`;  
  };

  return (  
    \<div className={cardStyle} onClick={onClick}\>  
      \<div className="flex justify-between items-start"\>  
        \<div className="w-4/5"\>  
            \<h3 className="text-sm font-bold text-gray-100 truncate"\>{item.name}\</h3\>  
            \<p className="text-xs text-gray-400"\>{item.symbol}\</p\>  
        \</div\>  
        \<div className={\`text-lg flex items-center ${item.trend \=== 'up' ? 'text-green-400' : 'text-red-400'}\`}\>  
            {item.trend \=== 'up' ? \<TrendingUp /\> : \<TrendingDown /\>}  
        \</div\>  
      \</div\>

      \<div className="flex-grow flex items-center justify-center my-1"\>  
          \<div className={\`text-3xl md:text-4xl font-bold ${isPositive ? 'text-green-500' : 'text-red-500'}\`}\>  
            {isPositive ? '+' : '-'}{changePercentAbs.toFixed(1)}%  
          \</div\>  
      \</div\>  
        
      \<div className="text-xs text-gray-400 pt-2 border-t border-gray-700 space-y-1"\>  
          \<div className="flex justify-between"\>\<span className="font-semibold"\>PER\</span\> \<span className="text-gray-200 font-medium"\>{item.per || '-'}\</span\>\</div\>  
          \<div className="flex justify-between"\>\<span className="font-semibold"\>PBR\</span\> \<span className="text-gray-200 font-medium"\>{item.pbr || '-'}\</span\>\</div\>  
          \<div className="flex justify-between"\>\<span className="font-semibold"\>配当利回\</span\> \<span className="text-gray-200 font-medium"\>{item.dividendYield ? \`${item.dividendYield}%\` : '-'}\</span\>\</div\>  
          \<div className="flex justify-between"\>\<span className="font-semibold truncate" title="四半期売上高成長率(YoY)"\>売上高↑\</span\> \<span className={\`font-semibold ${item.quarterlySalesGrowth \>= 0 ? 'text-green-400' : 'text-red-400'}\`}\>{formatGrowth(item.quarterlySalesGrowth)}\</span\>\</div\>  
          \<div className="flex justify-between"\>\<span className="font-semibold truncate" title="四半期営業利益成長率(YoY)"\>営業益↑\</span\> \<span className={\`font-semibold ${item.quarterlyOperatingIncomeGrowth \>= 0 ? 'text-green-400' : 'text-red-400'}\`}\>{formatGrowth(item.quarterlyOperatingIncomeGrowth)}\</span\>\</div\>  
      \</div\>  
    \</div\>  
  );  
};

const Portfolio \= ({ portfolio }) \=\> {  
    const totalValue \= useMemo(() \=\> portfolio.reduce((sum, asset) \=\> {  
        if (asset.type \=== '現金' && asset.details.currency \=== 'USD') {  
            return sum \+ (asset.value \* (asset.details.rate || 150));  
        }  
        return sum \+ asset.value;  
    }, 0), \[portfolio\]);

    const cashValue \= useMemo(() \=\> portfolio.filter(a \=\> a.type \=== '現金').reduce((sum, asset) \=\> {  
        if (asset.details.currency \=== 'USD') {  
            return sum \+ (asset.value \* (asset.details.rate || 150));  
        }  
        return sum \+ asset.value;  
    }, 0), \[portfolio\]);  
      
    const investmentValue \= totalValue \- cashValue;

    const totalChange \= 25340;   
    const totalChangePercent \= (totalChange / (totalValue \- totalChange)) \* 100;

    return (  
        \<div\>  
            \<div className="bg-gray-800 p-4 rounded-lg mb-6"\>  
                \<div className="text-gray-400 text-sm"\>総資産額 (JPY)\</div\>  
                \<div className="text-3xl font-bold text-white"\>¥ {totalValue.toLocaleString()}\</div\>  
                \<div className={\`text-md font-semibold mt-1 ${totalChange \>= 0 ? 'text-green-400' : 'text-red-400'}\`}\>  
                    {totalChange \>= 0 ? '+' : ''}¥{Math.abs(totalChange).toLocaleString()} ({totalChange \>= 0 ? '+' : ''}{totalChangePercent.toFixed(2)}%)  
                    \<span className="text-sm text-gray-500 ml-2"\>対前日比\</span\>  
                \</div\>  
                \<div className="flex justify-between mt-4 pt-4 border-t border-gray-700 text-base"\>  
                    \<div className="text-green-400"\>現金: ¥ {cashValue.toLocaleString()}\</div\>  
                    \<div className="text-blue-400"\>投資: ¥ {investmentValue.toLocaleString()}\</div\>  
                \</div\>  
            \</div\>

            \<div className="bg-gray-800 p-4 rounded-lg mb-6 h-64 flex items-center justify-center"\>  
                \<p className="text-gray-500"\>資産推移グラフ\</p\>  
            \</div\>  
              
            \<div className="flex justify-between items-center mb-4"\>  
                \<h2 className="text-2xl font-semibold text-gray-200"\>資産一覧\</h2\>  
                \<button className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-2 px-4 rounded-lg flex items-center"\>  
                    \<PlusCircle /\>  
                    \<span className="ml-2"\>追加\</span\>  
                \</button\>  
            \</div\>

            \<div className="space-y-3"\>  
                {portfolio.map(asset \=\> {  
                    const isUsdCash \= asset.type \=== '現金' && asset.details.currency \=== 'USD';  
                    let displayValue \= asset.value;  
                    if (isUsdCash) {  
                        displayValue \= asset.value \* (asset.details.rate || 0);  
                    }

                    return (  
                        \<div key={asset.id} className="bg-gray-800 rounded-lg p-4 flex justify-between items-center"\>  
                            \<div\>  
                                \<p className="font-bold text-gray-100"\>{asset.name}\</p\>  
                                \<p className="text-sm text-gray-400"\>{asset.type}\</p\>  
                            \</div\>  
                            \<div className="text-right"\>  
                               \<p className="font-bold text-lg text-gray-50"\>  
                                    {isUsdCash ? '¥' : (asset.details.currency \=== 'USD' ? '$' : '¥')}  
                                    {displayValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}  
                               \</p\>  
                               {isUsdCash && (  
                                   \<p className="text-sm text-gray-400"\>  
                                       ($ {asset.value.toLocaleString()})  
                                   \</p\>  
                               )}  
                               {asset.gainLossPercent \!== undefined && (  
                                    \<p className={\`font-semibold text-sm ${asset.gainLossPercent \>= 0 ? 'text-green-500' : 'text-red-500'}\`}\>  
                                        {asset.gainLossPercent \>= 0 ? '+' : ''}{asset.gainLossPercent.toFixed(2)}%  
                                    \</p\>  
                               )}  
                            \</div\>  
                        \</div\>  
                    );  
                })}  
            \</div\>  
        \</div\>  
    );  
};

const Settings \= () \=\> (  
    \<div\>  
        \<h2 className="text-2xl font-semibold mb-4 text-gray-200"\>設定\</h2\>  
        \<div className="bg-gray-800 rounded-lg p-4"\>  
            \<h3 className="text-lg font-bold mb-2"\>アラート設定\</h3\>  
            \<div className="flex justify-between items-center"\>  
                \<p\>S\&P 500 VIX指数が40を超えたら通知\</p\>  
                \<label className="switch"\>  
                    \<input type="checkbox" defaultChecked /\>  
                    \<span className="slider round"\>\</span\>  
                \</label\>  
            \</div\>  
            \<style\>{\`  
                .switch { position: relative; display: inline-block; width: 60px; height: 34px; }  
                .switch input { opacity: 0; width: 0; height: 0; }  
                .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: \#ccc; transition: .4s; }  
                .slider:before { position: absolute; content: ""; height: 26px; width: 26px; left: 4px; bottom: 4px; background-color: white; transition: .4s; }  
                input:checked \+ .slider { background-color: \#4f46e5; }  
                input:checked \+ .slider:before { transform: translateX(26px); }  
                .slider.round { border-radius: 34px; }  
                .slider.round:before { border-radius: 50%; }  
            \`}\</style\>  
        \</div\>  
    \</div\>  
);

const BottomNav \= ({ activeTab, setActiveTab }) \=\> {  
    const navItems \= \[  
        { id: 'dashboard', label: 'ダッシュボード', icon: \<HomeIcon /\> },  
        { id: 'portfolio', label: '資産管理', icon: \<PieChartIcon /\> },  
        { id: 'settings', label: '設定', icon: \<SettingsIcon /\> },  
    \];  
    return (  
        \<nav className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 shadow-lg"\>  
            \<div className="flex justify-around max-w-lg mx-auto"\>  
                {navItems.map(item \=\> (  
                    \<button  
                        key={item.id}  
                        onClick={() \=\> setActiveTab(item.id)}  
                        className={\`flex flex-col items-center justify-center w-full pt-2 pb-1 ${activeTab \=== item.id ? 'text-indigo-400' : 'text-gray-400'}\`}  
                    \>  
                        {item.icon}  
                        \<span className="text-xs"\>{item.label}\</span\>  
                    \</button\>  
                ))}  
            \</div\>  
        \</nav\>  
    );  
};

const StockChartModal \= ({ stock, onClose }) \=\> {  
  const containerRef \= useRef(null);  
  const chartRef \= useRef(null);  
  const seriesRef \= useRef({});

  const \[timeframe, setTimeframe\] \= useState('D');  
  const \[loading, setLoading\] \= useState(true);  
  const \[isScriptLoaded, setIsScriptLoaded\] \= useState(false);

  // Effect for loading the script once  
  useEffect(() \=\> {  
    const scriptId \= 'lightweight-charts-script';  
    if (document.getElementById(scriptId)) {  
      if(window.LightweightCharts) {  
        setIsScriptLoaded(true);  
      }  
      return;  
    }  
    const script \= document.createElement('script');  
    script.id \= scriptId;  
    script.src \= '\[https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js\](https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js)';  
    script.async \= true;  
    script.onload \= () \=\> setIsScriptLoaded(true);  
    script.onerror \= () \=\> console.error('Failed to load chart script');  
    document.head.appendChild(script);  
  }, \[\]);

  // Effect for CREATING the chart and series  
  useEffect(() \=\> {  
    if (\!isScriptLoaded || \!containerRef.current || \!stock) return;

    const chart \= window.LightweightCharts.createChart(containerRef.current, {  
        width: containerRef.current.clientWidth,  
        height: containerRef.current.clientHeight,  
        layout: { backgroundColor: '\#1f2937', textColor: 'rgba(255,255,255,0.9)' },  
        grid: { vertLines: { color: '\#374151' }, horzLines: { color: '\#374151' } },  
        crosshair: { mode: window.LightweightCharts.CrosshairMode.Normal },  
        timeScale: { borderColor: '\#4b5563' },  
    });  
    chartRef.current \= chart;

    // Create series  
    seriesRef.current.candle \= chart.addCandlestickSeries({ upColor: '\#10b981', downColor: '\#ef4444', borderUpColor: '\#10b981', borderDownColor: '\#ef4444', wickUpColor: '\#10b981', wickDownColor: '\#ef4444' });  
    seriesRef.current.volume \= chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });  
    seriesRef.current.volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });  
    seriesRef.current.ma50 \= chart.addLineSeries({ color: 'rgba(234,179,8,0.8)', lineWidth: 2 });  
    seriesRef.current.ma200 \= chart.addLineSeries({ color: 'rgba(192,132,252,0.8)', lineWidth: 2 });  
    seriesRef.current.bbUpper \= chart.addLineSeries({ color: 'rgba(56,189,248,0.5)', lineWidth: 1 });  
    seriesRef.current.bbLower \= chart.addLineSeries({ color: 'rgba(56,189,248,0.5)', lineWidth: 1 });  
      
    // Handle resizing  
    const resizeObserver \= new ResizeObserver(entries \=\> {  
        if (entries.length \=== 0 || entries\[0\].target \!== containerRef.current) return;  
        const { width, height } \= entries\[0\].contentRect;  
        chart.applyOptions({ width, height });  
    });  
    resizeObserver.observe(containerRef.current);

    // Cleanup  
    return () \=\> {  
      resizeObserver.disconnect();  
      chart.remove();  
      chartRef.current \= null;  
      seriesRef.current \= {};  
    };  
  }, \[isScriptLoaded, stock\]);

  // Effect for UPDATING data when timeframe changes or chart is created  
  useEffect(() \=\> {  
    if (\!chartRef.current || \!seriesRef.current.candle || \!stock || \!isScriptLoaded) return;

    let isCancelled \= false;  
      
    const updateData \= async () \=\> {  
      setLoading(true);  
      try {  
        const rawData \= await fetchHistoricalDataFromGemini(stock.symbol, timeframe);  
        if (isCancelled) return;  
          
        const ohlcData \= rawData.map(d \=\> ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close }));  
        const volumeData \= rawData.map(d \=\> ({ time: d.time, value: d.value, color: d.color }));  
        const calculateMA \= (data, period) \=\> data.slice(period \- 1).map((\_, i) \=\> { const slice \= data.slice(i, i \+ period); const sum \= slice.reduce((acc, d) \=\> acc \+ d.close, 0); return { time: data\[i \+ period \- 1\].time, value: sum / period }; });  
        const calculateBB \= (data, period, multiplier) \=\> data.slice(period \- 1).map((\_, i) \=\> { const slice \= data.slice(i, i \+ period); const mean \= slice.reduce((acc, d) \=\> acc \+ d.close, 0\) / period; const variance \= slice.reduce((acc, d) \=\> acc \+ Math.pow(d.close \- mean, 2), 0\) / period; const std \= Math.sqrt(variance); return { time: data\[i \+ period \- 1\].time, upper: mean \+ multiplier \* std, lower: mean \- multiplier \* std }; });  
        const ma50Data \= calculateMA(ohlcData, 50);  
        const ma200Data \= calculateMA(ohlcData, 200);  
        const bbData \= calculateBB(ohlcData, 20, 2);

        seriesRef.current.candle.setData(ohlcData);  
        seriesRef.current.volume.setData(volumeData);  
        seriesRef.current.ma50.setData(ma50Data);  
        seriesRef.current.ma200.setData(ma200Data);  
        seriesRef.current.bbUpper.setData(bbData.map(d \=\> ({ time: d.time, value: d.upper })));  
        seriesRef.current.bbLower.setData(bbData.map(d \=\> ({ time: d.time, value: d.lower })));  
          
        chartRef.current.timeScale().fitContent();

      } catch (e) {  
        console.error("Failed to update chart data:", e);  
      } finally {  
        if (\!isCancelled) {  
          setLoading(false);  
        }  
      }  
    };

    updateData();

    return () \=\> { isCancelled \= true; };  
  }, \[timeframe, stock, isScriptLoaded\]);

  // Esc key effect  
  useEffect(() \=\> {  
    const handleKeyDown \= (e) \=\> e.key \=== 'Escape' && onClose();  
    window.addEventListener('keydown', handleKeyDown);  
    return () \=\> window.removeEventListener('keydown', handleKeyDown);  
  }, \[onClose\]);

  if (\!stock) return null;

  return (  
    \<div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50" onClick={onClose}\>  
      \<div className="bg-gray-800 rounded-lg shadow-xl w-11/12 max-w-4xl h-3/4 p-4 flex flex-col" onClick={e \=\> e.stopPropagation()}\>  
        \<div className="flex justify-between items-center mb-2"\>  
          \<h2 className="text-xl font-bold"\>{stock.name} ({stock.symbol})\</h2\>  
          \<div className="flex items-center"\>  
            \<div className="bg-gray-700 rounded-md p-1 flex space-x-1 mr-4"\>  
              {\['D','W','M'\].map(tf \=\> (  
                \<button key={tf} onClick={() \=\> setTimeframe(tf)}  
                  className={\`px-3 py-1 text-sm font-semibold rounded ${timeframe \=== tf ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:bg-gray-600'}\`}\>  
                  {tf \=== 'D' ? '日' : tf \=== 'W' ? '週' : '月'}  
                \</button\>  
              ))}  
            \</div\>  
            \<button onClick={onClose} className="text-gray-400 hover:text-white text-2xl font-bold"\>×\</button\>  
          \</div\>  
        \</div\>  
        \<div className="w-full flex-grow relative" ref={containerRef}\>  
          {loading && (  
            \<div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-80 z-10"\>  
              \<Loader /\>\<span className="ml-4 text-gray-300"\>チャートデータを読み込み中...\</span\>  
            \</div\>  
          )}  
        \</div\>  
      \</div\>  
    \</div\>  
  );  
};

export default App;  
