import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

const YAHOO_TIMEOUT_MS = 12_000;
const CRUMB_COOLDOWN_MS = 10 * 60 * 1000;

const YAHOO_BASE_URL = 'https://query2.finance.yahoo.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// --- Cookie / crumb authentication ---

let cachedAuth: { cookie: string; crumb: string; expiry: number } | null = null;
let crumbCooldownUntil = 0;

type YahooAuth = { cookie: string; crumb: string };
type YahooAuthMode = 'unauth-only' | 'unauth-then-auth-on-unauthorized';

type PrimitiveOrFmt =
  | string
  | number
  | boolean
  | null
  | undefined
  | {
      fmt?: string;
      raw?: string | number | boolean;
    };

type FundamentalsResult = {
  symbol: string;
  keyMetrics?: Record<string, string | number | boolean | null | undefined>;
  ratios?: Record<string, string | number | boolean | null | undefined>;
  warning?: string;
};

type YahooChartMeta = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  currency?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  open?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  marketCap?: number;
  trailingPE?: number;
  dividendYield?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  exchange?: string;
  regularMarketTime?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
};

type YahooChartQuote = {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
};

type YahooChartResult = {
  meta: YahooChartMeta;
  indicators?: { quote?: YahooChartQuote[] };
  timestamp?: number[];
};

type YahooChartResponse = {
  chart?: { result?: YahooChartResult[] };
};

type YahooOptionContract = {
  strike?: number;
  bid?: number;
  ask?: number;
  impliedVolatility?: number;
  volume?: number;
};

type YahooOptionsResult = {
  expirationDates?: number[];
  options?: Array<{
    calls?: YahooOptionContract[];
    puts?: YahooOptionContract[];
  }>;
};

type YahooOptionsResponse = {
  optionChain?: { result?: YahooOptionsResult[] };
};

type YahooNewsItem = {
  title?: string;
  summary?: string;
  url?: string;
  publisher?: string;
  publishedAt?: string;
};

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), YAHOO_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function setCrumbCooldown(reason: string, metadata?: Record<string, unknown>) {
  cachedAuth = null;
  crumbCooldownUntil = Date.now() + CRUMB_COOLDOWN_MS;
  logger.warn({ cooldownMs: CRUMB_COOLDOWN_MS, ...metadata }, reason);
}

async function getYahooCrumb(): Promise<YahooAuth | null> {
  if (Date.now() < crumbCooldownUntil) {
    logger.debug({ cooldownUntil: crumbCooldownUntil }, 'Skipping Yahoo crumb fetch during cooldown');
    return null;
  }

  if (cachedAuth && Date.now() < cachedAuth.expiry) {
    return { cookie: cachedAuth.cookie, crumb: cachedAuth.crumb };
  }

  try {
    // Step 1: Hit Yahoo Finance to get session cookies
    const initRes = await fetchWithTimeout('https://finance.yahoo.com/quote/AAPL', {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
    });

    const setCookieHeaders = initRes.headers.getSetCookie?.() ?? [];
    const cookie = setCookieHeaders.map((c) => c.split(';')[0]).join('; ');

    if (!cookie) {
      setCrumbCooldown('Yahoo Finance returned no cookies while fetching crumb');
      return null;
    }

    // Step 2: Use cookies to fetch crumb token
    const crumbRes = await fetchWithTimeout(`${YAHOO_BASE_URL}/v1/test/getcrumb`, {
      headers: { 'User-Agent': USER_AGENT, Cookie: cookie },
    });

    if (!crumbRes.ok) {
      setCrumbCooldown('Failed to fetch Yahoo crumb', { status: crumbRes.status });
      return null;
    }

    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes('<')) {
      // Got HTML instead of a crumb token
      setCrumbCooldown('Yahoo crumb response was not a valid token');
      return null;
    }

    cachedAuth = { cookie, crumb, expiry: Date.now() + 25 * 60 * 1000 };
    crumbCooldownUntil = 0;
    return { cookie: cachedAuth.cookie, crumb: cachedAuth.crumb };
  } catch (error) {
    setCrumbCooldown('Failed to obtain Yahoo Finance crumb', { error });
    return null;
  }
}

// --- Core fetch with auth + retry ---

async function fetchYahooEndpoint(endpoint: string, auth: YahooAuth | null): Promise<Response> {
  const separator = endpoint.includes('?') ? '&' : '?';
  const url = auth
    ? `${YAHOO_BASE_URL}${endpoint}${separator}crumb=${encodeURIComponent(auth.crumb)}`
    : `${YAHOO_BASE_URL}${endpoint}`;

  return fetchWithTimeout(url, {
    headers: {
      'User-Agent': USER_AGENT,
      ...(auth ? { Cookie: auth.cookie } : {}),
    },
  });
}

async function parseYahooJson(response: Response, endpoint: string): Promise<unknown | null> {
  try {
    return await response.json();
  } catch (error) {
    logger.warn({ error, endpoint }, 'Yahoo Finance returned non-JSON response');
    return null;
  }
}

async function fetchYahooFinance(endpoint: string, authMode: YahooAuthMode = 'unauth-only'): Promise<unknown | null> {
  try {
    const response = await fetchYahooEndpoint(endpoint, null);

    if (response.ok) {
      return parseYahooJson(response, endpoint);
    }

    const shouldTryAuth =
      authMode === 'unauth-then-auth-on-unauthorized' && (response.status === 401 || response.status === 403);

    if (shouldTryAuth) {
      const auth = await getYahooCrumb();

      if (auth) {
        const authedResponse = await fetchYahooEndpoint(endpoint, auth);

        if (authedResponse.ok) {
          return parseYahooJson(authedResponse, endpoint);
        }

        if (authedResponse.status === 401 || authedResponse.status === 403) {
          cachedAuth = null;
        }

        logger.warn({ status: authedResponse.status, endpoint }, 'Yahoo Finance API error');
        return null;
      }
    }

    logger.warn({ status: response.status, endpoint }, 'Yahoo Finance API error');
    return null;
  } catch (error) {
    logger.error({ error, endpoint }, 'Yahoo Finance fetch error');
    return null;
  }
}

function getValue(value: PrimitiveOrFmt): string | number | boolean | null | undefined {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value.fmt === 'string') {
    return value.fmt;
  }

  if (
    typeof value.raw === 'string' ||
    typeof value.raw === 'number' ||
    typeof value.raw === 'boolean' ||
    value.raw === null
  ) {
    return value.raw;
  }

  return undefined;
}

function mapQuoteFallbackFundamentals(symbol: string, quoteData: unknown): FundamentalsResult | null {
  if (!quoteData || typeof quoteData !== 'object') {
    return null;
  }

  const response = quoteData as {
    quoteResponse?: {
      result?: Array<Record<string, unknown>>;
    };
  };

  const quote = response.quoteResponse?.result?.[0];
  if (!quote) {
    return null;
  }

  return {
    symbol,
    keyMetrics: {
      marketCap: getValue(quote.marketCap as PrimitiveOrFmt),
      enterpriseValue: getValue(quote.enterpriseValue as PrimitiveOrFmt),
      peRatio: getValue(quote.trailingPE as PrimitiveOrFmt),
      forwardPE: getValue(quote.forwardPE as PrimitiveOrFmt),
      pegRatio: getValue(quote.pegRatio as PrimitiveOrFmt),
      pbRatio: getValue(quote.priceToBook as PrimitiveOrFmt),
      psRatio: getValue(quote.priceToSalesTrailing12Months as PrimitiveOrFmt),
      enterpriseToRevenue: getValue(quote.enterpriseToRevenue as PrimitiveOrFmt),
      enterpriseToEbitda: getValue(quote.enterpriseToEbitda as PrimitiveOrFmt),
      dividendYield: getValue(quote.trailingAnnualDividendYield as PrimitiveOrFmt),
      beta: getValue(quote.beta as PrimitiveOrFmt),
    },
    ratios: {
      returnOnAssets: getValue(quote.returnOnAssets as PrimitiveOrFmt),
      returnOnEquity: getValue(quote.returnOnEquity as PrimitiveOrFmt),
      profitMargins: getValue(quote.profitMargins as PrimitiveOrFmt),
      operatingMargins: getValue(quote.operatingMargins as PrimitiveOrFmt),
      grossMargins: getValue(quote.grossMargins as PrimitiveOrFmt),
      debtToEquity: getValue(quote.debtToEquity as PrimitiveOrFmt),
      currentRatio: getValue(quote.currentRatio as PrimitiveOrFmt),
      quickRatio: getValue(quote.quickRatio as PrimitiveOrFmt),
      totalDebt: getValue(quote.totalDebt as PrimitiveOrFmt),
      operatingCashflow: getValue(quote.operatingCashflow as PrimitiveOrFmt),
      freeCashflow: getValue(quote.freeCashflow as PrimitiveOrFmt),
    },
    warning:
      'Fundamentals are partially populated from /v7/finance/quote because /v10/finance/quoteSummary was unavailable.',
  };
}

// --- Helpers ---

function normalizeSymbol(symbol: string, exchange?: string): string {
  const upper = symbol.toUpperCase().trim();
  // If symbol already has an exchange suffix (e.g., .NS, .BO, .L, .TO), pass through
  if (/\.[A-Z]{1,4}$/.test(upper)) {
    return upper;
  }
  // If caller specified an exchange, use it
  if (exchange) {
    return `${upper}.${exchange.toUpperCase()}`;
  }
  // Default to Indian market (NSE)
  return `${upper}.NS`;
}

function unavailable(symbol: string, tool: string) {
  return JSON.stringify({
    error: `Yahoo Finance data unavailable for ${symbol}`,
    symbol,
    tool,
    suggestion: 'Use exa_search to find financial data for this stock from web sources.',
  });
}

// --- Tools ---

export const yahooQuoteTool = tool(
  async ({ symbol, exchange }: { symbol: string; exchange?: string }) => {
    const normalizedSymbol = normalizeSymbol(symbol, exchange);

    const data = (await fetchYahooFinance(`/v8/finance/chart/${normalizedSymbol}?interval=1d&range=1d`)) as YahooChartResponse | null;

    if (!data?.chart?.result?.[0]) {
      return unavailable(normalizedSymbol, 'yahoo_quote');
    }

    const result = data.chart.result[0];
    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];

    return JSON.stringify({
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
    });
  },
  {
    name: 'yahoo_quote',
    description: `Get real-time or delayed stock quote for Indian (NSE/BSE) stocks.

Examples:
- NSE: RELIANCE, TCS, HDFCBANK, KPIT (adds .NS suffix)
- BSE: use .BO suffix explicitly (e.g., SCBIPL.BO)

Returns: current price, volume, 52-week high/low, market cap, P/E, etc.`,
    schema: z.object({
      symbol: z.string().describe('Stock ticker symbol (e.g., RELIANCE, TCS, HDFCBANK, KPIT)'),
      exchange: z.string().optional().describe('Exchange suffix (e.g., NS, BO, L, TO). Defaults to NS for Indian NSE.'),
    }),
  }
);

export const yahooHistoricalTool = tool(
  async ({ symbol, period, interval, exchange }: { symbol: string; period?: string; interval?: string; exchange?: string }) => {
    const normalizedSymbol = normalizeSymbol(symbol, exchange);

    const data = (await fetchYahooFinance(
      `/v8/finance/chart/${normalizedSymbol}?interval=${interval || '1d'}&range=${period || '1y'}`
    )) as YahooChartResponse | null;

    if (!data?.chart?.result?.[0]) {
      return unavailable(normalizedSymbol, 'yahoo_history');
    }

    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const quote = result.indicators?.quote?.[0];

    if (!timestamps || !quote) {
      return unavailable(normalizedSymbol, 'yahoo_history');
    }

    const history = timestamps
      .map((ts: number, i: number) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        open: quote.open?.[i],
        high: quote.high?.[i],
        low: quote.low?.[i],
        close: quote.close?.[i],
        volume: quote.volume?.[i],
      }))
      .filter((d: { close?: number | null }) => d.close !== null);

    return JSON.stringify({
      symbol: normalizedSymbol,
      period,
      interval,
      data: history.slice(-100),
      count: history.length,
    });
  },
  {
    name: 'yahoo_history',
    description: `Get historical price data for Indian (NSE/BSE) stocks.

Returns OHLCV data (Open, High, Low, Close, Volume) for specified period.`,
    schema: z.object({
      symbol: z.string().describe('Stock ticker symbol (e.g., RELIANCE, TCS)'),
      period: z
        .enum(['1d', '5d', '1mo', '3mo', '6mo', '1y', '5y', 'max'])
        .default('1y')
        .describe('Time period'),
      interval: z.enum(['1d', '1wk', '1mo']).default('1d').describe('Data interval'),
      exchange: z.string().optional().describe('Exchange suffix (e.g., NS, BO, L, TO). Defaults to NS.'),
    }),
  }
);

export const yahooFundamentalsTool = tool(
  async ({ symbol, dataType, exchange }: { symbol: string; dataType?: string; exchange?: string }) => {
    const normalizedSymbol = normalizeSymbol(symbol, exchange);

    const modules =
      dataType === 'all'
        ? [
          'assetProfile',
          'balanceSheetHistory',
          'incomeStatementHistory',
          'cashflowStatementHistory',
          'defaultKeyStatistics',
          'financialData',
        ]
        : dataType === 'balance-sheet'
          ? ['balanceSheetHistory', 'defaultKeyStatistics']
          : dataType === 'income-statement'
            ? ['incomeStatementHistory', 'defaultKeyStatistics']
            : ['cashflowStatementHistory', 'defaultKeyStatistics'];

    const quoteSummaryData = (await fetchYahooFinance(
      `/v10/finance/quoteSummary/${normalizedSymbol}?modules=${modules.join(',')}`,
      'unauth-then-auth-on-unauthorized'
    )) as {
      quoteSummary?: { result?: Array<Record<string, unknown>> };
    } | null;

    if (!quoteSummaryData?.quoteSummary?.result?.[0]) {
      const quoteFallbackData = await fetchYahooFinance(`/v7/finance/quote?symbols=${encodeURIComponent(normalizedSymbol)}`);
      const fallbackResult = mapQuoteFallbackFundamentals(normalizedSymbol, quoteFallbackData);

      if (fallbackResult) {
        return JSON.stringify(fallbackResult);
      }

      return unavailable(normalizedSymbol, 'yahoo_fundamentals');
    }

    const summary = quoteSummaryData.quoteSummary.result[0] as Record<string, unknown>;
    const result: FundamentalsResult = { symbol: normalizedSymbol };

    if (summary.defaultKeyStatistics) {
      const ks = summary.defaultKeyStatistics as Record<string, PrimitiveOrFmt>;
      result.keyMetrics = {
        marketCap: getValue(ks.marketCap),
        enterpriseValue: getValue(ks.enterpriseValue),
        peRatio: getValue(ks.trailingPE),
        forwardPE: getValue(ks.forwardPE),
        pegRatio: getValue(ks.pegRatio),
        pbRatio: getValue(ks.priceToBook),
        psRatio: getValue(ks.priceToSalesTrailing12Months),
        enterpriseToRevenue: getValue(ks.enterpriseToRevenue),
        enterpriseToEbitda: getValue(ks.enterpriseToEbitda),
        dividendYield: getValue(ks.dividendYield),
        beta: getValue(ks.beta),
      };
    }

    if (summary.financialData) {
      const fd = summary.financialData as Record<string, PrimitiveOrFmt>;
      result.ratios = {
        returnOnAssets: getValue(fd.returnOnAssets),
        returnOnEquity: getValue(fd.returnOnEquity),
        profitMargins: getValue(fd.profitMargins),
        operatingMargins: getValue(fd.operatingMargins),
        grossMargins: getValue(fd.grossMargins),
        debtToEquity: getValue(fd.debtToEquity),
        currentRatio: getValue(fd.currentRatio),
        quickRatio: getValue(fd.quickRatio),
        totalDebt: getValue(fd.totalDebt),
        operatingCashflow: getValue(fd.operatingCashflow),
        freeCashflow: getValue(fd.freeCashflow),
      };
    }

    return JSON.stringify(result);
  },
  {
    name: 'yahoo_fundamentals',
    description: `Get fundamental financial data for Indian (NSE/BSE) stocks.

Returns: Balance sheet, Income statement, Cash flow, Key ratios (P/E, P/B, ROE, etc.)`,
    schema: z.object({
      symbol: z.string().describe('Stock ticker symbol (e.g., RELIANCE, TCS)'),
      dataType: z
        .enum(['balance-sheet', 'income-statement', 'cashflow', 'all'])
        .default('all')
        .describe('Type of financial data'),
      exchange: z.string().optional().describe('Exchange suffix (e.g., NS, BO, L, TO). Defaults to NS.'),
    }),
  }
);

export const yahooOptionsTool = tool(
  async ({ symbol }: { symbol: string }) => {
    const normalizedSymbol = normalizeSymbol(symbol);

    const data = (await fetchYahooFinance(`/v7/finance/options/${normalizedSymbol}`)) as YahooOptionsResponse | null;

    if (!data?.optionChain?.result) {
      return unavailable(normalizedSymbol, 'yahoo_options');
    }

    const result = data.optionChain.result[0];
    const expirations = result.expirationDates;
    const options = result.options?.[0];

    if (!options) {
      return unavailable(normalizedSymbol, 'yahoo_options');
    }

    return JSON.stringify({
      symbol: normalizedSymbol,
      expirations: expirations?.map((d: number) => new Date(d * 1000).toISOString().split('T')[0]),
      calls: options.calls?.slice(0, 10).map((c: YahooOptionContract) => ({
        strike: c.strike,
        bid: c.bid,
        ask: c.ask,
        iv: c.impliedVolatility,
        volume: c.volume,
      })),
      puts: options.puts?.slice(0, 10).map((p: YahooOptionContract) => ({
        strike: p.strike,
        bid: p.bid,
        ask: p.ask,
        iv: p.impliedVolatility,
        volume: p.volume,
      })),
    });
  },
  {
    name: 'yahoo_options',
    description: `Get options chain data. Note: Options may not be available for Indian stocks.`,
    schema: z.object({
      symbol: z.string().describe('Stock ticker symbol (e.g., RELIANCE, TCS)'),
    }),
  }
);

export const yahooNewsTool = tool(
  async ({ symbol, limit }: { symbol: string; limit?: number }) => {
    const normalizedSymbol = normalizeSymbol(symbol);

    const data = (await fetchYahooFinance(`/v8/finance/quote/${normalizedSymbol}/news?count=${limit || 5}`)) as
      | YahooNewsItem[]
      | null;

    if (!Array.isArray(data)) {
      return unavailable(normalizedSymbol, 'yahoo_news');
    }

    return JSON.stringify({
      symbol: normalizedSymbol,
      news: data.map((item: YahooNewsItem) => ({
        title: item.title,
        summary: item.summary,
        url: item.url,
        publisher: item.publisher,
        timestamp: item.publishedAt,
      })),
    });
  },
  {
    name: 'yahoo_news',
    description: `Get latest news for Indian (NSE/BSE) stocks.`,
    schema: z.object({
      symbol: z.string().describe('Stock ticker symbol (e.g., RELIANCE, TCS)'),
      limit: z.number().optional().default(5).describe('Number of news items'),
    }),
  }
);

export const yahooIndexTool = tool(
  async ({ symbol }: { symbol: string }) => {
    let normalizedSymbol = symbol.toUpperCase();
    if (!normalizedSymbol.includes('^')) {
      normalizedSymbol = `^${normalizedSymbol}`;
    }

    const data = (await fetchYahooFinance(`/v8/finance/chart/${normalizedSymbol}?interval=1d&range=5d`)) as YahooChartResponse | null;

    if (!data?.chart?.result?.[0]) {
      return unavailable(normalizedSymbol, 'yahoo_index');
    }

    const result = data.chart.result[0];
    const meta = result.meta;

    return JSON.stringify({
      symbol: meta.symbol,
      name: meta.shortName || meta.longName,
      price: meta.regularMarketPrice,
      change: meta.regularMarketChange,
      changePercent: meta.regularMarketChangePercent,
      previousClose: meta.previousClose,
      '52WeekHigh': meta.fiftyTwoWeekHigh,
      '52WeekLow': meta.fiftyTwoWeekLow,
      volume: meta.regularMarketVolume,
    });
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

export const tools = [yahooQuoteTool, yahooHistoricalTool, yahooFundamentalsTool, yahooOptionsTool, yahooNewsTool, yahooIndexTool];

export default tools;
