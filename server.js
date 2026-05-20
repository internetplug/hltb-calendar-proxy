import express from "express";
import makeFetchCookie from "fetch-cookie";
import { CookieJar } from "tough-cookie";

const JAR = new CookieJar();
const FETCH_WITH_COOKIES = makeFetchCookie(fetch, JAR);

const app = express();

const PORT = process.env.PORT || 3000;

// Your shared secret
const PROXY_API_KEY = process.env.PROXY_API_KEY;

// HLTB endpoints
const HLTB_SEARCH_URL =
  "https://howlongtobeat.com/api/bleed";
const HLTB_GAME_URL =
  "https://howlongtobeat.com/api/game";

const MIN_DELAY_MS   = 50;
const MAX_JITTER_MS  = 100;
const MAX_QUEUE_SIZE = 20;

class HltbQueue {
  #tail = Promise.resolve();
  #pending = 0;

  enqueue(fn) {
    if (this.#pending >= MAX_QUEUE_SIZE) {
      return Promise.reject(
        Object.assign(new Error("HLTB queue full"), { code: "QUEUE_FULL" })
      );
    }
    this.#pending++;
    const result = this.#tail.then(() => fn());
    this.#tail = result
      .catch(() => {})
      .then(() => new Promise(r => setTimeout(r, MIN_DELAY_MS + Math.floor(Math.random() * (MAX_JITTER_MS + 1)))))
      .finally(() => { this.#pending--; });
    return result;
  }
}

const hltbQueue = new HltbQueue();

function queuedFetch(url, options) {
  return hltbQueue.enqueue(() => FETCH_WITH_COOKIES(url, options));
}

// Middleware
app.use(express.json());

// Simple auth middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log("Headers:", req.headers);
  
  const apiKey = req.header("x-proxy-api-key");
  console.log("API Key received:", apiKey ? "✓ yes" : "✗ no");
  console.log("API Key expected:", process.env.PROXY_API_KEY ? "✓ set" : "✗ not set");
  console.log("Keys match:", apiKey === process.env.PROXY_API_KEY ? "✓ yes" : "✗ no");

  if (!apiKey || apiKey !== process.env.PROXY_API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
});

/**
 * GET /search?query=elden ring
 */
app.get("/search", async (req, res) => {
  try {
    const query = req.query.query;

    const headers = {
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "*/*",
      Origin: "https://howlongtobeat.com",
      Referer: "https://howlongtobeat.com/",
    };

    // Establish session
    await queuedFetch("https://howlongtobeat.com/", {
      headers,
    });

    // Fetch auth tokens
    const initResponse = await queuedFetch(
      `https://howlongtobeat.com/api/bleed/init?t=${Date.now()}`,
      {
        headers,
      }
    );

    if (!initResponse.ok) {
      return res.status(500).json({
        error: "Failed to initialize token",
      });
    }

    const tokenData = await initResponse.json();

    console.log("TOKEN DATA", tokenData);

    // Perform search immediately using SAME cookies/session
    const response = await queuedFetch(
      "https://howlongtobeat.com/api/bleed",
      {
        method: "POST",
        headers: {
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
          Origin: "https://howlongtobeat.com",
          Referer: "https://howlongtobeat.com/",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "Content-Type": "application/json",
          "x-auth-token": tokenData.token,
          "x-hp-key": tokenData.hpKey,
          "x-hp-val": tokenData.hpVal,
        },
        body: JSON.stringify({
          searchType: "games",
          searchTerms: query.split(" "),
          searchPage: 1,
          size: 20,
          searchOptions: {
            games: {
              userId: 0,
              platform: "",
              sortCategory: "popular",
              rangeCategory: "main",
              rangeTime: {
                min: null,
                max: null,
              },
              gameplay: {
                perspective: "",
                flow: "",
                genre: "",
                difficulty: "",
              },
              rangeYear: {
                min: "",
                max: "",
              },
              modifier: "",
            },
            users: {
              sortCategory: "postcount",
            },
            lists: {
              sortCategory: "follows",
            },
            filter: "",
            sort: 0,
            randomizer: 0,
          },
          useCache: true,
          [tokenData.hpKey]: tokenData.hpVal,
        }),
      }
    );

    if (!response.ok) {
      
      const text = await response.text();
      console.log("SEARCH HLTB ERROR:", text);

      return res.status(response.status).json({
        error: text,
      });
    }
    const data = await response.json();

    res.json(data);
  } catch (err) {
    if (err.code === "QUEUE_FULL") {
      return res.status(503).json({ error: "Server busy, try again shortly." });
    }
    console.error(err);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

/**
 * GET /game/:gameId
 */
app.get("/game/:gameId", async (req, res) => {
  try {
    const { gameId } = req.params;

    const headers = {
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "*/*",
      Origin: "https://howlongtobeat.com",
      Referer: "https://howlongtobeat.com/",
    };

    // Establish session
    await queuedFetch("https://howlongtobeat.com/", {
      headers,
    });

    // Fetch auth tokens
    const initResponse = await queuedFetch(
      `https://howlongtobeat.com/api/bleed/init?t=${Date.now()}`,
      {
        headers,
      }
    );

    if (!initResponse.ok) {
      return res.status(500).json({
        error: "Failed to initialize token",
      });
    }

    const tokenData = await initResponse.json();

    console.log("TOKEN DATA", tokenData);

    // Perform search immediately using SAME cookies/session
    const response = await queuedFetch(
      `https://howlongtobeat.com/_next/data/5d2f7SZ64be-rX40rbL3b/game/${gameId}.json?gameId=${gameId}`,
      {
        method: "POST",
        headers: {
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "application/json",
          Origin: "https://howlongtobeat.com",
          Referer: "https://howlongtobeat.com/",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "Content-Type": "application/json",
          "x-auth-token": tokenData.token,
          "x-hp-key": tokenData.hpKey,
          "x-hp-val": tokenData.hpVal,
        }
      }
    );

    const data = await response.json();

    res.json(data);
  } catch (err) {
    if (err.code === "QUEUE_FULL") {
      return res.status(503).json({ error: "Server busy, try again shortly." });
    }
    console.error(err);

    res.status(500).json({
      error: "Internal server error",
    });
  }
});

/**
 * INIT /api/bleed/init?t=timestamp
 */
app.get("/api/find/init", async (req, res) => {
  try {
    const headers = {
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      "Priority": "u=3, i",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      Accept: "*",
      Referer: "https://howlongtobeat.com/",
      Origin: "https://howlongtobeat.com",
    };

    // First request establishes cookies/session
    await queuedFetch("https://howlongtobeat.com/", {
    headers,
    });

    // Then fetch token
    const response = await queuedFetch(
      `https://howlongtobeat.com/api/bleed/init?t=${Date.now()}`,
      {
        headers,
      }
    );

    console.log(response);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    if (err.code === "QUEUE_FULL") {
      return res.status(503).json({ error: "Server busy, try again shortly." });
    }
    console.error(err);
    res.status(500).json({
      error: "Proxy token fetch failed",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});
