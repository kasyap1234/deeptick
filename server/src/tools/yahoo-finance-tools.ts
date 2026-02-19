import { tool } from 'langchain';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

const makeTool = tool as any;

const yahooBaseUrl = 'https://query1.finance.yahoo.com/v8/finance';

async function fetchYahooFinance(endpoint: string): Promise<any> {
  try {
    const response = await fetch(`${yahooBaseUrl}${endpoint}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Yahoo Finance API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    logger.error({ error, endpoint }, 'Yahoo Finance fetch error');
    return null;
  }
}

function normalizeSymbol(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  if (upper.endsWith('.NS') || upper.endsWith('.BO')) {
    return upper;
  }
  return `${upper}.NS`;
}

export const yahooQuoteTool = makeTool(
  async ({ symbol }: { symbol: string }) => {
    const normalizedSymbol = normalizeSymbol(symbol);
    
    const data = await fetchYahooFinance(`/chart/${normalizedSymbol}?interval=1d&range=1d`);
    
    if (!data?.chart?.result?.[0]) {
      return { error: `No data found for ${symbol}`, symbol };
    }
    
    const result = data.chart.result[0];
    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];
    
    return {
      symbol: meta.symbol,
      name: meta.shortName || meta.longName,
      currency: meta.currency,
      price: meta.regularMarketPrice,
      previousClose: meta.chartPreviousClose || meta.previousClose,
      open: meta.open || quote?.open?.[quote.open.length - 1],
      high: meta.regularMarketDayHigh || quote?.high?.[quote.high.length - 1],
      low: meta.regularMarketDayLow || quote?.low?.[quote.low.length - 1],
      volume: meta.regularMarketVolume,
      marketCap: meta.marketCap,
      peRatio: meta.trailingPE,
      dividendYield: meta.dividendYield,
      '52WeekHigh': meta.fiftyTwoWeekHigh,
      '52WeekLow': meta.fiftyTwoWeekLow,
      exchange: meta.exchange,
      timestamp: meta.regularMarketTime,
    };
  },
  {
    name: 'yahoo_quote',
    description: `Get real-time or delayed stock quote for Indian (NSE/BSE) or US stocks.

Examples:
- NSE: RELIANCE, TCS, HDFCBANK (adds .NS suffix)
- BSE: SCBIPL (adds .BO suffix)
- US: AAPL, MSFT (no suffix needed)

Returns: current price, volume, 52-week high/low, market cap, P/E, etc.`,
    schema: z.object({
      symbol: z.string().describe('Stock ticker symbol (e.g., RELIANCE, TCS, HDFCBANK)'),
    }),
  }
);

export const yahooHistoricalTool = makeTool(
  async ({ symbol, period, interval }: { symbol: string; period?: string; interval?: string }) => {
    const normalizedSymbol = normalizeSymbol(symbol);
    
    const data = await fetchYahooFinance(`/chart/${normalizedSymbol}?interval=${interval || '1d'}&range=${period || '1y'}`);
    
    if (!data?.chart?.result?.[0]) {
      return { error: `No historical data found for ${symbol}`, symbol };
    }
    
    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0];
    
    if (!timestamps || !quote) {
      return { error: `No data available for ${symbol}`, symbol };
    }
    
    const history = timestamps.map((ts: number, i: number) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      open: quote.open?.[i],
      high: quote.high?.[i],
      low: quote.low?.[i],
      close: quote.close?.[i],
      volume: quote.volume?.[i],
    })).filter((d: any) => d.close !== null);
    
    return {
      symbol: normalizedSymbol,
      period,
      interval,
      data: history.slice(-100),
      count: history.length,
    };
  },
  {
    name: 'yahoo_history',
    description: `Get historical price data for Indian (NSE/BSE) or US stocks.

Returns OHLCV data (Open, High, Low, Close, Volume) for specified period.`,
    schema: z.object({
      symbol: z.string().describe('Stock ticker symbol (e.g., RELIANCE, TCS)'),
      period: z.enum(['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y', 'max']).default('1y').describe('Time period'),
      interval: z.enum(['1d', '1wk', '1mo']).default('1d').describe('Data interval'),
    }),
  }
);

export const yahooFundamentalsTool = makeTool(
  async ({ symbol, dataType }: { symbol: string; dataType?: string }) => {
    const normalizedSymbol = normalizeSymbol(symbol);
    
    const modules = dataType === 'all' 
      ? ['assetProfile', 'balanceSheetHistory', 'incomeStatementHistory', 'cashflowStatementHistory', 'defaultKeyStatistics', 'financialData']
      : dataType === 'balance-sheet' 
        ? ['balanceSheetHistory', 'defaultKeyStatistics']
        : dataType === 'income-statement'
          ? ['incomeStatementHistory', 'defaultKeyStatistics']
          : ['cashflowStatementHistory', 'defaultKeyStatistics'];
    
    const data = await fetchYahooFinance(`/quote/${normalizedSymbol}?modules=${modules.join(',')}`);
    
    if (!data?.quoteSummary?.result?.[0]) {
      return { error: `No fundamentals found for ${symbol}`, symbol };
    }
    
    const summary = data.quoteSummary.result[0];
    const result: any = { symbol: normalizedSymbol };
    
    if (summary.defaultKeyStatistics) {
      const ks = summary.defaultKeyStatistics;
      result.keyMetrics = {
        marketCap: ks.marketCap?.fmt,
        enterpriseValue: ks.enterpriseValue?.fmt,
        peRatio: ks.trailingPE?.fmt,
        forwardPE: ks.forwardPE?.fmt,
        pegRatio: ks.pegRatio?.fmt,
        pbRatio: ks.priceToBook?.fmt,
        psRatio: ks.priceToSalesTrailing12Months?.fmt,
        enterpriseToRevenue: ks.enterpriseToRevenue?.fmt,
        enterpriseToEbitda: ks.enterpriseToEbitda?.fmt,
        dividendYield: ks.dividendYield?.fmt,
        beta: ks.beta?.fmt,
      };
    }
    
    if (summary.financialData) {
      const fd = summary.financialData;
      result.ratios = {
        returnOnAssets: fd.returnOnAssets?.fmt,
        returnOnEquity: fd.returnOnEquity?.fmt,
        profitMargins: fd.profitMargins?.fmt,
        operatingMargins: fd.operatingMargins?.fmt,
        grossMargins: fd.grossMargins?.fmt,
        debtToEquity: fd.debtToEquity?.fmt,
        currentRatio: fd.currentRatio?.fmt,
        quickRatio: fd.quickRatio?.fmt,
        totalDebt: fd.totalDebt?.fmt,
        operatingCashflow: fd.operatingCashflow?.fmt,
        freeCashflow: fd.freeCashflow?.fmt,
      };
    }
    
    return result;
  },
  {
    name: 'yahoo_fundamentals',
    description: `Get fundamental financial data for Indian (NSE/BSE) or US stocks.

Returns: Balance sheet, Income statement, Cash flow, Key ratios (P/E, P/B, ROE, etc.)`,
    schema: z.object({
      symbol: z.string().describe('Stock ticker symbol (e.g., RELIANCE, TCS)'),
      dataType: z.enum(['balance-sheet', 'income-statement', 'cashflow', 'all']).default('all').describe('Type of financial data'),
    }),
  }
);

export const yahooOptionsTool = makeTool(
  async ({ symbol }: { symbol: string }) => {
    const normalizedSymbol = normalizeSymbol(symbol);
    
    const data = await fetchYahooFinance(`/options/${normalizedSymbol}`);
    
    if (!data?.optionChain?.result) {
      return { error: `No options data found for ${symbol}`, symbol };
    }
    
    const result = data.optionChain.result[0];
    const expirations = result.expirationDates;
    const options = result.options?.[0];
    
    if (!options) {
      return { error: `No options available`, symbol };
    }
    
    return {
      symbol: normalizedSymbol,
      expirations: expirations?.map((d: number) => new Date(d * 1000).toISOString().split('T')[0]),
      calls: options.calls?.slice(0, 10).map((c: any) => ({
        strike: c.strike,
        bid: c.bid,
        ask: c.ask,
        iv: c.impliedVolatility,
        volume: c.volume,
      })),
      puts: options.puts?.slice(0, 10).map((p: any) => ({
        strike: p.strike,
        bid: p.bid,
        ask: p.ask,
        iv: p.impliedVolatility,
        volume: p.volume,
      })),
    };
  },
  {
    name: 'yahoo_options',
    description: `Get options chain data for US stocks. Note: Options may not be available for Indian stocks.`,
    schema: z.object({
      symbol: z.string().describe('Stock ticker symbol (e.g., AAPL, MSFT)'),
    }),
  }
);

export const yahooNewsTool = makeTool(
  async ({ symbol, limit }: { symbol: string; limit?: number }) => {
    const normalizedSymbol = normalizeSymbol(symbol);
    
    const data = await fetchYahooFinance(`/quote/${normalizedSymbol}/news?count=${limit || 5}`);
    
    if (!Array.isArray(data)) {
      return { error: `No news found for ${symbol}`, symbol };
    }
    
    return {
      symbol: normalizedSymbol,
      news: data.map((item: any) => ({
        title: item.title,
        summary: item.summary,
        url: item.url,
        publisher: item.publisher,
        timestamp: item.publishedAt,
      })),
    };
  },
  {
    name: 'yahoo_news',
    description: `Get latest news for Indian (NSE/BSE) or US stocks.`,
    schema: z.object({
      symbol: z.string().describe('Stock ticker symbol (e.g., RELIANCE, TCS)'),
      limit: z.number().optional().default(5).describe('Number of news items'),
    }),
  }
);

export const yahooIndexTool = makeTool(
  async ({ symbol }: { symbol: string }) => {
    let normalizedSymbol = symbol.toUpperCase();
    if (!normalizedSymbol.includes('^')) {
      normalizedSymbol = `^${normalizedSymbol}`;
    }
    
    const data = await fetchYahooFinance(`/chart/${normalizedSymbol}?interval=1d&range=5d`);
    
    if (!data?.chart?.result?.[0]) {
      return { error: `No data found for index ${symbol}`, symbol };
    }
    
    const result = data.chart.result[0];
    const meta = result.meta;
    
    return {
      symbol: meta.symbol,
      name: meta.shortName || meta.longName,
      price: meta.regularMarketPrice,
      change: meta.regularMarketChange,
      changePercent: meta.regularMarketChangePercent,
      previousClose: meta.previousClose,
      '52WeekHigh': meta.fiftyTwoWeekHigh,
      '52WeekLow': meta.fiftyTwoWeekLow,
      volume: meta.regularMarketVolume,
    };
  },
  {
    name: 'yahoo_index',
    description: `Get Indian index data:
- ^NSEI = NIFTY 50
- ^NSEBANK = NIFTY BANK
- ^NSEMIDCAP = NIFTY MIDCAP
- ^BSESN = SENSEX`,
    schema: z.object({
      symbol: z.string().describe('Index symbol (e.g., ^NSEI, ^NSEBANK, ^BSESN)'),
    }),
  }
);

export const tools = [
  yahooQuoteTool,
  yahooHistoricalTool,
  yahooFundamentalsTool,
  yahooOptionsTool,
  yahooNewsTool,
  yahooIndexTool,
];

export default tools;
