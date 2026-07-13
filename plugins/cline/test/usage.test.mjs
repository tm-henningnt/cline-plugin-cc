import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  formatUsage,
  MAX_USAGE_PAGES,
  redactAccountPath,
  summarizeUsage,
  usage,
} from "../scripts/lib/usage.mjs";

const NOW = "2026-07-04T09:41:00.000Z";
const API_BASE_URL = "https://api.cline.bot/api/v1";
const ACCOUNT_ID = "usr-EXAMPLE";
const BALANCE_URL = `${API_BASE_URL}/users/${ACCOUNT_ID}/balance`;
const USAGES_URL = `${API_BASE_URL}/users/${ACCOUNT_ID}/usages`;

function loadJson(path) {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/${path}`, import.meta.url)), "utf8"),
  );
}

const meFixture = loadJson("usage-me.json");
const balanceFixture = loadJson("usage-balance.json");
const usagesFixture = loadJson("usage-usages.json");

test("redactAccountPath: strips user path segments from URLs", () => {
  assert.equal(
    redactAccountPath("https://api.cline.bot/api/v1/users/usr-abc123/balance"),
    "https://api.cline.bot/api/v1/users/[account]/balance",
  );
  assert.equal(
    redactAccountPath("https://api.cline.bot/api/v1/users/me"),
    "https://api.cline.bot/api/v1/users/[account]",
  );
  assert.equal(
    redactAccountPath("https://api.cline.bot/api/v1/projects/usr-abc123"),
    "https://api.cline.bot/api/v1/projects/usr-abc123",
  );
});

function fakeFetchJson() {
  const calls = [];
  const fetchJson = async (url, opts) => {
    calls.push({ url, opts });
    if (url.endsWith("/users/me")) return meFixture;
    if (url === BALANCE_URL) return balanceFixture;
    if (url === USAGES_URL) return usagesFixture;
    throw new Error(`unexpected url: ${url}`);
  };
  return { fetchJson, calls };
}

function usageItem(createdAt, creditsUsed = 100, costUsd = 10_000) {
  return { createdAt, creditsUsed, costUsd };
}

function fakePagedUsageFetchJson(pagesByUrl) {
  const calls = [];
  const fetchJson = async (url, opts) => {
    calls.push({ url, opts });
    if (url === BALANCE_URL) return balanceFixture;
    if (Object.hasOwn(pagesByUrl, url)) {
      return { success: true, data: pagesByUrl[url] };
    }
    throw new Error(`unexpected url: ${url}`);
  };
  return { fetchJson, calls };
}

function usageCallUrls(calls) {
  return calls.filter((call) => call.url.startsWith(USAGES_URL)).map((call) => call.url);
}

test("usage: resolves the current user, fetches balance and usages, and formats the summary", async () => {
  const { fetchJson, calls } = fakeFetchJson();
  const out = await usage({ token: "token", nowIso: NOW }, { fetchJson });

  assert.equal(out.ok, true);
  assert.match(out.text, /Credit balance: 496,470 credits/);
  assert.match(out.text, /Last 24h: 3 items · 1,940 credits · \$0\.194196/);
  assert.match(out.text, /Last 7 days: 3 items · 1,940 credits · \$0\.194196/);
  assert.match(out.text, /Last 30 days: 3 items · 1,940 credits · \$0\.194196/);
  assert.match(out.text, /https:\/\/app\.cline\.bot\/dashboard\/subscription/);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.cline.bot/api/v1/users/me",
      "https://api.cline.bot/api/v1/users/usr-EXAMPLE/balance",
      "https://api.cline.bot/api/v1/users/usr-EXAMPLE/usages",
    ],
  );
  assert.ok(calls.every((call) => call.opts.token === "token"));
});

test("usage: appends local ledger summary on the successful path", async () => {
  const { fetchJson } = fakeFetchJson();
  const out = await usage(
    {
      token: "token",
      nowIso: NOW,
      ledgerPath: "/repo/.cline-runs.ndjson",
      ledgerText: [
        JSON.stringify({
          ts: "2026-07-04T09:00:00.000Z",
          model: "cline-pass/kimi-k2.7-code",
          ok: true,
          transport: null,
          retried: false,
          costUsd: 0.02,
          durationMs: 64000,
        }),
        JSON.stringify({
          ts: "2026-07-03T09:00:00.000Z",
          model: "cline-pass/kimi-k2.7-code",
          ok: false,
          transport: "session-not-found",
          retried: true,
          costUsd: 0.01,
          durationMs: 32000,
        }),
      ].join("\n"),
    },
    { fetchJson },
  );

  assert.equal(out.ok, true);
  assert.match(out.text, /https:\/\/app\.cline\.bot\/dashboard\/subscription/);
  assert.match(out.text, /\*\*Local Run ledger\*\* \(\.cline-runs\.ndjson\)/);
  assert.match(out.text, /Last 30 days: 2 Runs · 1 ok \(50%\) · 1 transport crashes · 1 retried · \$0\.030000/);
});

test("usage: uses opts.accountId when present", async () => {
  const { fetchJson, calls } = fakeFetchJson();
  const out = await usage(
    { token: "token", accountId: "usr-EXAMPLE", nowIso: NOW },
    { fetchJson },
  );

  assert.equal(out.ok, true);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      "https://api.cline.bot/api/v1/users/usr-EXAMPLE/balance",
      "https://api.cline.bot/api/v1/users/usr-EXAMPLE/usages",
    ],
  );
});

test("usage: missing token returns a setup message without fetching", async () => {
  let fetched = false;
  const out = await usage(
    {},
    {
      fetchJson: async () => {
        fetched = true;
      },
    },
  );

  assert.equal(out.ok, false);
  assert.equal(fetched, false);
  assert.match(out.text, /\/cline:setup/);
  assert.match(out.text, /sign in/i);
});

test("usage: Codex missing token directs users to isolated-state setup", async () => {
  const out = await usage(
    { host: "codex", stateRoot: "/home/user/.codex/cline" },
    { fetchJson: async () => assert.fail("fetch should not be called") },
  );

  assert.equal(out.ok, false);
  assert.match(out.text, /Codex state directory/);
  assert.match(out.text, /\$cline:setup/);
});

test("usage: unreadable auth settings returns a repair message without fetching", async () => {
  let fetched = false;
  const out = await usage(
    { authStatus: "unreadable" },
    {
      fetchJson: async () => {
        fetched = true;
      },
    },
  );

  assert.equal(out.ok, false);
  assert.equal(fetched, false);
  assert.match(out.text, /could not be read/);
});

test("usage: unreadable Codex settings quote the isolated state path", async () => {
  const out = await usage(
    { authStatus: "unreadable", stateRoot: "/home/user/Cline State's" },
    { fetchJson: async () => assert.fail("fetch should not be called") },
  );

  assert.equal(out.ok, false);
  assert.match(out.text, /cline --data-dir '\/home\/user\/Cline State"'"'s' auth cline/);
});

test("summarizeUsage: sums counts, credits and micro-dollar cost over rolling windows", () => {
  const summary = summarizeUsage(usagesFixture.data, NOW);
  const emptyTokenSummary = summarizeUsage({ ...usagesFixture.data, nextToken: "" }, NOW);

  assert.equal(summary.partial, false);
  assert.equal(emptyTokenSummary.partial, false);
  assert.deepEqual(summary.windows["24h"], {
    label: "Last 24h",
    count: 3,
    creditsUsed: 1940,
    costUsd: 0.194196,
  });
  assert.deepEqual(summary.windows["7d"], {
    label: "Last 7 days",
    count: 3,
    creditsUsed: 1940,
    costUsd: 0.194196,
  });
  assert.deepEqual(summary.windows["30d"], {
    label: "Last 30 days",
    count: 3,
    creditsUsed: 1940,
    costUsd: 0.194196,
  });
});

test("summarizeUsage: excludes items older than each rolling window", () => {
  const summary = summarizeUsage(usagesFixture.data, "2026-08-04T09:41:00.000Z");

  assert.equal(summary.windows["24h"].count, 0);
  assert.equal(summary.windows["7d"].count, 0);
  assert.equal(summary.windows["30d"].count, 0);
});

test("formatUsage: surfaces paginated partial history", () => {
  const paged = structuredClone(usagesFixture.data);
  paged.nextToken = "next-page";
  const summary = summarizeUsage(paged, NOW);
  const text = formatUsage({ balance: balanceFixture.data, summary });

  assert.equal(summary.partial, true);
  assert.match(text, /\(partial — more history not fetched\)/);
});

test("usage: aggregates usage across cursor-paginated pages", async () => {
  const { fetchJson, calls } = fakePagedUsageFetchJson({
    [USAGES_URL]: {
      items: [
        usageItem("2026-07-04T09:00:00.000Z", 100, 10_000),
        usageItem("2026-07-04T08:00:00.000Z", 200, 20_000),
      ],
      nextToken: "p2 token",
      total: 3,
    },
    [`${USAGES_URL}?cursor=p2%20token`]: {
      items: [usageItem("2026-07-04T07:00:00.000Z", 300, 30_000)],
      nextToken: "",
      total: 3,
    },
  });

  const out = await usage(
    { token: "token", accountId: ACCOUNT_ID, nowIso: NOW },
    { fetchJson },
  );

  assert.equal(out.ok, true);
  assert.match(out.text, /Last 24h: 3 items · 600 credits · \$0\.060000/);
  assert.doesNotMatch(out.text, /partial/);
  assert.deepEqual(usageCallUrls(calls), [USAGES_URL, `${USAGES_URL}?cursor=p2%20token`]);
});

test("usage: stops fetching pages when the newest page is older than the 30 day window", async () => {
  const { fetchJson, calls } = fakePagedUsageFetchJson({
    [USAGES_URL]: {
      items: [usageItem("2026-05-25T09:41:00.000Z", 500, 50_000)],
      nextToken: "p2",
      total: 2,
    },
    [`${USAGES_URL}?cursor=p2`]: {
      items: [usageItem("2026-05-24T09:41:00.000Z", 600, 60_000)],
      nextToken: null,
      total: 2,
    },
  });

  const out = await usage(
    { token: "token", accountId: ACCOUNT_ID, nowIso: NOW },
    { fetchJson },
  );

  assert.equal(out.ok, true);
  assert.match(out.text, /Last 24h: 0 items · 0 credits · \$0\.000000/);
  assert.match(out.text, /Last 7 days: 0 items · 0 credits · \$0\.000000/);
  assert.match(out.text, /Last 30 days: 0 items · 0 credits · \$0\.000000/);
  assert.doesNotMatch(out.text, /partial/);
  assert.deepEqual(usageCallUrls(calls), [USAGES_URL]);
});

test("usage: marks usage partial when the page cap cuts off recent history", async () => {
  const calls = [];
  let page = 0;
  const fetchJson = async (url, opts) => {
    calls.push({ url, opts });
    if (url === BALANCE_URL) return balanceFixture;
    if (url.startsWith(USAGES_URL)) {
      page += 1;
      return {
        success: true,
        data: {
          items: [usageItem("2026-07-04T09:00:00.000Z", 1, 1_000)],
          nextToken: `p${page + 1}`,
          total: 999,
        },
      };
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const out = await usage(
    { token: "token", accountId: ACCOUNT_ID, nowIso: NOW },
    { fetchJson },
  );

  assert.equal(out.ok, true);
  assert.equal(usageCallUrls(calls).length, MAX_USAGE_PAGES);
  assert.deepEqual(usageCallUrls(calls).slice(0, 3), [
    USAGES_URL,
    `${USAGES_URL}?cursor=p2`,
    `${USAGES_URL}?cursor=p3`,
  ]);
  assert.match(
    out.text,
    new RegExp(`\\(partial — history beyond ${MAX_USAGE_PAGES} pages not fetched\\)`),
  );
});

test("usage: balance endpoint failure envelope surfaces the API error message", async () => {
  const fetchJson = async (url) => {
    if (url.endsWith("/users/me")) return meFixture;
    if (url.endsWith("/balance")) {
      // shape per docs/cline-cli-contract.md; replace with captured fixture when available
      return { success: false, error: { message: "unauthorized" } };
    }
    if (url.endsWith("/usages")) return usagesFixture;
    throw new Error(`unexpected url: ${url}`);
  };
  const out = await usage({ token: "token", nowIso: NOW }, { fetchJson });

  assert.equal(out.ok, false);
  assert.match(out.text, /Could not load ClinePass usage: balance request failed: unauthorized/);
});

test("usage: usages endpoint returning null data is reported as missing data", async () => {
  const fetchJson = async (url) => {
    if (url.endsWith("/users/me")) return meFixture;
    if (url.endsWith("/balance")) return balanceFixture;
    if (url.endsWith("/usages")) {
      // shape per docs/cline-cli-contract.md; replace with captured fixture when available
      return { success: true, data: null };
    }
    throw new Error(`unexpected url: ${url}`);
  };
  const out = await usage({ token: "token", nowIso: NOW }, { fetchJson });

  assert.equal(out.ok, false);
  assert.match(out.text, /usages response did not include data/);
});

test("usage: a rejected fetch surfaces the underlying error message", async () => {
  const fetchJson = async () => {
    throw new Error("network down");
  };
  const out = await usage({ token: "token", nowIso: NOW }, { fetchJson });

  assert.equal(out.ok, false);
  assert.match(out.text, /network down/);
});

test("usage: current-user response missing id is reported", async () => {
  const fetchJson = async (url) => {
    if (url.endsWith("/users/me")) {
      // shape per docs/cline-cli-contract.md; replace with captured fixture when available
      return { success: true, data: {} };
    }
    throw new Error(`unexpected url: ${url}`);
  };
  const out = await usage({ token: "token", nowIso: NOW }, { fetchJson });

  assert.equal(out.ok, false);
  assert.match(out.text, /did not include data\.id/);
});
