const express = require("express");
const fetch = require("node-fetch"); // v2
const app = express();
app.use(express.json({ limit: "1mb" }));

// DEFAULT free upstream (change in env if needed)
const UPSTREAM = process.env.UPSTREAM || "https://translate.argosopentech.com/translate";

// Proxy forwards request body to the upstream and returns raw response.
// Public upstreams can be rate-limited or return HTML pages; this proxy
// simply forwards whatever the upstream returns so you can inspect failures.
app.post("/translate", async (req, res) => {
  try {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    console.log(`[proxy] forwarding to ${UPSTREAM}`);
    const r = await fetch(UPSTREAM, {
      method: "POST",
      headers,
      body: JSON.stringify(req.body),
    });

    const text = await r.text(); // forward raw body so errors propagate
    res.status(r.status);
    res.set("content-type", r.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (err) {
    console.error("proxy error:", err);
    res.status(500).send({ error: String(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`proxy running http://localhost:${port}/translate -> ${UPSTREAM}`));