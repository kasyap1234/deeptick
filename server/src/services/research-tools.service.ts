import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
const TOOL_FETCH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOOL_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

const stockInfoSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol (e.g., AAPL, NVDA, MSFT)'),
});

const newsSearchSchema = z.object({
  query: z.string().describe('Search query for news'),
  limit: z.number().optional().default(10).describe('Number of results to return'),
});

const financialDataSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol'),
  dataType: z.enum(['income', 'balance', 'cashflow', 'ratios']).describe('Type of financial data'),
});

const technicalAnalysisSchema = z.object({
  symbol: z.string().describe('Stock ticker symbol'),
  indicator: z.enum(['sma', 'ema', 'rsi', 'macd', 'bollinger']).describe('Technical indicator to calculate'),
  period: z.number().optional().default(20).describe('Number of periods for calculation'),
});

async function getStockInfo(symbol: string): Promise<string> {
  try {
    if (!config.alphaVantageApiKey) {
      return JSON.stringify({ error: 'Alpha Vantage API key not configured' });
    }

    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${config.alphaVantageApiKey}`;
    const response = await fetchWithTimeout(url);
    const data = await response.json() as Record<string, unknown>;

    const quote = data['Global Quote'] as Record<string, string> | undefined;
    if (!quote || Object.keys(quote).length === 0) {
      return JSON.stringify({ error: 'No data found for symbol', symbol });
    }

    return JSON.stringify({
      symbol: quote['01. symbol'],
      price: quote['05. price'],
      volume: quote['06. volume'],
      change: quote['09. change'],
      changePercent: quote['10. change percent'],
      high: quote['03. high'],
      low: quote['04. low'],
      open: quote['02. open'],
      previousClose: quote['08. previous close'],
    });
  } catch (error) {
    logger.error({ error, symbol }, 'Failed to fetch stock info');
    return JSON.stringify({ error: 'Failed to fetch stock info' });
  }
}

async function searchNews(query: string, limit: number = 10): Promise<string> {
  try {
    const exaKey = config.exaApiKey;
    if (!exaKey) {
      return JSON.stringify({ error: 'Exa API key not configured' });
    }

    const url = 'https://api.exa.ai/search';
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${exaKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DeepTick/1.0',
      },
      body: JSON.stringify({
        query,
        num_results: limit,
        type: 'news',
        category: 'finance',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Exa API error: ${error}`);
    }

    const data = await response.json() as {
      results: Array<{ title: string; url: string; published_date: string; snippet: string }>;
    };

    return JSON.stringify({
      count: data.results.length,
      results: data.results.map(r => ({
        title: r.title,
        url: r.url,
        date: r.published_date,
        snippet: r.snippet,
      })),
    });
  } catch (error) {
    logger.error({ error, query }, 'Failed to search news');
    return JSON.stringify({ error: 'Failed to search news' });
  }
}

async function getFinancialData(symbol: string, dataType: string): Promise<string> {
  try {
    if (!config.alphaVantageApiKey) {
      return JSON.stringify({ error: 'Alpha Vantage API key not configured' });
    }

    const functions: Record<string, string> = {
      income: 'INCOME_STATEMENT',
      balance: 'BALANCE_SHEET',
      cashflow: 'CASH_FLOW',
      ratios: 'OVERVIEW',
    };

    const url = `https://www.alphavantage.co/query?function=${functions[dataType]}&symbol=${symbol}&apikey=${config.alphaVantageApiKey}`;
    const response = await fetchWithTimeout(url);
    const data = await response.json() as Record<string, unknown>;

    if (data['Note'] || data['Information']) {
      return JSON.stringify({ error: 'API rate limit exceeded', symbol, dataType });
    }

    return JSON.stringify(data);
  } catch (error) {
    logger.error({ error, symbol, dataType }, 'Failed to fetch financial data');
    return JSON.stringify({ error: 'Failed to fetch financial data' });
  }
}

async function getTechnicalAnalysis(symbol: string, indicator: string, period: number): Promise<string> {
  try {
    if (!config.alphaVantageApiKey) {
      return JSON.stringify({ error: 'Alpha Vantage API key not configured' });
    }

    const indicators: Record<string, string> = {
      sma: 'SMA',
      ema: 'EMA',
      rsi: 'RSI',
      macd: 'MACD',
      bollinger: 'BBANDS',
    };

    const url = `https://www.alphavantage.co/query?function=${indicators[indicator]}&symbol=${symbol}&interval=daily&time_period=${period}&series_type=close&apikey=${config.alphaVantageApiKey}`;
    const response = await fetchWithTimeout(url);
    const data = await response.json() as Record<string, unknown>;

    if (data['Note'] || data['Information']) {
      return JSON.stringify({ error: 'API rate limit exceeded', symbol, indicator });
    }

    return JSON.stringify({ symbol, indicator, period, data });
  } catch (error) {
    logger.error({ error, symbol, indicator, period }, 'Failed to fetch technical analysis');
    return JSON.stringify({ error: 'Failed to fetch technical analysis' });
  }
}

export function createResearchTools() {
  const tools: DynamicStructuredTool[] = [];

  tools.push(
    new DynamicStructuredTool({
      name: 'get_stock_info',
      description: 'Get current stock price and trading data for a given symbol. Use this to get real-time or latest trading information.',
      schema: stockInfoSchema,
      func: async ({ symbol }) => getStockInfo(symbol.toUpperCase()),
    }),
    new DynamicStructuredTool({
      name: 'search_financial_news',
      description: 'Search for recent financial news about a company or topic. Use this to get the latest news and developments.',
      schema: newsSearchSchema,
      func: async ({ query, limit }) => searchNews(query, limit),
    }),
    new DynamicStructuredTool({
      name: 'get_financial_statements',
      description: 'Get financial statement data (income statement, balance sheet, cash flow) for a company. Use this for deep financial analysis.',
      schema: financialDataSchema,
      func: async ({ symbol, dataType }) => getFinancialData(symbol.toUpperCase(), dataType),
    }),
    new DynamicStructuredTool({
      name: 'get_technical_indicators',
      description: 'Calculate technical analysis indicators (SMA, EMA, RSI, MACD, Bollinger Bands) for a stock. Use this for technical trading signals.',
      schema: technicalAnalysisSchema,
      func: async ({ symbol, indicator, period }) => getTechnicalAnalysis(symbol.toUpperCase(), indicator, period),
    })
  );

  return tools;
}
