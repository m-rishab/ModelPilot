/**
 * ModelPilot — Interactive Studio Engine v2
 * Debounced Streaming, SSE Error Handling, Logs, History, Dark Mode, Compare
 */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Model Metadata
  // ---------------------------------------------------------------------------
  const MODEL_META = {
    "openai/gpt-oss-20b": { tier: 1, name: "GPT-OSS 20B" },
    "meta/llama-3.1-70b-instruct": { tier: 2, name: "Llama 3.1 70B" },
  };

  const TIER_NAMES = { 1: "GPT-OSS 20B", 2: "Llama 3.1 70B", 3: "Llama 3.1 70B (Deep)" };
  const TIER_PRICE = { 1: 0.1, 2: 0.4, 3: 0.8 };

  const EXAMPLES = {
    light: "What is 2+2? One word.",
    code: "Write a Python function called validate_email that checks whether an address is valid using a regular expression. Return the result as a JSON object with the keys valid and reason.",
    deep: "```python\nimport threading\ncounter = 0\ndef worker():\n    global counter\n    for _ in range(100000):\n        counter += 1\n```\nAnalyze the race condition in this Python snippet. Compare fixing it with a threading.Lock versus an atomic operation, and explain the performance and memory trade-offs in detail. Return a markdown table summarizing the comparison.",
  };

  // ---------------------------------------------------------------------------
  // Difficulty Estimator (Client-side mirror of router.py)
  // ---------------------------------------------------------------------------
  const CODE_PATTERNS = [
    /```[\s\S]*?```/,
    /\b(def|class|function|const|let|var|return|import|export|from|async|await|lambda|struct|fn)\b/,
    /\b(select|insert|update|delete|from|where|join|group\s+by)\b/i,
    /(\{|\}|\(\)|=>|->|::|;)/,
    /\b(python|javascript|typescript|golang|rust|c\+\+|java|html|css|sql)\b/i,
  ];

  const REASONING_KEYWORDS = [
    /\bexplain\s+why\b/i, /\bhow\s+does\b/i, /\banalyze\b/i,
    /\bcompare\b/i, /\btrade[\s-]?offs?\b/i, /\barchitecture\b/i,
    /\bderive\b/i, /\bstep[\s-]?by[\s-]?step\b/i, /\bpros\s+and\s+cons\b/i,
    /\bdebug\b/i, /\bwhy\s+is\b/i,
  ];

  function estimateRouting(prompt) {
    if (!prompt || !prompt.trim()) {
      return { score: 0, tier: 1, signals: [
        { label: "Code / Syntax", points: 30, matched: false },
        { label: "JSON / Schema", points: 20, matched: false },
        { label: "Deep Reasoning", points: 15, matched: false },
        { label: "Long Context", points: 20, matched: false },
      ]};
    }
    const trimmed = prompt.trim();
    const words = trimmed.split(/\s+/).length;
    let score = 0;
    const signals = [];

    if (words > 500) { score += 20; signals.push({ label: "Long Context (>500w)", points: 20, matched: true }); }
    else if (words > 200) { score += 10; signals.push({ label: "Medium Context (>200w)", points: 10, matched: true }); }

    const hasCode = CODE_PATTERNS.some((re) => re.test(trimmed));
    if (hasCode) { score += 30; signals.push({ label: "Code / Syntax", points: 30, matched: true }); }
    if (/```[\s\S]*?```/.test(trimmed)) { score += 8; signals.push({ label: "Fenced Block", points: 8, matched: true }); }

    if (/\b(json|schema|strict\s+format|key-value)\b/i.test(trimmed)) { score += 20; signals.push({ label: "JSON / Schema", points: 20, matched: true }); }

    let reasonMatches = 0;
    for (const re of REASONING_KEYWORDS) { if (re.test(trimmed)) reasonMatches++; }
    if (reasonMatches > 0) { score += 15; signals.push({ label: "Reasoning Keywords", points: 15, matched: true }); }
    if (reasonMatches >= 3) { score += 8; signals.push({ label: "Multi-Cue Logic", points: 8, matched: true }); }

    if (!hasCode) signals.push({ label: "Code / Syntax", points: 30, matched: false });
    if (!/\b(json|schema)\b/i.test(trimmed)) signals.push({ label: "JSON / Schema", points: 20, matched: false });
    if (reasonMatches === 0) signals.push({ label: "Deep Reasoning", points: 15, matched: false });

    score = Math.min(100, score);
    const tier = score <= 33 ? 1 : score <= 66 ? 2 : 3;
    return { score, tier, signals };
  }

  // ---------------------------------------------------------------------------
  // UI Helpers
  // ---------------------------------------------------------------------------
  function fmtCost(usd) {
    if (usd == null || isNaN(usd) || usd === 0) return "$0.0000";
    if (usd < 0.0001) return "$" + Number(usd).toFixed(6);
    return "$" + Number(usd).toFixed(4);
  }

  function toast(message, type = "info") {
    const stack = $("toast-stack");
    if (!stack) return;
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.textContent = message;
    stack.appendChild(el);
    setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 260); }, 3200);
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return "just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    return Math.floor(diff / 86400000) + "d ago";
  }

  // ---------------------------------------------------------------------------
  // Live Preview Updates
  // ---------------------------------------------------------------------------
  function renderLivePreview() {
    const promptInput = $("prompt-input");
    if (!promptInput) return;
    const { score, tier, signals } = estimateRouting(promptInput.value);
    const scoreVal = $("preview-score-value");
    if (scoreVal) scoreVal.textContent = score;
    const fill = $("preview-score-fill");
    if (fill) { fill.style.width = score + "%"; fill.className = "meter-fill tier-" + tier; }
    const tierChip = $("preview-tier-chip");
    if (tierChip) { tierChip.textContent = "Tier " + tier; tierChip.className = "tier-badge tier-" + tier; }
    const modelName = $("preview-model-name");
    if (modelName) modelName.textContent = TIER_NAMES[tier];
    const modelPrice = $("preview-model-price");
    if (modelPrice) modelPrice.textContent = "$" + TIER_PRICE[tier].toFixed(2) + " / 1M";
    const signalsList = $("preview-signals");
    if (signalsList) {
      signalsList.innerHTML = "";
      for (const sig of signals) {
        const pill = document.createElement("span");
        pill.className = "signal-pill" + (sig.matched ? " matched" : "");
        pill.textContent = `${sig.label} (+${sig.points})`;
        signalsList.appendChild(pill);
      }
    }
    document.querySelectorAll(".fleet-row").forEach((row) => {
      const rowTier = Number(row.dataset.tier);
      row.classList.toggle("active-tier-" + rowTier, rowTier === tier);
    });
  }

  function updatePromptWordCount() {
    const promptInput = $("prompt-input");
    if (!promptInput) return;
    const text = promptInput.value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    const chars = text.length;
    const estTokens = Math.max(0, Math.round(chars / 4));
    const meta = $("prompt-meta");
    if (meta) meta.textContent = `${words} word${words === 1 ? "" : "s"} \u00b7 ~${estTokens} tok`;
  }

  // ---------------------------------------------------------------------------
  // Markdown Post-Processing & Code Frame Builder
  // ---------------------------------------------------------------------------
  function formatMarkdown(rawMarkdown) {
    if (typeof marked === "undefined") {
      const pre = document.createElement("pre");
      pre.textContent = rawMarkdown;
      return pre.outerHTML;
    }
    marked.setOptions({ gfm: true, breaks: true });
    let html = marked.parse(rawMarkdown);
    if (typeof DOMPurify !== "undefined") {
      html = DOMPurify.sanitize(html);
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("pre").forEach((pre) => {
      const code = pre.querySelector("code");
      const text = code ? code.innerText : pre.innerText;
      let lang = "code";
      if (code) {
        const cls = code.className || "";
        const m = cls.match(/language-([a-zA-Z0-9_-]+)/);
        if (m) lang = m[1];
      }
      const frame = doc.createElement("div");
      frame.className = "code-frame";
      const header = doc.createElement("div");
      header.className = "code-header";
      const badge = doc.createElement("span");
      badge.className = "code-lang-badge";
      badge.textContent = lang;
      const copyBtn = doc.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "btn-code-copy";
      copyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5" /></svg><span>Copy</span>`;
      copyBtn.setAttribute("data-clipboard", encodeURIComponent(text));
      header.append(badge, copyBtn);
      frame.append(header, pre.cloneNode(true));
      pre.replaceWith(frame);
    });
    return doc.body.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // Debounced Markdown Renderer
  // ---------------------------------------------------------------------------
  let _renderTimer = null;
  let _pendingText = "";

  function debouncedRender(text, responseBody) {
    _pendingText = text;
    if (_renderTimer) return;
    _renderTimer = setTimeout(() => {
      _renderTimer = null;
      if (responseBody && _pendingText) {
        responseBody.innerHTML = formatMarkdown(_pendingText);
      }
    }, 150);
  }

  function flushRender(text, responseBody) {
    if (_renderTimer) { clearTimeout(_renderTimer); _renderTimer = null; }
    if (responseBody && text) {
      responseBody.innerHTML = formatMarkdown(text);
    }
  }

  // ---------------------------------------------------------------------------
  // Telemetry Updates
  // ---------------------------------------------------------------------------
  function updateTelemetry(data) {
    const meta = MODEL_META[data.model_selected] || { tier: 3, name: data.model_selected };
    const tier = data.tier || meta.tier;
    if (data.tier === 3) meta.name = TIER_NAMES[3];

    const badge = $("tele-model-badge");
    if (badge) badge.className = "active-model-badge tier-" + tier;
    const modelName = $("tele-model-name");
    if (modelName) modelName.textContent = meta.name;

    const metaRow = $("response-meta");
    if (metaRow) {
      metaRow.innerHTML = "";
      const chips = [
        `Score ${data.routing_score}`,
        `${Math.round(data.latency_ms)} ms`,
        `${(data.tokens_in + data.tokens_out).toLocaleString()} tok`,
        fmtCost(data.cost_usd),
      ];
      for (const text of chips) {
        const chip = document.createElement("span");
        chip.className = "tele-chip mono";
        chip.textContent = text;
        metaRow.appendChild(chip);
      }
      metaRow.hidden = false;
    }

    const totalTokens = data.tokens_in + data.tokens_out;
    const tier3Cost = (TIER_PRICE[3] * totalTokens) / 1_000_000;
    const banner = $("savings-banner");
    const savingsText = $("savings-text");
    if (banner && savingsText) {
      if (tier === 3) {
        banner.hidden = false;
        savingsText.textContent = "Tier-3 Maximum Precision Baseline";
      } else if (tier3Cost > 0) {
        const saved = tier3Cost - data.cost_usd;
        const pct = Math.round((saved / tier3Cost) * 100);
        banner.hidden = false;
        savingsText.textContent = `Saved ${fmtCost(saved)} (${pct}%) vs T3`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Request Execution (Streaming with SSE Error Handling)
  // ---------------------------------------------------------------------------
  let currentController = null;
  let _lastPrompt = "";

  async function handleRouteSubmit() {
    const promptInput = $("prompt-input");
    if (!promptInput) return;
    const prompt = promptInput.value.trim();
    if (!prompt) { toast("Please enter a prompt first.", "error"); promptInput.focus(); return; }

    _lastPrompt = prompt;
    const btn = $("submit-btn");
    const emptyState = $("response-empty");
    const loadingState = $("response-loading");
    const responseBody = $("response-body");
    const copyBtn = $("copy-btn");
    const loadingLabel = $("loading-label");
    const connectionBanner = $("connection-banner");
    const canvasCard = $("canvas-card");

    const setCanvasState = (mode) => {
      if (!canvasCard) return;
      canvasCard.classList.toggle("is-empty", mode === "empty");
      canvasCard.classList.toggle("is-loading", mode === "loading");
      canvasCard.classList.toggle("has-response", mode === "response");
    };

    if (btn) { btn.disabled = true; btn.classList.add("is-loading"); }
    if (emptyState) emptyState.hidden = true;
    if (loadingState) loadingState.hidden = false;
    if (connectionBanner) connectionBanner.hidden = true;
    setCanvasState("loading");
    if (responseBody) { responseBody.hidden = true; responseBody.innerHTML = ""; }
    if (copyBtn) copyBtn.hidden = true;

    const { score, tier } = estimateRouting(prompt);
    if (loadingLabel) loadingLabel.textContent = `Routing to ${TIER_NAMES[tier]} (Score ${score})...`;

    const teleBadge = $("tele-model-badge");
    const teleName = $("tele-model-name");
    if (teleBadge) teleBadge.className = "active-model-badge tier-" + tier;
    if (teleName) teleName.textContent = TIER_NAMES[tier];

    if (currentController) currentController.abort();
    currentController = new AbortController();

    try {
      const res = await fetch("/api/route/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal: currentController.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";
      let streamTimedOut = false;
      const streamTimeout = setTimeout(() => { streamTimedOut = true; }, 120000);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (streamTimedOut) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.replace(/^data:\s*/, "");
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === "meta") {
              if (loadingLabel) loadingLabel.textContent = `Generating via ${event.model_name || event.model_selected}...`;
              if (teleBadge) teleBadge.className = "active-model-badge tier-" + (event.tier || tier);
              if (teleName) teleName.textContent = event.model_name || event.model_selected;
            } else if (event.type === "delta" || event.type === "chunk") {
              accumulatedText += event.text || "";
              if (loadingState) loadingState.hidden = true;
              setCanvasState("response");
              if (responseBody) {
                responseBody.hidden = false;
                debouncedRender(accumulatedText, responseBody);
              }
              if (copyBtn) copyBtn.hidden = false;
            } else if (event.type === "done") {
              clearTimeout(streamTimeout);
              if (loadingState) loadingState.hidden = true;
              if (event.text && !accumulatedText) accumulatedText = event.text;
              setCanvasState("response");
              flushRender(accumulatedText, responseBody);
              if (responseBody) responseBody.hidden = false;
              if (copyBtn) copyBtn.hidden = false;
              updateTelemetry(event);
            } else if (event.type === "error") {
              throw new Error(event.detail || event.message || "Streaming error");
            }
          } catch (parseErr) {
            if (parseErr.message && !parseErr.message.includes("JSON")) {
              throw parseErr;
            }
          }
        }
      }
      clearTimeout(streamTimeout);

      if (accumulatedText && responseBody) {
        flushRender(accumulatedText, responseBody);
        if (copyBtn) copyBtn.hidden = false;
      }
      refreshStats();
      loadLogs();
    } catch (err) {
      if (err.name === "AbortError") {
        if (loadingState) loadingState.hidden = true;
        if (!responseBody || responseBody.hidden) {
          if (emptyState) emptyState.hidden = false;
          setCanvasState("empty");
        }
        toast("Request cancelled.", "info");
        return;
      }

      // Show connection banner for network errors
      if (connectionBanner && (err.message.includes("fetch") || err.message.includes("network") || err.message.includes("Failed"))) {
        connectionBanner.hidden = false;
      }

      console.warn("Streaming failed, falling back:", err);

      // Fallback to standard POST
      try {
        const fallbackRes = await fetch("/api/route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
        });
        if (!fallbackRes.ok) {
          const errData = await fallbackRes.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${fallbackRes.status}`);
        }
        const data = await fallbackRes.json();
        const responseText = data.response || data.response_text || data.text || "";
        if (loadingState) loadingState.hidden = true;
        if (connectionBanner) connectionBanner.hidden = true;
        setCanvasState("response");
        if (responseBody) { responseBody.hidden = false; responseBody.innerHTML = formatMarkdown(responseText); }
        if (copyBtn) copyBtn.hidden = false;
        updateTelemetry(data);
        refreshStats();
        loadLogs();
      } catch (innerErr) {
        if (loadingState) loadingState.hidden = true;
        if (emptyState) emptyState.hidden = false;
        setCanvasState("empty");
        toast("Error: " + innerErr.message, "error");
      }
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove("is-loading"); }
    }
  }

  // ---------------------------------------------------------------------------
  // Comparison Mode
  // ---------------------------------------------------------------------------
  async function handleCompare() {
    const promptInput = $("prompt-input");
    if (!promptInput) return;
    const prompt = promptInput.value.trim();
    if (!prompt) { toast("Enter a prompt first.", "error"); return; }

    const compareContainer = $("compare-container");
    const canvasCard = $("canvas-card");
    if (!compareContainer) return;

    compareContainer.hidden = false;
    if (canvasCard) canvasCard.hidden = true;

    const bodyA = $("compare-body-a");
    const bodyB = $("compare-body-b");
    if (bodyA) bodyA.innerHTML = '<p class="compare-placeholder">Loading Tier 1 response...</p>';
    if (bodyB) bodyB.innerHTML = '<p class="compare-placeholder">Loading Tier 3 response...</p>';

    try {
      const res = await fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, tier_a: 1, tier_b: 3 }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();

      const tierA = data.tier_1;
      const tierB = data.tier_3;

      if (tierA && bodyA) {
        const tierBadge = $("compare-tier-a");
        const modelLabel = $("compare-model-a");
        if (tierBadge) tierBadge.textContent = `Tier ${tierA.tier}`;
        if (modelLabel) modelLabel.textContent = tierA.label;
        bodyA.innerHTML = `
          <div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap">
            <span class="tele-chip mono">${Math.round(tierA.latency_ms)} ms</span>
            <span class="tele-chip mono">${(tierA.tokens_in + tierA.tokens_out).toLocaleString()} tok</span>
            <span class="tele-chip mono">${fmtCost(tierA.cost_usd)}</span>
          </div>
          <div class="markdown-article">${formatMarkdown(tierA.response)}</div>
        `;
      }

      if (tierB && bodyB) {
        const tierBadge = $("compare-tier-b");
        const modelLabel = $("compare-model-b");
        if (tierBadge) tierBadge.textContent = `Tier ${tierB.tier}`;
        if (modelLabel) modelLabel.textContent = tierB.label;
        bodyB.innerHTML = `
          <div style="margin-bottom:10px;display:flex;gap:6px;flex-wrap:wrap">
            <span class="tele-chip mono">${Math.round(tierB.latency_ms)} ms</span>
            <span class="tele-chip mono">${(tierB.tokens_in + tierB.tokens_out).toLocaleString()} tok</span>
            <span class="tele-chip mono">${fmtCost(tierB.cost_usd)}</span>
          </div>
          <div class="markdown-article">${formatMarkdown(tierB.response)}</div>
        `;
      }

      refreshStats();
    } catch (err) {
      toast("Comparison failed: " + err.message, "error");
      if (bodyA) bodyA.innerHTML = '<p class="compare-placeholder">Error loading</p>';
      if (bodyB) bodyB.innerHTML = '<p class="compare-placeholder">Error loading</p>';
    }
  }

  // ---------------------------------------------------------------------------
  // Session Stats
  // ---------------------------------------------------------------------------
  async function refreshStats() {
    try {
      const res = await fetch("/api/stats");
      if (!res.ok) return;
      const stats = await res.json();
      const reqEl = $("stat-requests");
      if (reqEl) reqEl.textContent = (stats.total_requests || 0).toLocaleString();
      const tokEl = $("stat-tokens");
      if (tokEl) tokEl.textContent = ((stats.total_tokens_in || 0) + (stats.total_tokens_out || 0)).toLocaleString();
      const spendEl = $("stat-spend");
      if (spendEl) spendEl.textContent = fmtCost(stats.total_cost_usd);
    } catch (e) { /* silent */ }
  }

  // ---------------------------------------------------------------------------
  // Logs Table
  // ---------------------------------------------------------------------------
  async function loadLogs() {
    const tbody = $("logs-tbody");
    if (!tbody) return;
    try {
      const res = await fetch("/api/logs?limit=25");
      if (!res.ok) return;
      const logs = await res.json();
      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="9" class="logs-empty">No requests yet</td></tr>';
        return;
      }
      tbody.innerHTML = logs.map((log) => {
        const tierClass = `tier-${log.tier}`;
        const favClass = log.favorites ? "active" : "";
        return `<tr>
          <td>${timeAgo(log.created_at)}</td>
          <td class="prompt-cell" title="${(log.prompt_snippet || "").replace(/"/g, "&quot;")}">${log.prompt_snippet || ""}</td>
          <td class="mono">${log.routing_score}</td>
          <td class="tier-cell"><span class="tier-badge ${tierClass}" style="font-size:9px;padding:1px 6px">T${log.tier}</span></td>
          <td style="font-size:11px">${log.model_selected.split("/").pop()}</td>
          <td class="mono" style="font-size:11px">${(log.tokens_in + log.tokens_out).toLocaleString()}</td>
          <td class="mono" style="font-size:11px">${Math.round(log.latency_ms)}ms</td>
          <td class="mono" style="font-size:11px">${fmtCost(log.cost_usd)}</td>
          <td><button class="fav-btn ${favClass}" data-log-id="${log.id}" title="Favorite">${log.favorites ? "\u2605" : "\u2606"}</button></td>
        </tr>`;
      }).join("");
    } catch (e) { /* silent */ }
  }

  async function toggleFavorite(logId) {
    try {
      const res = await fetch("/api/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ log_id: logId }),
      });
      if (res.ok) loadLogs();
    } catch (e) { /* silent */ }
  }

  // ---------------------------------------------------------------------------
  // Command Palette (Prompt History)
  // ---------------------------------------------------------------------------
  let _cmdActive = false;
  let _cmdSelectedIdx = -1;

  function openCommandPalette() {
    const overlay = $("cmd-overlay");
    const input = $("cmd-input");
    if (!overlay || !input) return;
    overlay.hidden = false;
    _cmdActive = true;
    _cmdSelectedIdx = -1;
    input.value = "";
    input.focus();
    loadCmdResults("");
  }

  function closeCommandPalette() {
    const overlay = $("cmd-overlay");
    if (overlay) overlay.hidden = true;
    _cmdActive = false;
  }

  async function loadCmdResults(query) {
    const results = $("cmd-results");
    if (!results) return;
    try {
      const url = query ? `/api/history/search?q=${encodeURIComponent(query)}` : "/api/history?limit=30";
      const res = await fetch(url);
      if (!res.ok) return;
      const items = await res.json();
      if (!items.length) {
        results.innerHTML = '<p class="cmd-empty">No history found</p>';
        return;
      }
      results.innerHTML = items.map((item, i) => {
        const tierClass = `tier-${item.tier}`;
        const snippet = (item.full_prompt || "").substring(0, 80);
        return `<div class="cmd-item" data-prompt="${(item.full_prompt || "").replace(/"/g, "&quot;").replace(/</g, "&lt;")}" data-idx="${i}">
          <span class="cmd-item-prompt">${snippet}</span>
          <div class="cmd-item-meta">
            <span class="cmd-item-tier ${tierClass}">T${item.tier}</span>
            <span class="cmd-item-count">${item.use_count}x</span>
          </div>
        </div>`;
      }).join("");
    } catch (e) {
      results.innerHTML = '<p class="cmd-empty">Failed to load history</p>';
    }
  }

  // ---------------------------------------------------------------------------
  // Dark Mode
  // ---------------------------------------------------------------------------
  function initTheme() {
    const saved = localStorage.getItem("mp-theme");
    const theme = saved || "light";
    document.documentElement.setAttribute("data-theme", theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("mp-theme", next);
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    renderLivePreview();
    updatePromptWordCount();
    refreshStats();
    loadLogs();

    // Textarea events
    const promptInput = $("prompt-input");
    if (promptInput) {
      promptInput.addEventListener("input", () => { updatePromptWordCount(); renderLivePreview(); });
      promptInput.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); handleRouteSubmit(); }
        if (e.key === "Escape") {
          if (_cmdActive) { closeCommandPalette(); return; }
          promptInput.value = "";
          updatePromptWordCount();
          renderLivePreview();
        }
      });
    }

    // Clear button
    const clearBtn = $("clear-prompt-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (promptInput) { promptInput.value = ""; updatePromptWordCount(); renderLivePreview(); promptInput.focus(); }
      });
    }

    // Presets
    document.querySelectorAll(".preset-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.example;
        if (EXAMPLES[key] && promptInput) {
          promptInput.value = EXAMPLES[key];
          updatePromptWordCount();
          renderLivePreview();
          promptInput.focus();
          document.querySelectorAll(".preset-pill").forEach((p) => p.classList.remove("active"));
          btn.classList.add("active");
          setTimeout(() => btn.classList.remove("active"), 1200);
        }
      });
    });

    // Submit
    const submitBtn = $("submit-btn");
    if (submitBtn) submitBtn.addEventListener("click", handleRouteSubmit);

    // Compare
    const compareBtn = $("compare-btn");
    if (compareBtn) compareBtn.addEventListener("click", handleCompare);

    const compareCloseBtn = $("compare-close-btn");
    if (compareCloseBtn) {
      compareCloseBtn.addEventListener("click", () => {
        const cc = $("compare-container");
        const canvasCard = $("canvas-card");
        if (cc) cc.hidden = true;
        if (canvasCard) canvasCard.hidden = false;
      });
    }

    // Copy response
    const copyBtn = $("copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const body = $("response-body");
        if (!body) return;
        try { await navigator.clipboard.writeText(body.innerText); toast("Copied!", "success"); }
        catch { toast("Failed to copy.", "error"); }
      });
    }

    // Code block copy delegation
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest(".btn-code-copy");
      if (!btn) return;
      const raw = btn.getAttribute("data-clipboard");
      if (!raw) return;
      try {
        const text = decodeURIComponent(raw);
        await navigator.clipboard.writeText(text);
        const span = btn.querySelector("span");
        if (span) { span.textContent = "Copied!"; setTimeout(() => { span.textContent = "Copy"; }, 1500); }
      } catch { toast("Failed to copy.", "error"); }
    });

    // Favorites delegation
    document.addEventListener("click", (e) => {
      const favBtn = e.target.closest(".fav-btn");
      if (favBtn) {
        const logId = Number(favBtn.dataset.logId);
        if (logId) toggleFavorite(logId);
      }
    });

    // Theme toggle
    const themeToggle = $("theme-toggle");
    if (themeToggle) themeToggle.addEventListener("click", toggleTheme);

    // History toggle
    const historyToggle = $("history-toggle-btn");
    if (historyToggle) historyToggle.addEventListener("click", openCommandPalette);

    // Refresh logs
    const refreshLogsBtn = $("refresh-logs-btn");
    if (refreshLogsBtn) refreshLogsBtn.addEventListener("click", loadLogs);

    // Connection banner retry
    const retryBtn = $("retry-btn");
    if (retryBtn) retryBtn.addEventListener("click", () => {
      const banner = $("connection-banner");
      if (banner) banner.hidden = true;
      handleRouteSubmit();
    });

    // Command palette events
    const cmdInput = $("cmd-input");
    if (cmdInput) {
      let debounceTimer;
      cmdInput.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => loadCmdResults(cmdInput.value), 200);
      });
      cmdInput.addEventListener("keydown", (e) => {
        const items = document.querySelectorAll(".cmd-item");
        if (e.key === "Escape") { closeCommandPalette(); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); _cmdSelectedIdx = Math.min(_cmdSelectedIdx + 1, items.length - 1); updateCmdSelection(items); }
        if (e.key === "ArrowUp") { e.preventDefault(); _cmdSelectedIdx = Math.max(_cmdSelectedIdx - 1, 0); updateCmdSelection(items); }
        if (e.key === "Enter" && _cmdSelectedIdx >= 0 && items[_cmdSelectedIdx]) {
          const prompt = items[_cmdSelectedIdx].dataset.prompt;
          if (promptInput && prompt) {
            promptInput.value = prompt;
            updatePromptWordCount();
            renderLivePreview();
          }
          closeCommandPalette();
        }
      });
    }

    // Command palette item click delegation
    document.addEventListener("click", (e) => {
      const item = e.target.closest(".cmd-item");
      if (item && promptInput) {
        promptInput.value = item.dataset.prompt || "";
        updatePromptWordCount();
        renderLivePreview();
        closeCommandPalette();
        promptInput.focus();
      }
    });

    // Command palette overlay click to close
    const cmdOverlay = $("cmd-overlay");
    if (cmdOverlay) {
      cmdOverlay.addEventListener("click", (e) => {
        if (e.target === cmdOverlay) closeCommandPalette();
      });
    }

    // Settings modal
    const settingsOverlay = $("settings-overlay");
    const settingsCloseBtn = $("settings-close-btn");
    if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", () => { if (settingsOverlay) settingsOverlay.hidden = true; });
    if (settingsOverlay) {
      settingsOverlay.addEventListener("click", (e) => { if (e.target === settingsOverlay) settingsOverlay.hidden = true; });
      // Load key status
      fetch("/api/key-status").then(r => r.json()).then(data => {
        const display = $("api-key-display");
        if (display) display.textContent = data.configured ? data.masked : "Not configured";
      }).catch(() => {});
    }

    // Settings controls
    const settingTemp = $("setting-temp");
    const settingTempVal = $("setting-temp-val");
    if (settingTemp && settingTempVal) {
      settingTemp.addEventListener("input", () => { settingTempVal.textContent = settingTemp.value; });
    }

    // Global keyboard shortcuts
    document.addEventListener("keydown", (e) => {
      // Cmd+K = command palette
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (_cmdActive) closeCommandPalette();
        else openCommandPalette();
      }
    });
  });

  function updateCmdSelection(items) {
    items.forEach((item, i) => {
      item.classList.toggle("active", i === _cmdSelectedIdx);
    });
  }
})();
