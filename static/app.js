/**
 * ModelPilot — Interactive Studio Engine
 * Dynamic Complexity Scoring, Streaming, Telemetry, and Aurora Particle Background
 */

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------------------
  // Model Metadata & Fleet Specs
  // ---------------------------------------------------------------------------
  const MODEL_META = {
    "openai/gpt-oss-20b": { tier: 1, name: "GPT-OSS 20B" },
    "meta/llama-3.1-70b-instruct": { tier: 2, name: "Llama 3.1 70B" },
  };

  const TIER_NAMES = {
    1: "GPT-OSS 20B",
    2: "Llama 3.1 70B",
    3: "Llama 3.1 70B (Deep)",
  };

  const TIER_PRICE = {
    1: 0.1,
    2: 0.4,
    3: 0.8,
  };

  const EXAMPLES = {
    light: "What is 2+2? One word.",
    code: "Write a Python function called validate_email that checks whether an address is valid using a regular expression. Return the result as a JSON object with the keys valid and reason.",
    deep: "```python\nimport threading\ncounter = 0\ndef worker():\n    global counter\n    for _ in range(100000):\n        counter += 1\n```\nAnalyze the race condition in this Python snippet. Compare fixing it with a threading.Lock versus an atomic operation, and explain the performance and memory trade-offs in detail. Return a markdown table summarizing the comparison.",
  };

  // ---------------------------------------------------------------------------
  // Canvas Ambient Aurora & Particle Constellation
  // ---------------------------------------------------------------------------
  class AuroraField {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.particles = [];
      this.numParticles = 38;
      this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      this.targetMouse = { ...this.mouse };
      this.time = 0;

      this.resize = this.resize.bind(this);
      this.onMouseMove = this.onMouseMove.bind(this);
      this.render = this.render.bind(this);

      this.init();
    }

    init() {
      this.resize();
      window.addEventListener("resize", this.resize, { passive: true });
      window.addEventListener("mousemove", this.onMouseMove, { passive: true });

      for (let i = 0; i < this.numParticles; i++) {
        this.particles.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          vx: (Math.random() - 0.5) * 0.45,
          vy: (Math.random() - 0.5) * 0.45,
          radius: Math.random() * 2.2 + 1.2,
          hue: Math.random() > 0.5 ? 245 : 180,
          alpha: Math.random() * 0.45 + 0.2,
        });
      }

      requestAnimationFrame(this.render);
    }

    resize() {
      this.width = this.canvas.width = window.innerWidth;
      this.height = this.canvas.height = window.innerHeight;
    }

    onMouseMove(e) {
      this.targetMouse.x = e.clientX;
      this.targetMouse.y = e.clientY;
    }

    render() {
      this.time += 0.006;
      this.mouse.x += (this.targetMouse.x - this.mouse.x) * 0.06;
      this.mouse.y += (this.targetMouse.y - this.mouse.y) * 0.06;

      const { ctx, width, height } = this;
      ctx.clearRect(0, 0, width, height);

      // 1. Soft Volumetric Gradient Blobs
      const blob1X = width * 0.25 + Math.sin(this.time * 0.7) * 90;
      const blob1Y = height * 0.3 + Math.cos(this.time * 0.6) * 70;
      const g1 = ctx.createRadialGradient(blob1X, blob1Y, 10, blob1X, blob1Y, 480);
      g1.addColorStop(0, "rgba(99, 102, 241, 0.08)");
      g1.addColorStop(1, "rgba(99, 102, 241, 0)");
      ctx.fillStyle = g1;
      ctx.fillRect(0, 0, width, height);

      const blob2X = width * 0.75 + Math.cos(this.time * 0.8) * 110;
      const blob2Y = height * 0.65 + Math.sin(this.time * 0.5) * 90;
      const g2 = ctx.createRadialGradient(blob2X, blob2Y, 10, blob2X, blob2Y, 520);
      g2.addColorStop(0, "rgba(6, 182, 212, 0.06)");
      g2.addColorStop(1, "rgba(6, 182, 212, 0)");
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, width, height);

      // 2. Cursor Halo
      const cursorGrad = ctx.createRadialGradient(this.mouse.x, this.mouse.y, 0, this.mouse.x, this.mouse.y, 220);
      cursorGrad.addColorStop(0, "rgba(124, 58, 237, 0.07)");
      cursorGrad.addColorStop(1, "rgba(124, 58, 237, 0)");
      ctx.fillStyle = cursorGrad;
      ctx.fillRect(0, 0, width, height);

      // 3. Constellation Nodes & Connecting Filaments
      for (let i = 0; i < this.particles.length; i++) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;
        if (p.y < 0) p.y = height;
        if (p.y > height) p.y = 0;

        // Draw particle
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 80%, 65%, ${p.alpha})`;
        ctx.fill();

        // Connect nearby particles
        for (let j = i + 1; j < this.particles.length; j++) {
          const p2 = this.particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.hypot(dx, dy);

          if (dist < 130) {
            const alpha = (1 - dist / 130) * 0.16;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = `rgba(99, 102, 241, ${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      requestAnimationFrame(this.render);
    }
  }

  // ---------------------------------------------------------------------------
  // Client-Side Difficulty Estimator (Mirrors router.py)
  // ---------------------------------------------------------------------------
  const CODE_PATTERNS = [
    /```[\s\S]*?```/,
    /\b(def|class|function|const|let|var|return|import|export|from|async|await|lambda|struct|fn)\b/,
    /\b(select|insert|update|delete|from|where|join|group\s+by)\b/i,
    /(\{|\}|\(\)|=>|->|::|;)/,
    /\b(python|javascript|typescript|golang|rust|c\+\+|java|html|css|sql)\b/i,
  ];

  const REASONING_KEYWORDS = [
    /\bexplain\s+why\b/i,
    /\bhow\s+does\b/i,
    /\banalyze\b/i,
    /\bcompare\b/i,
    /\btrade[\s-]?offs?\b/i,
    /\barchitecture\b/i,
    /\bderive\b/i,
    /\bstep[\s-]?by[\s-]?step\b/i,
    /\bpros\s+and\s+cons\b/i,
    /\bdebug\b/i,
    /\bwhy\s+is\b/i,
  ];

  function estimateRouting(prompt) {
    if (!prompt || !prompt.trim()) {
      return {
        score: 0,
        tier: 1,
        signals: [
          { label: "Code / Syntax", points: 30, matched: false },
          { label: "JSON / Schema", points: 20, matched: false },
          { label: "Deep Reasoning", points: 15, matched: false },
          { label: "Long Context", points: 20, matched: false },
        ],
      };
    }

    const trimmed = prompt.trim();
    const words = trimmed.split(/\s+/).length;
    let score = 0;
    const signals = [];

    // 1. Length signals
    if (words > 500) {
      score += 20;
      signals.push({ label: "Long Context (>500w)", points: 20, matched: true });
    } else if (words > 200) {
      score += 10;
      signals.push({ label: "Medium Context (>200w)", points: 10, matched: true });
    }

    // 2. Code detection
    const hasCode = CODE_PATTERNS.some((re) => re.test(trimmed));
    if (hasCode) {
      score += 30;
      signals.push({ label: "Code / Syntax", points: 30, matched: true });
    }

    if (/```[\s\S]*?```/.test(trimmed)) {
      score += 8;
      signals.push({ label: "Fenced Block", points: 8, matched: true });
    }

    // 3. Strict JSON / Schema
    if (/\b(json|schema|strict\s+format|key-value)\b/i.test(trimmed)) {
      score += 20;
      signals.push({ label: "JSON / Schema", points: 20, matched: true });
    }

    // 4. Reasoning signals
    let reasonMatches = 0;
    for (const re of REASONING_KEYWORDS) {
      if (re.test(trimmed)) reasonMatches++;
    }
    if (reasonMatches > 0) {
      score += 15;
      signals.push({ label: "Reasoning Keywords", points: 15, matched: true });
    }
    if (reasonMatches >= 3) {
      score += 8;
      signals.push({ label: "Multi-Cue Logic", points: 8, matched: true });
    }

    // Add un-matched signals for UI clarity
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
    if (usd == null || isNaN(usd)) return "$0.0000";
    if (usd === 0) return "$0.0000";
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
    setTimeout(() => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 260);
    }, 3200);
  }

  // ---------------------------------------------------------------------------
  // Live Preview Updates
  // ---------------------------------------------------------------------------
  function renderLivePreview() {
    const promptInput = $("prompt-input");
    if (!promptInput) return;
    const prompt = promptInput.value;
    const { score, tier, signals } = estimateRouting(prompt);

    const scoreVal = $("preview-score-value");
    if (scoreVal) scoreVal.textContent = score;

    const fill = $("preview-score-fill");
    if (fill) {
      fill.style.width = score + "%";
      fill.className = "meter-fill tier-" + tier;
    }

    const tierChip = $("preview-tier-chip");
    if (tierChip) {
      tierChip.textContent = "Tier " + tier;
      tierChip.className = "tier-badge tier-" + tier;
    }

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

    // Highlight fleet row
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
    if (meta) meta.textContent = `${words} word${words === 1 ? "" : "s"} · ~${estTokens} tok`;
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

    marked.setOptions({
      gfm: true,
      breaks: true,
    });

    let html = marked.parse(rawMarkdown);
    if (typeof DOMPurify !== "undefined") {
      html = DOMPurify.sanitize(html);
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // Enhance code blocks with modern copy button & language badges
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
      copyBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5" />
        </svg>
        <span>Copy</span>
      `;
      copyBtn.setAttribute("data-clipboard", encodeURIComponent(text));

      header.append(badge, copyBtn);
      frame.append(header, pre.cloneNode(true));
      pre.replaceWith(frame);
    });

    return doc.body.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // Telemetry Updates
  // ---------------------------------------------------------------------------
  function updateTelemetry(data) {
    const meta = MODEL_META[data.model_selected] || { tier: 3, name: data.model_selected };
    // same model id can serve multiple tiers — trust the backend's tier
    const tier = data.tier || meta.tier;
    if (data.tier === 3) meta.name = TIER_NAMES[3];

    // Selected model badge
    const badge = $("tele-model-badge");
    if (badge) badge.className = "active-model-badge tier-" + tier;

    const modelName = $("tele-model-name");
    if (modelName) modelName.textContent = meta.name;

    // Header telemetry chips
    const metaRow = $("response-meta");
    if (metaRow) {
      metaRow.innerHTML = "";

      const scoreChip = document.createElement("span");
      scoreChip.className = "tele-chip mono";
      scoreChip.textContent = `Score ${data.routing_score}`;

      const latChip = document.createElement("span");
      latChip.className = "tele-chip mono";
      latChip.textContent = `${Math.round(data.latency_ms)} ms`;

      const tokChip = document.createElement("span");
      tokChip.className = "tele-chip mono";
      tokChip.textContent = `${(data.tokens_in + data.tokens_out).toLocaleString()} tok`;

      const costChip = document.createElement("span");
      costChip.className = "tele-chip mono";
      costChip.textContent = fmtCost(data.cost_usd);

      metaRow.append(scoreChip, latChip, tokChip, costChip);
      metaRow.hidden = false;
    }

    // Savings banner calculation
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
        savingsText.textContent = `Saved ${fmtCost(saved)} (${pct}%) vs T3 Baseline`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Request Execution (Streaming with Fallback)
  // ---------------------------------------------------------------------------
  let currentController = null;

  async function handleRouteSubmit() {
    const promptInput = $("prompt-input");
    if (!promptInput) return;
    const prompt = promptInput.value.trim();
    if (!prompt) {
      toast("Please enter a prompt first.", "error");
      promptInput.focus();
      return;
    }

    const btn = $("submit-btn");
    const emptyState = $("response-empty");
    const loadingState = $("response-loading");
    const responseBody = $("response-body");
    const copyBtn = $("copy-btn");
    const loadingLabel = $("loading-label");

    // Card sizing: tall hero canvas when idle/loading, content-hugging once
    // a response exists (short answers center vertically instead of
    // floating in a 520px empty card).
    const canvasCard = $("canvas-card");
    const setCanvasState = (mode) => {
      if (!canvasCard) return;
      canvasCard.classList.toggle("is-empty", mode === "empty");
      canvasCard.classList.toggle("is-loading", mode === "loading");
      canvasCard.classList.toggle("has-response", mode === "response");
    };

    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-loading");
    }

    if (emptyState) emptyState.hidden = true;
    if (loadingState) loadingState.hidden = false;
    setCanvasState("loading");
    if (responseBody) {
      responseBody.hidden = true;
      responseBody.innerHTML = "";
    }
    if (copyBtn) copyBtn.hidden = true;

    const { score, tier } = estimateRouting(prompt);
    if (loadingLabel) {
      loadingLabel.textContent = `Routing to ${TIER_NAMES[tier]} (Score ${score})…`;
    }

    // Pre-populate model badge while waiting
    const teleBadge = $("tele-model-badge");
    const teleName = $("tele-model-name");
    if (teleBadge) teleBadge.className = "active-model-badge tier-" + tier;
    if (teleName) teleName.textContent = TIER_NAMES[tier];

    if (currentController) currentController.abort();
    currentController = new AbortController();

    try {
      // 1. Try Streaming SSE Endpoint
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

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

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
              if (loadingLabel) {
                loadingLabel.textContent = `Generating via ${event.model_name || event.model_selected}…`;
              }
              if (teleBadge) teleBadge.className = "active-model-badge tier-" + (event.tier || tier);
              if (teleName) teleName.textContent = event.model_name || event.model_selected;
            } else if (event.type === "delta" || event.type === "chunk") {
              const chunkText = event.text || "";
              accumulatedText += chunkText;

              if (loadingState) loadingState.hidden = true;
              setCanvasState("response");
              if (responseBody) {
                responseBody.hidden = false;
                responseBody.innerHTML = formatMarkdown(accumulatedText);
              }
              if (copyBtn) copyBtn.hidden = false;
            } else if (event.type === "done") {
              if (loadingState) loadingState.hidden = true;
              if (event.text && !accumulatedText) {
                accumulatedText = event.text;
                setCanvasState("response");
                if (responseBody) {
                  responseBody.hidden = false;
                  responseBody.innerHTML = formatMarkdown(accumulatedText);
                }
                if (copyBtn) copyBtn.hidden = false;
              }
              updateTelemetry(event);
            } else if (event.type === "error") {
              throw new Error(event.detail || event.message || "Streaming error");
            }
          } catch (parseErr) {
            console.error("Stream parse error:", parseErr, jsonStr);
          }
        }
      }

      if (accumulatedText && responseBody) {
        responseBody.innerHTML = formatMarkdown(accumulatedText);
        if (copyBtn) copyBtn.hidden = false;
      }

      refreshStats();
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
      console.warn("Streaming failed, falling back to standard /api/route:", err);

      // Fallback: Standard POST /api/route
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
        setCanvasState("response");
        if (responseBody) {
          responseBody.hidden = false;
          responseBody.innerHTML = formatMarkdown(responseText);
        }
        if (copyBtn) copyBtn.hidden = false;

        updateTelemetry(data);
        refreshStats();
      } catch (innerErr) {
        if (loadingState) loadingState.hidden = true;
        if (emptyState) emptyState.hidden = false;
        setCanvasState("empty");
        toast("Routing error: " + innerErr.message, "error");
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("is-loading");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Session Stats (header pills)
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
    } catch (e) {
      console.error("Failed to fetch stats:", e);
    }
  }

  // ---------------------------------------------------------------------------
  // Global Event Delegation & Initialization
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    // 1. Start Aurora Background
    const canvas = $("bg-canvas");
    if (canvas) new AuroraField(canvas);

    // 2. Textarea events
    const promptInput = $("prompt-input");
    if (promptInput) {
      promptInput.addEventListener("input", () => {
        updatePromptWordCount();
        renderLivePreview();
      });

      promptInput.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          handleRouteSubmit();
        }
        if (e.key === "Escape") {
          promptInput.value = "";
          updatePromptWordCount();
          renderLivePreview();
        }
      });
    }

    // 3. Clear prompt button
    const clearBtn = $("clear-prompt-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        if (promptInput) {
          promptInput.value = "";
          updatePromptWordCount();
          renderLivePreview();
          promptInput.focus();
        }
      });
    }

    // 4. Example preset buttons
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

    // 5. Submit button
    const submitBtn = $("submit-btn");
    if (submitBtn) {
      submitBtn.addEventListener("click", handleRouteSubmit);
    }

    // 6. Copy complete response button
    const copyBtn = $("copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        const body = $("response-body");
        if (!body) return;
        try {
          await navigator.clipboard.writeText(body.innerText);
          toast("Full response copied to clipboard!", "success");
        } catch {
          toast("Failed to copy response.", "error");
        }
      });
    }

    // 7. Event delegation for code block copy buttons
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest(".btn-code-copy");
      if (!btn) return;
      const raw = btn.getAttribute("data-clipboard");
      if (!raw) return;
      try {
        const text = decodeURIComponent(raw);
        await navigator.clipboard.writeText(text);
        const originalText = btn.querySelector("span").textContent;
        btn.querySelector("span").textContent = "Copied!";
        setTimeout(() => {
          btn.querySelector("span").textContent = originalText;
        }, 1500);
      } catch {
        toast("Failed to copy code snippet.", "error");
      }
    });

    // 8. Initial Load
    renderLivePreview();
    updatePromptWordCount();
    refreshStats();
  });
})();
