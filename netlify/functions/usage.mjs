// Usage summary for the /dashboard/ page: remaining Expo (EAS) builds and
// GitHub Actions minutes for the current billing period.
//
// Tokens stay server side. Set these in Netlify (Site configuration →
// Environment variables), scoped to Functions:
//   GITHUB_TOKEN   fine-grained PAT with the "Plan" user permission (read)
//   GITHUB_USER    GitHub username whose billing to read (default: AshleyJButcher)
//   EXPO_TOKEN     Expo access token (expo.dev → Account settings → Access tokens)
// Optional:
//   EXPO_ACCOUNT                     Expo account name (default: the token's first account)
//   GITHUB_ACTIONS_INCLUDED_MINUTES  monthly included minutes (default 2000, Free plan; Pro is 3000)
//   USAGE_CACHE_SECONDS              how long to cache the result (default 1800, clamped 900–3600)

const CACHE_SECONDS = Math.min(
  3600,
  Math.max(900, Number(process.env.USAGE_CACHE_SECONDS) || 1800),
);

// Kept per warm function instance; the CDN cache header below does the
// heavy lifting across instances.
let memo = { at: 0, body: null };

export default async () => {
  const now = Date.now();
  if (!memo.body || now - memo.at > CACHE_SECONDS * 1000) {
    const [github, expo] = await Promise.all([
      settle(getGithubActions),
      settle(getExpoBuilds),
    ]);
    memo = {
      at: now,
      body: JSON.stringify({ fetchedAt: new Date(now).toISOString(), cacheSeconds: CACHE_SECONDS, github, expo }),
    };
  }

  return new Response(memo.body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Netlify-CDN-Cache-Control": `public, durable, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=300`,
    },
  });
};

export const config = { path: "/api/usage" };

// Turn a thrown error into { ok: false, error } so one service failing
// does not blank the whole dashboard. Messages never include tokens.
async function settle(fn) {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

// ---------- GitHub Actions ----------

// Minutes on larger runners are billed at a multiple of Linux minutes
// against the included allowance.
const MULTIPLIER = { linux: 1, windows: 2, macos: 10 };

function multiplierFor(sku = "") {
  const s = sku.toLowerCase();
  if (s.includes("macos")) return MULTIPLIER.macos;
  if (s.includes("windows")) return MULTIPLIER.windows;
  return MULTIPLIER.linux;
}

async function getGithubActions() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const user = process.env.GITHUB_USER || "AshleyJButcher";
  const included = Number(process.env.GITHUB_ACTIONS_INCLUDED_MINUTES) || 2000;

  const d = new Date();
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const base = `https://api.github.com/users/${encodeURIComponent(user)}/settings/billing`;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "usage-dashboard",
  };

  // Prefer the summary endpoint; fall back to the itemised usage report.
  let items;
  let res = await fetch(`${base}/usage/summary?year=${year}&month=${month}&product=actions`, { headers });
  if (res.ok) {
    const data = await res.json();
    items = (data.usageItems || []).map((i) => ({
      sku: i.sku,
      unitType: i.unitType,
      quantity: i.grossQuantity ?? i.quantity ?? 0,
      netAmount: i.netAmount ?? 0,
      product: i.product,
    }));
  } else if (res.status === 404 || res.status === 400) {
    res = await fetch(`${base}/usage?year=${year}&month=${month}`, { headers });
    if (!res.ok) throw new Error(`GitHub billing API returned ${res.status}`);
    const data = await res.json();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    items = (data.usageItems || [])
      .filter((i) => !i.date || String(i.date).startsWith(prefix))
      .map((i) => ({ sku: i.sku, unitType: i.unitType, quantity: i.quantity ?? 0, netAmount: i.netAmount ?? 0, product: i.product }));
  } else {
    throw new Error(`GitHub billing API returned ${res.status}${res.status === 403 ? " (token needs the Plan read permission)" : ""}`);
  }

  const minuteItems = items.filter(
    (i) => /actions/i.test(i.product || "actions") && /minute/i.test(i.unitType || ""),
  );
  const bySku = {};
  for (const i of minuteItems) {
    const key = i.sku || "Actions";
    bySku[key] = bySku[key] || { sku: key, minutes: 0, multiplier: multiplierFor(key) };
    bySku[key].minutes += i.quantity;
  }
  const breakdown = Object.values(bySku).map((b) => ({ ...b, minutes: round(b.minutes) }));
  const used = round(breakdown.reduce((n, b) => n + b.minutes * b.multiplier, 0));
  const billed = round(minuteItems.reduce((n, i) => n + (i.netAmount || 0), 0), 2);

  return {
    user,
    period: { start: utcDate(year, month, 1), end: utcDate(year, month + 1, 1) },
    minutes: { used, included, remaining: Math.max(0, round(included - used)) },
    billedUsd: billed,
    breakdown,
  };
}

// ---------- Expo (EAS Build) ----------

const EXPO_GRAPHQL = "https://api.expo.dev/graphql";

async function expoQuery(query, variables) {
  const res = await fetch(EXPO_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.EXPO_TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Expo API returned ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Expo API: ${json.errors[0].message}`);
  return json.data;
}

async function getExpoBuilds() {
  if (!process.env.EXPO_TOKEN) throw new Error("EXPO_TOKEN is not set");

  let accountName = process.env.EXPO_ACCOUNT;
  if (!accountName) {
    const me = await expoQuery(`query { meActor { id accounts { id name } } }`);
    accountName = me?.meActor?.accounts?.[0]?.name;
    if (!accountName) throw new Error("No Expo account found for EXPO_TOKEN");
  }

  // Same metrics `eas account:usage` reads for the current billing period.
  const data = await expoQuery(
    `query Usage($name: String!, $date: DateTime!) {
      account {
        byName(accountName: $name) {
          name
          subscription { id name }
          billingPeriod(date: $date) { id start end }
          usageMetrics {
            EAS_BUILD: byBillingPeriod(date: $date, service: BUILDS) {
              id
              planMetrics {
                id serviceMetric metricType value limit
                platformBreakdown { ios { value limit } android { value limit } }
              }
              totalCost
            }
          }
        }
      }
    }`,
    { name: accountName, date: new Date().toISOString() },
  );

  const account = data?.account?.byName;
  if (!account) throw new Error(`Expo account "${accountName}" not found`);
  const metric = (account.usageMetrics?.EAS_BUILD?.planMetrics || []).find(
    (m) => m.serviceMetric === "BUILDS" && m.metricType === "BUILD",
  );
  const used = metric?.value ?? 0;
  const limit = metric?.limit ?? 0;
  const pb = metric?.platformBreakdown;
  const platform = (p) => (p ? { used: p.value ?? 0, limit: p.limit ?? 0, remaining: Math.max(0, (p.limit ?? 0) - (p.value ?? 0)) } : null);

  return {
    account: account.name,
    plan: account.subscription?.name || null,
    period: account.billingPeriod ? { start: account.billingPeriod.start, end: account.billingPeriod.end } : null,
    builds: { used, limit, remaining: Math.max(0, limit - used) },
    ios: platform(pb?.ios),
    android: platform(pb?.android),
    overageUsd: round((account.usageMetrics?.EAS_BUILD?.totalCost ?? 0) / 100, 2),
  };
}

// ---------- helpers ----------

function round(n, dp = 0) {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
}

function utcDate(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).toISOString();
}
