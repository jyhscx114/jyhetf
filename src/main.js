import { init as initChart, use } from "echarts/core";
import { CandlestickChart, LineChart } from "echarts/charts";
import {
  AxisPointerComponent,
  GridComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import "./style.css";

use([
  CandlestickChart,
  LineChart,
  AxisPointerComponent,
  GridComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const MARKET_DATE = "2026-11-24";
const QUOTE_INTERVAL = 10_000;
const KLINE_INTERVAL = 30_000;

const STOCKS = [
  { code: "000338", name: "潍柴动力", weight: 0.175, sector: "动力装备" },
  { code: "603308", name: "应流股份", weight: 0.175, sector: "高端制造" },
  { code: "002518", name: "科士达", weight: 0.01, sector: "数据中心" },
  { code: "002028", name: "思源电气", weight: 0.1, sector: "电力设备" },
  { code: "600885", name: "宏发股份", weight: 0.01, sector: "电子元件" },
  { code: "600183", name: "生益科技", weight: 0.01, sector: "覆铜板" },
  { code: "603986", name: "兆易创新", weight: 0.01, sector: "存储芯片" },
  { code: "002371", name: "北方华创", weight: 0.08, sector: "半导体设备" },
  { code: "600584", name: "长电科技", weight: 0.12, sector: "半导体封测" },
  { code: "301269", name: "华大九天", weight: 0.175, sector: "EDA软件" },
  { code: "002837", name: "英维克", weight: 0.01, sector: "液冷温控" },
  { code: "002475", name: "立讯精密", weight: 0.1, sector: "消费电子" },
  { code: "002916", name: "深南电路", weight: 0.01, sector: "PCB" },
  { code: "002463", name: "沪电股份", weight: 0.015, sector: "PCB" },
].map((stock) => ({
  ...stock,
  secid: `${stock.code.startsWith("6") ? "1" : "0"}.${stock.code}`,
}));

const COLORS = {
  up: "#ff6678",
  down: "#35d6a0",
  flat: "#c7cec8",
  text: "#f4f3ec",
  muted: "#8f9d92",
  grid: "rgba(216, 230, 218, 0.08)",
  axis: "rgba(216, 230, 218, 0.12)",
  gold: "#d9f99d",
  ma5: "#f4c76b",
  ma10: "#7bd8ff",
};

const state = {
  stocks: [],
  candles: [],
  dailyCandles: [],
  quotes: new Map(),
  snapshot: null,
  period: 1,
  chart: null,
  dailyChart: null,
  connection: "loading",
  lastQuoteAt: null,
  quoteCoverage: 0,
  lastKlineAt: 0,
  quoteTicking: false,
  klineTicking: false,
};

const el = {
  marketState: document.querySelector("#marketState"),
  marketClock: document.querySelector("#marketClock"),
  statusDot: document.querySelector("#statusDot"),
  livePill: document.querySelector("#livePill"),
  liveLabel: document.querySelector("#liveLabel"),
  navValue: document.querySelector("#navValue"),
  returnChip: document.querySelector("#returnChip"),
  dayHigh: document.querySelector("#dayHigh"),
  dayLow: document.querySelector("#dayLow"),
  turnover: document.querySelector("#turnover"),
  chart: document.querySelector("#intradayChart"),
  dailyChart: document.querySelector("#dailyChart"),
  dailyCurrentNav: document.querySelector("#dailyCurrentNav"),
  dailyRangeLabel: document.querySelector("#dailyRangeLabel"),
  chartLoading: document.querySelector("#chartLoading"),
  chartError: document.querySelector("#chartError"),
  chartErrorMessage: document.querySelector("#chartErrorMessage"),
  retryButton: document.querySelector("#retryButton"),
  lastUpdated: document.querySelector("#lastUpdated"),
  dataCoverage: document.querySelector("#dataCoverage"),
  breadthText: document.querySelector("#breadthText"),
  breadthBar: document.querySelector("#breadthBar"),
  breadthFill: document.querySelector("#breadthFill"),
  weightStrip: document.querySelector("#weightStrip"),
  contributionList: document.querySelector("#contributionList"),
  holdingsBody: document.querySelector("#holdingsBody"),
};

function getShanghaiParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function getMarketPhase() {
  const parts = getShanghaiParts();
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minute = Number(parts.hour) * 60 + Number(parts.minute);

  if (date < MARKET_DATE) return "not-open";
  if (date > MARKET_DATE) return "closed";
  if (minute >= 555 && minute < 570) return "auction";
  if ((minute >= 570 && minute <= 690) || (minute >= 780 && minute <= 900)) {
    return "trading";
  }
  if (minute > 690 && minute < 780) return "lunch";
  if (minute > 900) return "closed";
  return "not-open";
}

function isTradingSession() {
  return getMarketPhase() === "trading";
}

function updateClock() {
  const parts = getShanghaiParts();
  el.marketClock.textContent = `${parts.hour}:${parts.minute}:${parts.second}`;
  renderMarketStatus();
}

function renderMarketStatus() {
  const phase = getMarketPhase();
  el.liveLabel.textContent =
    state.connection === "live" && phase === "trading"
      ? "实时"
      : state.connection === "loading"
        ? "连接中"
        : state.connection === "error"
          ? "异常"
        : phase === "closed"
          ? "已收盘"
          : "延迟";

  if (state.connection === "loading") {
    el.marketState.textContent = "正在连接行情";
    el.statusDot.className = "status-dot is-loading";
    return;
  }

  if (state.connection === "error") {
    el.marketState.textContent = "行情连接失败";
    el.statusDot.className = "status-dot is-error";
    return;
  }

  if (state.connection === "delayed") {
    el.marketState.textContent = `部分行情延迟 ${state.quoteCoverage}/14`;
    el.statusDot.className = "status-dot is-delayed";
    return;
  }

  const labels = {
    auction: "集合竞价",
    trading: "交易中",
    lunch: "午间休市",
    closed: "今日收盘",
    "not-open": "未开盘",
  };
  el.marketState.textContent = labels[phase];
  el.statusDot.className = `status-dot ${phase === "trading" ? "is-live" : "is-closed"}`;
}

function setConnection(connection) {
  state.connection = connection;
  el.livePill.classList.toggle("is-paused", connection !== "live");
  renderMarketStatus();
}

function quoteBatchUrl() {
  const codes = STOCKS.map(
    (stock) => `${stock.secid.startsWith("1") ? "sh" : "sz"}${stock.code}`,
  ).join(",");
  return `https://qt.gtimg.cn/q=${codes}`;
}

async function settleWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (error) {
        results[index] = { status: "rejected", reason: error };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );
  return results;
}

function fetchKline(stock) {
  return new Promise((resolve, reject) => {
    const variable = `__jyh_kline_${stock.code}`;
    const params = new URLSearchParams({
      symbol: `${stock.secid.startsWith("1") ? "sh" : "sz"}${stock.code}`,
      scale: "1",
      ma: "no",
      datalen: "300",
    });
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      script.remove();
      window[variable] = undefined;
      reject(new Error(`${stock.name} 分时行情加载超时`));
    }, 15_000);

    script.async = true;
    script.src =
      `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20${variable}=/` +
      `CN_MarketDataService.getKLineData?${params}`;
    script.onload = () => {
      window.clearTimeout(timeout);
      const rows = window[variable];
      script.remove();
      window[variable] = undefined;

      if (!Array.isArray(rows) || rows.length === 0) {
        reject(new Error(`${stock.name} 今日暂无分时行情`));
        return;
      }

      const series = rows
        .filter((row) => row.day.startsWith(MARKET_DATE))
        .map((row) => ({
          time: row.day.slice(11, 16),
          open: Number(row.open),
          close: Number(row.close),
          high: Number(row.high),
          low: Number(row.low),
          amount: Number(row.amount),
        }));

      if (series.length === 0) {
        reject(new Error(`${stock.name} 今日暂无分时行情`));
        return;
      }

      const openPrice = series[0].open;
      if (!Number.isFinite(openPrice) || openPrice <= 0) {
        reject(new Error(`${stock.name} 开盘价无效`));
        return;
      }

      resolve({
        ...stock,
        openPrice,
        series,
        latestKline: series.at(-1),
      });
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      window[variable] = undefined;
      reject(new Error(`${stock.name} 分时行情加载失败`));
    };
    document.head.append(script);
  });
}

async function fetchDailyKline(stock) {
  const symbol = `${stock.code.startsWith("6") ? "sh" : "sz"}${stock.code}`;
  const endpoint =
    "https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?" +
    new URLSearchParams({ param: `${symbol},day,,,100,qfq` });
  const response = await fetch(endpoint, {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${stock.name} 日 K 接口返回 ${response.status}`);

  const rows = (await response.json())?.data?.[symbol]?.qfqday;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${stock.name} 暂无日 K 行情`);
  }

  const dailySeries = rows
    .map((row) => ({
      date: row[0],
      open: Number(row[1]),
      close: Number(row[2]),
      high: Number(row[3]),
      low: Number(row[4]),
    }))
    .filter((row) => row.date < MARKET_DATE);

  if (dailySeries.length < 30) {
    throw new Error(`${stock.name} 历史日 K 不足 30 个交易日`);
  }

  return { ...stock, dailySeries };
}

async function fetchQuotes() {
  const response = await fetch(quoteBatchUrl(), {
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`报价接口返回 ${response.status}`);

  const text = new TextDecoder("gbk").decode(await response.arrayBuffer());
  const quotes = new Map();
  const pattern = /v_(?:sh|sz)(\d{6})="([^"]*)";/g;

  for (const match of text.matchAll(pattern)) {
    const [, code, payload] = match;
    const fields = payload.split("~");
    const last = Number(fields[3]);
    if (!Number.isFinite(last) || last <= 0) continue;
    quotes.set(code, {
      code,
      last,
      high: Number(fields[33]),
      low: Number(fields[34]),
      open: Number(fields[5]),
      volume: Number(fields[36]),
      amount: Number(fields[37]) * 10_000,
    });
  }

  if (quotes.size === 0) throw new Error("实时报价接口未返回有效数据");
  return quotes;
}

function buildCandles(stocks) {
  const times = [...new Set(stocks.flatMap((stock) => stock.series.map((row) => row.time)))].sort();
  const candleMap = stocks.map((stock) => ({
    stock,
    rows: new Map(stock.series.map((row) => [row.time, row])),
  }));

  const candles = [];

  for (const time of times) {
    let open = 0;
    let close = 0;
    let high = 0;
    let low = 0;
    let amount = 0;
    let complete = 0;

    for (const { stock, rows } of candleMap) {
      const row = rows.get(time);
      if (!row) continue;
      complete += 1;
      open += stock.weight * (row.open / stock.openPrice);
      close += stock.weight * (row.close / stock.openPrice);
      high += stock.weight * (row.high / stock.openPrice);
      low += stock.weight * (row.low / stock.openPrice);
      amount += stock.weight * row.amount;
    }

    if (complete === stocks.length) {
      candles.push({ time, open, close, high, low, amount });
    }
  }

  if (!candles.some((candle) => candle.time === "09:30")) {
    candles.unshift({
      time: "09:30",
      open: 1,
      close: 1,
      high: 1,
      low: 1,
      amount: 0,
    });
  }

  return candles;
}

function buildDailyCandles(stocks) {
  const historyDates = [
    ...new Set(stocks.flatMap((stock) => stock.dailySeries.map((row) => row.date))),
  ]
    .filter((date) => date < MARKET_DATE)
    .sort()
    .slice(-30);
  const dailyRows = stocks.map((stock) => ({
    stock,
    rows: new Map(stock.dailySeries.map((row) => [row.date, row])),
  }));

  const history = historyDates.flatMap((date) => {
    let open = 0;
    let close = 0;
    let high = 0;
    let low = 0;
    let complete = 0;

    for (const { stock, rows } of dailyRows) {
      const row = rows.get(date);
      if (!row) continue;
      complete += 1;
      open += stock.weight * (row.open / stock.openPrice);
      close += stock.weight * (row.close / stock.openPrice);
      high += stock.weight * (row.high / stock.openPrice);
      low += stock.weight * (row.low / stock.openPrice);
    }

    return complete === stocks.length ? [{ date, open, close, high, low }] : [];
  });

  const today = state.candles;
  if (today.length === 0) return history;

  return [
    ...history,
    {
      date: MARKET_DATE,
      open: 1,
      close: today.at(-1).close,
      high: Math.max(...today.map((candle) => candle.high)),
      low: Math.min(...today.map((candle) => candle.low)),
    },
  ];
}

function getSnapshot() {
  let nav = 0;
  let turnover = 0;
  let up = 0;
  let down = 0;
  let flat = 0;
  const holdings = [];

  for (const stock of state.stocks) {
    const quote = state.quotes.get(stock.code);
    const last = quote?.last ?? stock.latestKline.close;
    const amount = quote?.amount ?? stock.latestKline.amount;
    const change = last / stock.openPrice - 1;
    const contribution = stock.weight * change;

    nav += stock.weight * (last / stock.openPrice);
    turnover += stock.weight * amount;

    if (change > 0.00005) up += 1;
    else if (change < -0.00005) down += 1;
    else flat += 1;

    holdings.push({
      ...stock,
      last,
      change,
      contribution,
    });
  }

  return { nav, turnover, up, down, flat, holdings };
}

function aggregateCandles(candles, period) {
  if (period === 1) return candles;

  const buckets = [];
  let current = null;
  let currentBucket = null;

  for (const candle of candles) {
    const [hour, minute] = candle.time.split(":").map(Number);
    const absoluteMinute = hour * 60 + minute;
    const sessionStart = absoluteMinute <= 690 ? 570 : 780;
    const bucketStart = absoluteMinute < 570
      ? 570
      : sessionStart + Math.floor((absoluteMinute - sessionStart) / period) * period;
    const bucketLabel = `${String(Math.floor(bucketStart / 60)).padStart(2, "0")}:${String(
      bucketStart % 60,
    ).padStart(2, "0")}`;

    if (currentBucket !== bucketLabel) {
      if (current) buckets.push(current);
      currentBucket = bucketLabel;
      current = { ...candle, time: bucketLabel };
    } else {
      current.close = candle.close;
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.amount += candle.amount;
    }
  }

  if (current) buckets.push(current);
  return buckets;
}

function movingAverage(candles, windowSize) {
  return candles.map((candle, index) => {
    if (index < windowSize - 1) return "-";
    let sum = 0;
    for (let offset = index - windowSize + 1; offset <= index; offset += 1) {
      sum += candles[offset].close;
    }
    return Number((sum / windowSize).toFixed(5));
  });
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(0)} 万`;
  return `${value.toFixed(0)} 元`;
}

function signedPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(2)}%`;
}

function directionClass(value) {
  if (value > 0.00005) return "is-up";
  if (value < -0.00005) return "is-down";
  return "is-flat";
}

function renderNavigation(snapshot) {
  const change = snapshot.nav - 1;
  const highs = state.candles.map((candle) => candle.high);
  const lows = state.candles.map((candle) => candle.low);

  el.navValue.textContent = snapshot.nav.toFixed(4);
  el.navValue.className = "tabular";
  el.returnChip.textContent = signedPercent(change);
  el.returnChip.className = `return-chip ${directionClass(change)}`;
  el.dayHigh.textContent = Math.max(...highs, snapshot.nav).toFixed(4);
  el.dayLow.textContent = Math.min(...lows, snapshot.nav).toFixed(4);
  el.turnover.textContent = formatMoney(snapshot.turnover);

  const total = snapshot.up + snapshot.down + snapshot.flat;
  const breadth = total ? (snapshot.up / total) * 100 : 0;
  el.breadthText.innerHTML = `<b class="is-up">${snapshot.up}</b> / <b class="is-down">${snapshot.down}</b>`;
  el.breadthBar.setAttribute("aria-valuenow", breadth.toFixed(0));
  el.breadthFill.style.width = `${breadth}%`;
  el.breadthFill.className = breadth >= 50 ? "is-up-fill" : "is-down-fill";
}

function renderWeights() {
  const shades = [
    "#ecffb1",
    "#d9f99d",
    "#c4ee83",
    "#afe16d",
    "#99d65a",
    "#84c84e",
    "#70ba46",
    "#5fab40",
    "#559c3d",
    "#4c8e39",
    "#438034",
    "#3b7230",
    "#34642b",
    "#2d5626",
  ];

  el.weightStrip.innerHTML = STOCKS.map(
    (stock, index) =>
      `<span style="width:${stock.weight * 100}%;background:${shades[index]}" title="${stock.name} ${(
        stock.weight * 100
      ).toFixed(1)}%"></span>`,
  ).join("");
}

function renderContributions(snapshot) {
  const holdings = [...snapshot.holdings]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 6);
  const maxContribution = Math.max(...holdings.map((holding) => Math.abs(holding.contribution)), 0.0001);

  el.contributionList.innerHTML = holdings
    .map(
      (holding) => `
        <div class="contribution-row">
          <div class="contribution-name">
            <span>${holding.name}</span>
            <small>${holding.sector}</small>
          </div>
          <div class="contribution-track" aria-hidden="true">
            <span
              class="${directionClass(holding.contribution)}"
              style="width:${(Math.abs(holding.contribution) / maxContribution) * 100}%"
            ></span>
          </div>
          <strong class="tabular ${directionClass(holding.contribution)}">
            ${signedPercent(holding.contribution)}
          </strong>
        </div>
      `,
    )
    .join("");
}

function renderHoldings(snapshot) {
  el.holdingsBody.innerHTML = snapshot.holdings
    .map(
      (holding) => `
        <tr>
          <td>
            <div class="stock-identity">
              <span class="stock-avatar">${holding.name.slice(0, 1)}</span>
              <span>
                <strong>${holding.name}</strong>
                <small>${holding.code}</small>
              </span>
            </div>
          </td>
          <td><span class="sector-tag">${holding.sector}</span></td>
          <td class="number tabular">${holding.last.toFixed(2)}</td>
          <td class="number tabular ${directionClass(holding.change)}">
            ${signedPercent(holding.change)}
          </td>
          <td class="number tabular">${(holding.weight * 100).toFixed(1)}%</td>
          <td class="number tabular ${directionClass(holding.contribution)}">
            ${signedPercent(holding.contribution)}
          </td>
        </tr>
      `,
    )
    .join("");
}

function intradayTooltipMarkup(index, candles) {
  const candle = candles[index];
  if (!candle) return "";
  const tone = directionClass(candle.close - 1);
  return `
    <div class="chart-tooltip">
      <div class="chart-tooltip-time">${MARKET_DATE} ${candle.time}</div>
      <div class="chart-tooltip-grid">
        <span>净值</span><b class="tabular ${tone}">${candle.close.toFixed(4)}</b>
        <span>相对开盘</span><b class="tabular ${tone}">${signedPercent(candle.close - 1)}</b>
        <span>区间高</span><b class="tabular">${candle.high.toFixed(4)}</b>
        <span>区间低</span><b class="tabular">${candle.low.toFixed(4)}</b>
        <span>成交额</span><b class="tabular">${formatMoney(candle.amount)}</b>
      </div>
    </div>
  `;
}

function renderChart() {
  if (!state.chart || state.candles.length === 0) return;

  const candles = aggregateCandles(state.candles, state.period);
  const times = candles.map((candle) => candle.time);
  const values = candles.map((candle) => candle.close);
  const latest = candles.at(-1).close;

  state.chart.setOption(
    {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "line",
          lineStyle: { color: "rgba(244,243,236,.28)", type: "dashed" },
        },
        borderWidth: 0,
        backgroundColor: "transparent",
        shadowBlur: 0,
        formatter: (params) => intradayTooltipMarkup(params[0]?.dataIndex ?? 0, candles),
      },
      grid: { left: 10, right: 66, top: 34, bottom: 30 },
      xAxis: {
        type: "category",
        data: times,
        boundaryGap: false,
        axisLine: { lineStyle: { color: COLORS.axis } },
        axisTick: { show: false },
        axisLabel: {
          color: COLORS.muted,
          fontSize: 11,
          margin: 12,
          interval: (_, value) => {
            const [hour, minute] = value.split(":").map(Number);
            return (hour === 9 && minute === 30) ||
              minute === 0 ||
              value === "11:30" ||
              value === "15:00";
          },
        },
      },
      yAxis: {
        scale: true,
        position: "right",
        splitNumber: 5,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: COLORS.muted,
          fontSize: 11,
          formatter: (value) => value.toFixed(4),
          margin: 10,
        },
        splitLine: { lineStyle: { color: COLORS.grid, type: "dashed" } },
      },
      series: [{
        name: "日内净值",
        type: "line",
        data: values,
        showSymbol: false,
        smooth: 0.18,
        lineStyle: { color: COLORS.gold, width: 2 },
        areaStyle: { color: "rgba(217, 249, 157, 0.07)" },
        markLine: {
          silent: true,
          symbol: "none",
          label: {
            color: COLORS.muted,
            fontSize: 10,
            position: "insideEndTop",
          },
          data: [
            {
              yAxis: 1,
              label: { formatter: "开盘 1.0000" },
              lineStyle: { color: "rgba(244,243,236,.22)", type: "dashed", width: 1 },
            },
            {
              yAxis: latest,
              label: { formatter: `当前 ${latest.toFixed(4)}` },
              lineStyle: { color: "rgba(217,249,157,.4)", type: "dashed", width: 1 },
            },
          ],
        },
        markPoint: {
          symbol: "circle",
          symbolSize: 8,
          data: [{ coord: [times.at(-1), latest] }],
          itemStyle: { color: COLORS.up, borderColor: "#0c1510", borderWidth: 2 },
          label: {
            show: true,
            formatter: `净值 ${latest.toFixed(4)}`,
            position: "top",
            color: COLORS.text,
            fontSize: 10,
          },
        },
      }],
    },
    { notMerge: true, lazyUpdate: true },
  );

  el.chart.setAttribute(
    "aria-label",
    `${MARKET_DATE} 金永昊精选ETF净值${state.period}分钟日内折线。当前净值${latest.toFixed(
      4,
    )}，开盘基准1.0000。`,
  );
}

function dailyTooltipMarkup(index, candles) {
  const candle = candles[index];
  if (!candle) return "";
  const tone = directionClass(candle.close - candle.open);
  return `
    <div class="chart-tooltip">
      <div class="chart-tooltip-time">${candle.date}${candle.date === MARKET_DATE ? " · 当前" : ""}</div>
      <div class="chart-tooltip-grid">
        <span>开</span><b class="tabular">${candle.open.toFixed(4)}</b>
        <span>高</span><b class="tabular">${candle.high.toFixed(4)}</b>
        <span>低</span><b class="tabular">${candle.low.toFixed(4)}</b>
        <span>收</span><b class="tabular ${tone}">${candle.close.toFixed(4)}</b>
        <span>相对开盘</span><b class="tabular ${directionClass(candle.close - 1)}">${signedPercent(candle.close - 1)}</b>
      </div>
    </div>
  `;
}

function renderDailyChart() {
  if (!state.dailyChart || state.dailyCandles.length === 0) return;

  const candles = state.dailyCandles;
  const dates = candles.map((candle) => candle.date);
  const values = candles.map((candle) => [
    candle.open,
    candle.close,
    candle.low,
    candle.high,
  ]);
  const ma5 = movingAverage(candles, 5);
  const ma10 = movingAverage(candles, 10);
  const current = candles.at(-1);

  state.dailyChart.setOption(
    {
      animation: false,
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        borderWidth: 0,
        backgroundColor: "transparent",
        shadowBlur: 0,
        formatter: (params) => dailyTooltipMarkup(params[0]?.dataIndex ?? 0, candles),
      },
      grid: { left: 10, right: 78, top: 34, bottom: 34 },
      xAxis: {
        type: "category",
        data: dates,
        boundaryGap: true,
        axisLine: { lineStyle: { color: COLORS.axis } },
        axisTick: { show: false },
        axisLabel: {
          color: COLORS.muted,
          fontSize: 10,
          margin: 13,
          interval: (index) => index === dates.length - 1 || index % 5 === 0,
          formatter: (value, index) =>
            index === dates.length - 1 ? `${value.slice(5)}\n当前` : value.slice(5),
        },
      },
      yAxis: {
        scale: true,
        position: "right",
        splitNumber: 5,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: COLORS.muted,
          fontSize: 11,
          formatter: (value) => value.toFixed(4),
          margin: 12,
        },
        splitLine: { lineStyle: { color: COLORS.grid, type: "dashed" } },
      },
      series: [
        {
          name: "合成日 K",
          type: "candlestick",
          data: values,
          itemStyle: {
            color: COLORS.up,
            color0: COLORS.down,
            borderColor: COLORS.up,
            borderColor0: COLORS.down,
            borderWidth: 1,
          },
          markLine: {
            silent: true,
            symbol: "none",
            data: [
              {
                yAxis: 1,
                label: {
                  formatter: "基准 1.0000",
                  position: "insideStartTop",
                  color: COLORS.muted,
                  fontSize: 10,
                },
                lineStyle: { color: "rgba(244,243,236,.22)", type: "dashed", width: 1 },
              },
              {
                xAxis: MARKET_DATE,
                label: {
                  show: false,
                },
                lineStyle: { color: "rgba(217,249,157,.35)", type: "dashed", width: 1 },
              },
            ],
          },
          markPoint: {
            symbol: "circle",
            symbolSize: 8,
            data: [{ coord: [MARKET_DATE, current.close] }],
            itemStyle: { color: COLORS.up, borderColor: "#0c1510", borderWidth: 2 },
            label: {
              show: true,
              formatter: `当前 ${current.close.toFixed(4)}`,
              position: "top",
              color: COLORS.lime,
              fontSize: 10,
            },
          },
        },
        {
          name: "MA5",
          type: "line",
          data: ma5,
          symbol: "none",
          smooth: 0.16,
          lineStyle: { color: COLORS.ma5, width: 1.2 },
        },
        {
          name: "MA10",
          type: "line",
          data: ma10,
          symbol: "none",
          smooth: 0.16,
          lineStyle: { color: COLORS.ma10, width: 1.2 },
        },
      ],
    },
    { notMerge: true, lazyUpdate: true },
  );

  el.dailyCurrentNav.textContent = current.close.toFixed(4);
  el.dailyRangeLabel.textContent = `${candles[0].date} → ${MARKET_DATE}`;
  el.dailyChart.setAttribute(
    "aria-label",
    `${candles[0].date} 至 ${MARKET_DATE} 的金永昊精选ETF日K线。当前净值${current.close.toFixed(
      4,
    )}，已标注当前位置。`,
  );
}

function renderAll() {
  if (!state.snapshot) return;
  renderNavigation(state.snapshot);
  renderContributions(state.snapshot);
  renderHoldings(state.snapshot);
  renderChart();
  renderDailyChart();

  el.lastUpdated.textContent = state.lastQuoteAt
    ? `更新于 ${new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(state.lastQuoteAt)}`
    : `K线截至 ${state.candles.at(-1).time}`;
  el.dataCoverage.textContent = `${state.quoteCoverage} / 14 报价`;
}

function applyLiveCandle(nav) {
  const last = state.candles.at(-1);
  if (!last) return;
  last.close = nav;
  last.high = Math.max(last.high, nav);
  last.low = Math.min(last.low, nav);

  const dailyLast = state.dailyCandles.at(-1);
  if (dailyLast?.date === MARKET_DATE) {
    dailyLast.close = nav;
    dailyLast.high = Math.max(dailyLast.high, nav);
    dailyLast.low = Math.min(dailyLast.low, nav);
  }
}

async function refreshQuotes() {
  const quotes = await fetchQuotes();

  state.quoteCoverage = quotes.size;
  if (quotes.size === 0) {
    throw new Error("实时报价接口暂不可用");
  }

  state.quotes = quotes;
  state.lastQuoteAt = new Date();
  state.snapshot = getSnapshot();
  applyLiveCandle(state.snapshot.nav);
  setConnection(quotes.size === STOCKS.length ? "live" : "delayed");
  renderAll();
}

async function refreshKlines({ initial = false } = {}) {
  const [results, dailyResults] = await Promise.all([
    settleWithConcurrency(STOCKS, 3, fetchKline),
    initial
      ? settleWithConcurrency(STOCKS, 3, fetchDailyKline)
      : Promise.resolve(null),
  ]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;

  const dailyFailed = dailyResults?.find((result) => result.status === "rejected");
  if (dailyFailed) throw dailyFailed.reason;

  const dailyByCode = dailyResults
    ? new Map(
        dailyResults.map((result) => [result.value.code, result.value.dailySeries]),
      )
    : new Map(state.stocks.map((stock) => [stock.code, stock.dailySeries]));
  const stocks = results.map((result) => ({
    ...result.value,
    dailySeries: dailyByCode.get(result.value.code),
  }));
  state.stocks = stocks;
  state.candles = buildCandles(stocks);
  state.dailyCandles = buildDailyCandles(stocks);
  state.lastKlineAt = Date.now();
  el.chartError.hidden = true;

  if (state.quotes.size > 0) {
    state.snapshot = getSnapshot();
    applyLiveCandle(state.snapshot.nav);
    renderAll();
  } else {
    state.snapshot = getSnapshot();
    state.quoteCoverage = 0;
    renderNavigation(state.snapshot);
    renderContributions(state.snapshot);
    renderHoldings(state.snapshot);
    renderChart();
    renderDailyChart();
    el.lastUpdated.textContent =
      state.candles.length > 1 ? `K线截至 ${state.candles.at(-1).time}` : "等待分时行情";
    el.dataCoverage.textContent = "K线已就绪 · 等待报价";
  }

  if (initial) {
    el.chartLoading.hidden = true;
    el.chartError.hidden = true;
  }
}

async function initialLoad() {
  state.connection = "loading";
  state.quotes.clear();
  el.chartLoading.hidden = false;
  el.chartError.hidden = true;
  setConnection("loading");

  try {
    await refreshKlines({ initial: true });
    await refreshQuotes();
  } catch (error) {
    setConnection("error");
    el.chartLoading.hidden = true;
    el.chartError.hidden = false;
    el.chartErrorMessage.textContent =
      error.message === "Failed to fetch"
        ? "行情接口连接失败，请检查网络后重试"
        : error.message;
  }
}

async function quoteTick() {
  if (state.quoteTicking || !isTradingSession()) return;
  state.quoteTicking = true;

  try {
    await refreshQuotes();
  } catch {
    setConnection("delayed");
  } finally {
    state.quoteTicking = false;
  }
}

async function klineTick() {
  if (
    state.klineTicking ||
    !isTradingSession() ||
    Date.now() - state.lastKlineAt < KLINE_INTERVAL
  ) {
    return;
  }
  state.klineTicking = true;

  try {
    await refreshKlines();
  } catch {
    if (state.candles.length === 0) setConnection("delayed");
  } finally {
    state.klineTicking = false;
  }
}

function setupEvents() {
  document.querySelectorAll(".period-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.period = Number(button.dataset.period);
      document.querySelectorAll(".period-button").forEach((item) => {
        item.classList.toggle("is-active", item === button);
        item.setAttribute("aria-pressed", item === button ? "true" : "false");
      });
      renderChart();
    });
  });

  el.retryButton.addEventListener("click", initialLoad);
  window.setInterval(updateClock, 1_000);

  const resizeObserver = new ResizeObserver(() => {
    state.chart?.resize();
    state.dailyChart?.resize();
  });
  resizeObserver.observe(el.chart);
  resizeObserver.observe(el.dailyChart);
}

async function init() {
  state.chart = initChart(el.chart, null, { renderer: "canvas" });
  state.dailyChart = initChart(el.dailyChart, null, { renderer: "canvas" });
  renderWeights();
  setupEvents();
  updateClock();
  await initialLoad();
  window.setInterval(quoteTick, QUOTE_INTERVAL);
  window.setInterval(klineTick, 5_000);
}

init();
