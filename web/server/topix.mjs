import fs from 'node:fs';
import path from 'node:path';

const fsp = fs.promises;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function safeNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

const BOJ_TANKAN_DEFAULT_URL = 'https://www.stat-search.boj.or.jp/ssi/mtshtml/csv/co_q_1.csv';
const TANKAN_SERIES_COLUMNS = {
  large_manufacturing_actual: 'D.I./業況/大企業/製造業/実績',
  large_manufacturing_forecast: 'D.I./業況/大企業/製造業/予測',
  large_nonmanufacturing_actual: 'D.I./業況/大企業/非製造業/実績',
  large_nonmanufacturing_forecast: 'D.I./業況/大企業/非製造業/予測',
  medium_manufacturing_actual: 'D.I./業況/中堅企業/製造業/実績',
  medium_manufacturing_forecast: 'D.I./業況/中堅企業/製造業/予測',
  medium_nonmanufacturing_actual: 'D.I./業況/中堅企業/非製造業/実績',
  medium_nonmanufacturing_forecast: 'D.I./業況/中堅企業/非製造業/予測',
  small_manufacturing_actual: 'D.I./業況/中小企業/製造業/実績',
  small_manufacturing_forecast: 'D.I./業況/中小企業/製造業/予測',
  small_nonmanufacturing_actual: 'D.I./業況/中小企業/非製造業/実績',
  small_nonmanufacturing_forecast: 'D.I./業況/中小企業/非製造業/予測',
};

async function ensureDirExists(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', 'Z');
}

async function appendLog(logPath, message) {
  try {
    await ensureDirExists(path.dirname(logPath));
    const line = `[${timestamp()}] ${message}\\n`;
    await fsp.appendFile(logPath, line, 'utf8');
  } catch (error) {
    console.error('topix log append failed:', error?.message || error);
  }
}

function parseCsvLine(line) {
  const out = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((cell) => cell.replace(/^\"|\"$/g, '').trim());
}

function monthKeyFromDate(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();
  if (str.length >= 7 && str[4] === '-') return str.slice(0, 7);
  if (/^\d{8}$/.test(str)) return `${str.slice(0, 4)}-${str.slice(4, 6)}`;
  if (/^\d{6}$/.test(str)) return `${str.slice(0, 4)}-${str.slice(4, 6)}`;
  return null;
}

function normalizePeriodToMonth(period) {
  if (!period) return null;
  const raw = String(period).trim();
  if (!raw) return null;
  if (raw.length >= 7 && raw[4] === '-') {
    if (raw.length >= 10) return raw.slice(0, 7);
    return raw;
  }
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
  if (/^\d{6}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
  if (/^\d{4}\/\d{1,2}$/.test(raw)) {
    const [y, m] = raw.split('/');
    return `${y}-${String(Number.parseInt(m, 10)).padStart(2, '0')}`;
  }
  if (/^\d{4}Q[1-4]$/i.test(raw)) {
    const year = raw.slice(0, 4);
    const q = Number.parseInt(raw.slice(5), 10);
    const month = (q - 1) * 3 + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  }
  if (/^\d{4}\/\d{1,2}-\d{1,2}$/.test(raw)) {
    const [year, range] = raw.split('/');
    const first = range.split('-')[0];
    return `${year}-${String(Number.parseInt(first, 10)).padStart(2, '0')}`;
  }
  return null;
}

function isoDateFromMonth(month) {
  return `${month}-01`;
}

function collapseDailyToMonthly(series) {
  const latest = new Map();
  for (const entry of toArray(series)) {
    const month = monthKeyFromDate(entry?.date);
    const value = safeNumber(entry?.value ?? entry?.close ?? entry?.Close);
    if (!month || value === null) continue;
    const dateStr = String(entry.date ?? '');
    const current = latest.get(month);
    if (!current || dateStr > current.date) {
      latest.set(month, { date: dateStr, value });
    }
  }
  const out = new Map();
  for (const [month, info] of latest.entries()) {
    out.set(month, info.value);
  }
  return out;
}

function seriesToMonthlyMap(series) {
  const map = new Map();
  const sorted = toArray(series)
    .map((entry) => {
      const dateKey = entry?.date ?? entry?.time ?? entry?.TIME ?? entry?.['@time'] ?? entry?.period;
      const month = normalizePeriodToMonth(dateKey);
      const valueRaw = entry?.value ?? entry?.val ?? entry?.score ?? entry?.['$'] ?? entry?.['@value'];
      const value = safeNumber(valueRaw);
      return { month, value };
    })
    .filter((row) => row.month && row.value !== null)
    .sort((a, b) => a.month.localeCompare(b.month));
  for (const { month, value } of sorted) {
    map.set(month, value);
  }
  return map;
}

function mergeMonthKeys(maps) {
  const set = new Set();
  for (const map of maps) {
    if (!map) continue;
    for (const key of map.keys()) set.add(key);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

async function readJsonFile(filePath) {
  try {
    const text = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

async function writeJsonFile(filePath, data) {
  await ensureDirExists(path.dirname(filePath));
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function fetchBojTankanSeries(source) {
  const seriesKey = source?.series || 'large_manufacturing_actual';
  const columnName = TANKAN_SERIES_COLUMNS[seriesKey];
  if (!columnName) throw new Error(`Unsupported BOJ tankan series: ${seriesKey}`);
  const url = source?.url || BOJ_TANKAN_DEFAULT_URL;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/csv,application/octet-stream,*/*;q=0.8',
    },
  });
  if (!res.ok) throw new Error(`BOJ tankan CSV HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  let csvText;
  try {
    const decoder = new TextDecoder('shift_jis');
    csvText = decoder.decode(buffer);
  } catch {
    csvText = buffer.toString('utf8');
  }
  const lines = csvText.split(/\r?\n/);
  let header = null;
  let columnIndex = -1;
  const out = [];
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const cells = parseCsvLine(rawLine);
    const firstCell = cells[0]?.replace(/^\"|\"$/g, '').trim();
    if (!firstCell) continue;
    if (firstCell.includes('系列名称')) {
      header = cells.map((cell) => cell.replace(/^\"|\"$/g, '').trim());
      columnIndex = header.findIndex((value) => value === columnName);
      if (columnIndex === -1) throw new Error(`BOJ tankan column not found: ${columnName}`);
      continue;
    }
    if (!header) continue;
    if (/^(データコード|単位|収録開始期|収録終了期|最終更新日)/.test(firstCell)) continue;
    if (!/^\d{4}\/\d{2}$/.test(firstCell)) continue;
    const valueRaw = cells[columnIndex] ?? '';
    const value = safeNumber(valueRaw?.replace(/^\"|\"$/g, ''));
    out.push({ date: firstCell, value });
  }
  return out;
}

export function createTopixModule(options) {
  const {
    fetchJson,
    buildEstatUrl,
    ESTAT_APP_ID,
    fetchFredCSV,
    setCache,
    getCache,
    configPath,
    dataDir,
    historyPath,
    latestPath,
    logPath,
    historyCacheKey,
    latestCacheKey,
    refreshTtl,
  } = options;

  const predictionsPath = path.join(dataDir, 'predictions.json');
  let configCache = null;
  let refreshPromise = null;

  async function loadConfig() {
    if (configCache) return configCache;
    const json = await readJsonFile(configPath);
    if (!json) {
      await appendLog(logPath, 'topix config not found or invalid.');
      return null;
    }
    configCache = json;
    return json;
  }

  async function fetchStooqDailySeries(source) {
    const symbol = source?.symbol;
    if (!symbol) return [];
    const interval = source?.interval ?? 'd';
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol.toLowerCase())}&i=${encodeURIComponent(interval)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`stooq ${symbol} HTTP ${res.status}`);
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/);
    lines.shift();
    const out = [];
    for (const line of lines) {
      if (!line) continue;
      const parts = line.split(',');
      const date = parts[0];
      const close = safeNumber(parts[4]);
      if (!date || close === null) continue;
      out.push({ date, value: close });
    }
    return out;
  }

  async function fetchYahooDailySeries(source) {
    const symbol = source?.symbol;
    if (!symbol) return [];
    const range = source?.range ?? '5y';
    const interval = source?.interval ?? '1d';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false&events=div%2Csplits`;
    const json = await fetchJson(url);
    const result = json?.chart?.result?.[0];
    if (!result || !Array.isArray(result.timestamp)) return [];
    const timestamps = result.timestamp;
    const quote = toArray(result.indicators?.quote)[0] || {};
    const closes = quote.close || [];
    const out = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      const ts = timestamps[i];
      const close = safeNumber(closes[i]);
      if (!Number.isFinite(ts) || close === null) continue;
      const date = new Date(ts * 1000).toISOString().slice(0, 10);
      out.push({ date, value: close });
    }
    return out;
  }

  async function fetchEstatSeries(source) {
    if (!ESTAT_APP_ID) throw new Error('ESTAT_APP_ID is required');
    const statsDataId = source?.statsDataId;
    if (!statsDataId) throw new Error('e-Stat source requires statsDataId');
    const params = {
      appId: ESTAT_APP_ID,
      statsDataId,
      metaGetFlg: 'N',
      cntGetFlg: 'N',
      sectionHeaderFlg: '2',
      startPosition: '1',
      limit: String(source?.limit ?? 600),
    };
    if (source?.cat01) params.cdCat01 = source.cat01;
    if (source?.cat02) params.cdCat02 = source.cat02;
    if (source?.cat03) params.cdCat03 = source.cat03;
    if (source?.tab) params.cdTab = source.tab;
    if (source?.area) params.cdArea = source.area;
    if (source?.timeFrom) params.cdTimeFrom = source.timeFrom;
    if (source?.timeTo) params.cdTimeTo = source.timeTo;

    const json = await fetchJson(buildEstatUrl('getStatsData', params));
    const values = toArray(json?.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE);
    return values
      .map((entry) => {
        const dateKey = entry?.['@time'] ?? entry?.TIME ?? entry?.time ?? entry?.['@timeFrom'];
        const value = safeNumber(entry?.['$'] ?? entry?.['@value'] ?? entry?.value);
        return { date: dateKey, value };
      })
      .filter((row) => row.date && row.value !== null);
  }

  async function fetchFredSeries(source) {
    const seriesId = source?.seriesId;
    if (!seriesId || !fetchFredCSV) return [];
    const rows = await fetchFredCSV(seriesId);
    return rows.map((row) => ({ date: row.date, value: safeNumber(row.value) })).filter((row) => row.value !== null);
  }

  async function fetchIndicatorSeries(name, source) {
    if (!source) return [];
    const type = String(source.type || '').toLowerCase();
    if (type === 'stooq') return fetchStooqDailySeries(source);
    if (type === 'yahoo') return fetchYahooDailySeries(source);
    if (type === 'estat') return fetchEstatSeries(source);
    if (type === 'fred') return fetchFredSeries(source);
    if (type === 'boj_tankan') return fetchBojTankanSeries(source);
    throw new Error(`Unsupported source type for ${name}: ${type}`);
  }

  function computeHistory(months, actualMap, indicatorMaps, weights, trendCfg) {
    const weightKeys = Object.keys(weights || {}).filter((key) => key !== 'intercept');
    const indicatorNames = Object.keys(indicatorMaps || {});
    const lastIndicators = {};
    indicatorNames.forEach((name) => {
      lastIndicators[name] = null;
    });

    const history = [];
    const theoreticalSeries = [];
    const intercept = Number(weights?.intercept ?? 0);

    for (const month of months) {
      const actual = safeNumber(actualMap.get(month));
      const snapshot = {};
      const missingIndicatorInputs = new Set();

      for (const name of indicatorNames) {
        const map = indicatorMaps[name];
        if (map?.has(month)) {
          const val = safeNumber(map.get(month));
          if (val !== null) {
            lastIndicators[name] = val;
          }
        }
        snapshot[name] = lastIndicators[name];
        if (snapshot[name] === null || snapshot[name] === undefined) {
          missingIndicatorInputs.add(name);
        }
      }

      let theoretical = null;
      const missingForModel = new Set();
      if (weightKeys.length === 0) {
        if (Number.isFinite(intercept)) theoretical = intercept;
      } else if (Number.isFinite(intercept)) {
        let total = intercept;
        let ok = true;
        for (const key of weightKeys) {
          const val = snapshot[key];
          if (val === null || val === undefined || !Number.isFinite(val)) {
            missingForModel.add(key);
            ok = false;
            break;
          }
          total += (Number(weights[key]) || 0) * val;
        }
        if (ok && Number.isFinite(total)) theoretical = total;
      }

      const missingIndicators = Array.from(new Set([
        ...Array.from(missingIndicatorInputs),
        ...Array.from(missingForModel),
      ])).sort();

      const diff = theoretical !== null && actual !== null ? actual - theoretical : null;
      const entry = {
        date: isoDateFromMonth(month),
        actual,
        theoretical,
        diff,
        indicators: { ...snapshot },
        missingIndicators,
        trend: 'FLAT',
        trendClass: 0,
        trendScore: null,
        month,
      };
      history.push(entry);
      if (theoretical !== null) {
        theoreticalSeries.push({ month, value: theoretical });
      }
    }

    const window = Math.max(1, Number(trendCfg?.windowMonths ?? 3));
    const threshold = Number(trendCfg?.threshold ?? 0);
    const trendMap = new Map();
    for (let i = 0; i < theoreticalSeries.length; i += 1) {
      if (i < window) continue;
      const current = theoreticalSeries[i];
      const prev = theoreticalSeries[i - window];
      const delta = current.value - prev.value;
      let cls = 0;
      let score = null;
      if (Number.isFinite(delta)) {
        score = delta;
        if (Math.abs(delta) > threshold) {
          cls = delta > 0 ? 1 : -1;
        }
      }
      trendMap.set(current.month, { cls, score });
    }

    let lastClass = 0;
    for (const entry of history) {
      if (entry.theoretical == null) {
        entry.trendClass = null;
        entry.trendScore = null;
        entry.trend = 'UNKNOWN';
      } else {
        const info = trendMap.get(entry.month);
        if (info) {
          entry.trendClass = info.cls;
          entry.trendScore = info.score;
          lastClass = info.cls;
        } else {
          entry.trendClass = lastClass;
          entry.trendScore = null;
        }
        entry.trend = entry.trendClass > 0 ? 'UP' : entry.trendClass < 0 ? 'DOWN' : 'FLAT';
      }
      delete entry.month;
    }

    const latest = [...history].reverse().find((row) => row.actual !== null) || history[history.length - 1] || null;
    return { history, latest };
  }

  async function refreshTopixData(reason = 'auto') {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      if (reason === 'manual') configCache = null;
      const config = await loadConfig();
      if (!config) throw new Error('TOPIX config unavailable');
      await ensureDirExists(dataDir);
      await ensureDirExists(path.dirname(logPath));
      const sources = config.sources || {};
      if (!sources.topix) throw new Error('TOPIX price source not configured');

      const [topixDaily, tankanSeries, longRateSeries, cpiSeries, fxSeries] = await Promise.all([
        fetchIndicatorSeries('topix', sources.topix),
        fetchIndicatorSeries('tankan_di', sources.tankan_di).catch((error) => {
          appendLog(logPath, `tankan_di fetch failed: ${error?.message || error}`);
          return [];
        }),
        fetchIndicatorSeries('long_term_rate', sources.long_term_rate).catch((error) => {
          appendLog(logPath, `long_term_rate fetch failed: ${error?.message || error}`);
          return [];
        }),
        fetchIndicatorSeries('cpi', sources.cpi).catch((error) => {
          appendLog(logPath, `cpi fetch failed: ${error?.message || error}`);
          return [];
        }),
        fetchIndicatorSeries('usd_jpy', sources.usd_jpy).catch((error) => {
          appendLog(logPath, `usd_jpy fetch failed: ${error?.message || error}`);
          return [];
        }),
      ]);

      const actualMap = collapseDailyToMonthly(topixDaily);
      const indicatorMaps = {
        tankan_di: seriesToMonthlyMap(tankanSeries),
        long_term_rate: seriesToMonthlyMap(longRateSeries),
        cpi: seriesToMonthlyMap(cpiSeries),
        usd_jpy: collapseDailyToMonthly(fxSeries),
      };

      const months = mergeMonthKeys([actualMap, ...Object.values(indicatorMaps)]);
      if (months.length === 0) throw new Error('No TOPIX data points available');

      const { history, latest } = computeHistory(months, actualMap, indicatorMaps, config.weights || {}, config.trend || {});
      const generatedAt = Date.now();
      const payload = {
        history,
        meta: {
          weights: config.weights || {},
          trend: config.trend || {},
          sources,
          updatedAt: generatedAt,
          rows: history.length,
        },
      };
      await writeJsonFile(historyPath, payload);
      setCache(historyCacheKey, payload, refreshTtl);

      const latestPayload = {
        data: latest,
        indicators: latest?.indicators || {},
        updatedAt: generatedAt,
        config: {
          weights: config.weights || {},
          trend: config.trend || {},
        },
      };
      await writeJsonFile(latestPath, latestPayload);
      setCache(latestCacheKey, latestPayload, Math.max(1, Math.floor(refreshTtl / 2)));

      const predictionsPayload = {
        generatedAt,
        latest,
        history,
        meta: payload.meta,
      };
      await writeJsonFile(predictionsPath, predictionsPayload);

      await appendLog(logPath, `[${reason}] TOPIX dataset updated (${history.length} rows)`);
      return payload;
    })().catch(async (error) => {
      await appendLog(logPath, `[${reason}] TOPIX refresh failed: ${error?.message || error}`);
      throw error;
    }).finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  }

  async function getTopixHistory() {
    const cached = getCache(historyCacheKey);
    if (cached) return cached;
    const fromDisk = await readJsonFile(historyPath);
    if (fromDisk) {
      setCache(historyCacheKey, fromDisk, refreshTtl);
      return fromDisk;
    }
    return refreshTopixData('cache-miss');
  }

  async function getTopixLatest() {
    const cached = getCache(latestCacheKey);
    if (cached) return cached;
    const fromDisk = await readJsonFile(latestPath);
    if (fromDisk) {
      setCache(latestCacheKey, fromDisk, Math.max(1, Math.floor(refreshTtl / 2)));
      return fromDisk;
    }
    await refreshTopixData('latest-miss');
    return getTopixLatest();
  }

  async function getTopixLogs(tail = 200) {
    try {
      const text = await fsp.readFile(logPath, 'utf8');
      const lines = text.trimEnd().split(/\r?\n/);
      if (!tail || tail <= 0) return lines;
      return lines.slice(-tail);
    } catch (error) {
      return [];
    }
  }

  function scheduleTopixRefresh() {
    refreshTopixData('startup').catch(() => {});
    setInterval(() => {
      refreshTopixData('interval').catch(() => {});
    }, refreshTtl);
  }

  return {
    refreshTopixData,
    getTopixHistory,
    getTopixLatest,
    getTopixLogs,
    scheduleTopixRefresh,
  };
}
