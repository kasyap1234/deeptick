import { logger } from '../utils/logger.js';

export interface StockQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  peRatio?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  timestamp: Date;
}

export interface StockProfile {
  symbol: string;
  name: string;
  sector?: string;
  industry?: string;
  website?: string;
  description?: string;
  ceo?: string;
  employees?: number;
  headquarters?: string;
  founded?: number;
}

export interface FinancialMetrics {
  symbol: string;
  revenue?: number;
  revenueGrowth?: number;
  grossProfit?: number;
  operatingIncome?: number;
  netIncome?: number;
  totalAssets?: number;
  totalDebt?: number;
  shareholdersEquity?: number;
  freeCashFlow?: number;
  returnOnEquity?: number;
  returnOnAssets?: number;
  debtToEquity?: number;
  currentRatio?: number;
  quickRatio?: number;
}

export class StockDataService {
  private apiKey: string;
  private baseUrl: string = 'https://www.alphavantage.co/query';

  constructor() {
    // Use Alpha Vantage for stock data (free tier available)
    // Can be replaced with Polygon.io, Finnhub, or other providers
    this.apiKey = process.env.ALPHA_VANTAGE_API_KEY || 'demo';
  }

  async getQuote(symbol: string): Promise<StockQuote | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${this.apiKey}`
      );

      if (!response.ok) {
        throw new Error(`Stock API error: ${response.status}`);
      }

      const data = await response.json();
      const quote = data['Global Quote'];

      if (!quote) {
        return null;
      }

      return {
        symbol: quote['01. symbol'],
        price: parseFloat(quote['05. price']),
        change: parseFloat(quote['09. change']),
        changePercent: parseFloat(quote['10. change percent'].replace('%', '')),
        volume: parseInt(quote['06. volume']),
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error({ error }, 'Error fetching stock quote');
      return null;
    }
  }

  async getProfile(symbol: string): Promise<StockProfile | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}?function=OVERVIEW&symbol=${symbol}&apikey=${this.apiKey}`
      );

      if (!response.ok) {
        throw new Error(`Stock API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.Symbol) {
        return null;
      }

      return {
        symbol: data.Symbol,
        name: data.Name,
        sector: data.Sector,
        industry: data.Industry,
        website: data.Address,
        description: data.Description,
        ceo: data.CEO,
        employees: parseInt(data.Employees) || undefined,
        headquarters: `${data.Address}, ${data.City}, ${data.State}`,
        founded: parseInt(data.YearFounded) || undefined,
      };
    } catch (error) {
      logger.error({ error }, 'Error fetching stock profile');
      return null;
    }
  }

  async getFinancialMetrics(symbol: string): Promise<FinancialMetrics | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}?function=OVERVIEW&symbol=${symbol}&apikey=${this.apiKey}`
      );

      if (!response.ok) {
        throw new Error(`Stock API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.Symbol) {
        return null;
      }

      return {
        symbol: data.Symbol,
        revenue: this.parseMetric(data.RevenueTTM),
        revenueGrowth: this.parseMetric(data.RevenueGrowth),
        grossProfit: this.parseMetric(data.GrossProfitTTM),
        operatingIncome: this.parseMetric(data.OperatingIncomeTTM),
        netIncome: this.parseMetric(data.NetIncomeTTM),
        totalAssets: this.parseMetric(data.TotalAssets),
        totalDebt: this.parseMetric(data.TotalDebt),
        shareholdersEquity: this.parseMetric(data.ShareholderEquity),
        freeCashFlow: this.parseMetric(data.FreeCashFlow),
        returnOnEquity: this.parseMetric(data.ReturnOnEquityTTM),
        returnOnAssets: this.parseMetric(data.ReturnOnAssetsTTM),
        debtToEquity: this.parseMetric(data.DebtToEquity),
        currentRatio: this.parseMetric(data.CurrentRatio),
        quickRatio: this.parseMetric(data.QuickRatio),
      };
    } catch (error) {
      logger.error({ error }, 'Error fetching financial metrics');
      return null;
    }
  }

  async getIntradayPrices(symbol: string, interval: '1min' | '5min' | '15min' | '30min' | '60min' = '5min'): Promise<Array<{ timestamp: string; open: number; high: number; low: number; close: number; volume: number }>> {
    try {
      const response = await fetch(
        `${this.baseUrl}?function=TIME_SERIES_INTRADAY&symbol=${symbol}&interval=${interval}&apikey=${this.apiKey}`
      );

      if (!response.ok) {
        throw new Error(`Stock API error: ${response.status}`);
      }

      const data = await response.json();
      const timeSeriesKey = `Time Series (${interval})`;
      const timeSeries = data[timeSeriesKey];

      if (!timeSeries) {
        return [];
      }

      return Object.entries(timeSeries)
        .map(([timestamp, values]: [string, any]) => ({
          timestamp,
          open: parseFloat(values['1. open']),
          high: parseFloat(values['2. high']),
          low: parseFloat(values['3. low']),
          close: parseFloat(values['4. close']),
          volume: parseInt(values['5. volume']),
        }))
        .slice(0, 100); // Return last 100 data points
    } catch (error) {
      logger.error({ error }, 'Error fetching intraday prices');
      return [];
    }
  }

  async searchSymbol(keywords: string): Promise<Array<{ symbol: string; name: string; type: string; region: string }>> {
    try {
      const response = await fetch(
        `${this.baseUrl}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(keywords)}&apikey=${this.apiKey}`
      );

      if (!response.ok) {
        throw new Error(`Stock API error: ${response.status}`);
      }

      const data = await response.json();
      const matches = data.bestMatches || [];

      return matches.map((match: any) => ({
        symbol: match['1. symbol'],
        name: match['2. name'],
        type: match['3. type'],
        region: match['4. region'],
      }));
    } catch (error) {
      logger.error({ error }, 'Error searching symbols');
      return [];
    }
  }

  async getNews(symbol: string, limit: number = 10): Promise<Array<{ title: string; url: string; source: string; summary: string; timestamp: string }>> {
    try {
      const response = await fetch(
        `${this.baseUrl}?function=NEWS_SENTIMENT&tickers=${symbol}&limit=${limit}&apikey=${this.apiKey}`
      );

      if (!response.ok) {
        throw new Error(`Stock API error: ${response.status}`);
      }

      const data = await response.json();
      const feed = data.feed || [];

      return feed.map((item: any) => ({
        title: item.title,
        url: item.url,
        source: item.source,
        summary: item.summary,
        timestamp: item.time_published,
      }));
    } catch (error) {
      logger.error({ error }, 'Error fetching news');
      return [];
    }
  }

  formatQuoteForDisplay(quote: StockQuote): string {
    const changeSign = quote.change >= 0 ? '+' : '';
    return `${quote.symbol}: $${quote.price.toFixed(2)} (${changeSign}${quote.change.toFixed(2)}, ${changeSign}${quote.changePercent.toFixed(2)}%)`;
  }

  formatMetricsForDisplay(metrics: FinancialMetrics): string {
    const parts: string[] = [];
    
    if (metrics.revenue) parts.push(`Revenue: $${this.formatNumber(metrics.revenue)}`);
    if (metrics.netIncome) parts.push(`Net Income: $${this.formatNumber(metrics.netIncome)}`);
    if (metrics.returnOnEquity) parts.push(`ROE: ${(metrics.returnOnEquity * 100).toFixed(1)}%`);
    if (metrics.debtToEquity) parts.push(`D/E: ${metrics.debtToEquity.toFixed(2)}`);
    if (metrics.freeCashFlow) parts.push(`FCF: $${this.formatNumber(metrics.freeCashFlow)}`);

    return parts.join(' | ');
  }

  private parseMetric(value: string): number | undefined {
    if (!value || value === 'None' || value === 'null') return undefined;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? undefined : parsed;
  }

  private formatNumber(num: number): string {
    if (num >= 1e12) return (num / 1e12).toFixed(2) + 'T';
    if (num >= 1e9) return (num / 1e9).toFixed(2) + 'B';
    if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
    return num.toFixed(2);
  }
}

export const stockDataService = new StockDataService();
