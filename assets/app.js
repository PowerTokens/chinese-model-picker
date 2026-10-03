(function () {
  "use strict";

  var BASE_URL = "https://api.powertokens.ai/v1";
  var FAMILY_COLORS = {
    DeepSeek: "#4d6bfe", GLM: "#0d9488", MiniMax: "#e11d48", MiMo: "#f97316", Qwen: "#7c3aed", Seed: "#0ea5e9"
  };
  var TAGS = ["Coding", "Agents", "Long context", "Multimodal input", "Fast", "Low cost"];

  var state = {
    models: [], family: "All", features: {}, tags: {}, q: "",
    sortKey: "family", sortDir: 1, snippetModel: "glm-5.3", lang: "python", showAllCalc: false
  };

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtCtx(n) {
    if (!n) return "n/a";
    var base = (n % 1000 !== 0 && n % 1024 === 0) ? 1024 : 1000;
    if (n >= base * base) return (Math.round(n / (base * base) * 10) / 10).toString().replace(/\.0$/, "") + "M";
    return Math.round(n / base) + "K";
  }
  function fmtPrice(p) {
    if (p == null) return "n/a";
    var s = p.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
    if (s.indexOf(".") === -1 || s.split(".")[1].length < 2) s = p.toFixed(2);
    return "$" + s;
  }
  function fmtMoney(v) {
    if (v == null || isNaN(v)) return "n/a";
    if (v === 0) return "$0.00";
    if (v < 0.01) return "<$0.01";
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function yn(v) {
    if (v === true) return '<span class="yes" title="Yes" aria-label="Yes">✓</span>';
    if (v === false) return '<span class="no" title="No" aria-label="No">–</span>';
    return '<span class="no">n/a</span>';
  }
  function isMultimodal(m) {
    return (m.input_modalities || []).some(function (x) { return x !== "text"; });
  }
  function toast(msg) {
    var t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  // ---------- filtering & sorting ----------
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return state.models.filter(function (m) {
      if (state.family !== "All" && m.family !== state.family) return false;
      var f = state.features;
      if (f.tool_call && m.tool_call !== true) return false;
      if (f.reasoning && m.reasoning !== true) return false;
      if (f.long && !(m.context >= 1000000)) return false;
      if (f.multimodal && !isMultimodal(m)) return false;
      if (f.open && m.open_weights !== true) return false;
      for (var t in state.tags) if (state.tags[t] && m.tags.indexOf(t) === -1) return false;
      if (q) {
        var hay = [m.name, m.id, m.family, m.lab, (m.tags || []).join(" "), m.description].join(" ").toLowerCase();
        var ok = q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
        if (!ok) return false;
      }
      return true;
    });
  }
  function sortVal(m, k) {
    var v = m[k];
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v == null) return k === "name" || k === "family" ? "" : -Infinity;
    return typeof v === "string" ? v.toLowerCase() : v;
  }
  function sorted(list) {
    var k = state.sortKey, d = state.sortDir;
    return list.slice().sort(function (a, b) {
      var x = sortVal(a, k), y = sortVal(b, k);
      if (x < y) return -1 * d;
      if (x > y) return 1 * d;
      // tie-breakers
      if (k !== "family" && a.family !== b.family) return a.family < b.family ? -1 : 1;
      return a.name.localeCompare(b.name, "en", { numeric: true });
    });
  }

  // ---------- table ----------
  function tierPopup(m) {
    if (!m.pt_tiers || m.pt_tiers.length < 2) return "";
    var rows = m.pt_tiers.map(function (t) {
      var range = t.to_tokens ? (fmtCtx(t.from_tokens) === "0K" ? "≤ " + fmtCtx(t.to_tokens) : fmtCtx(t.from_tokens) + "–" + fmtCtx(t.to_tokens))
        : "> " + fmtCtx(t.from_tokens);
      return esc(range) + " prompt: " + fmtPrice(t.input) + " / " + fmtPrice(t.output);
    }).join("<br>");
    return '<span class="tier-badge" tabindex="0">tiered<span class="tier-pop">' + rows + "</span></span>";
  }
  function renderTable() {
    var list = sorted(filtered());
    var html = list.map(function (m) {
      var color = FAMILY_COLORS[m.family] || "#888";
      var mods = (m.input_modalities || []).map(function (x) { return '<span class="mod">' + esc(x) + "</span>"; }).join("");
      var tags = (m.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("");
      return "<tr>" +
        '<td class="td-model" data-label="Model"><div class="m-name">' + esc(m.name) + "</div>" +
          '<div class="m-id">' + esc(m.id) + ' <button type="button" class="use-btn" data-use="' + esc(m.id) + '" title="Use this model ID in the code snippet">Use</button></div></td>' +
        '<td data-label="Family / lab"><span class="fam"><span class="fam-dot" style="background:' + color + '"></span>' + esc(m.family) + "</span>" + (m.lab && m.lab !== m.family ? '<span class="lab">' + esc(m.lab) + "</span>" : "") + "</td>" +
        '<td class="num" data-label="Context">' + fmtCtx(m.context) + "</td>" +
        '<td class="num" data-label="Max output">' + fmtCtx(m.max_output) + "</td>" +
        '<td class="c" data-label="Tool calling">' + yn(m.tool_call) + "</td>" +
        '<td class="c" data-label="Reasoning">' + yn(m.reasoning) + "</td>" +
        '<td class="td-input" data-label="Input"><div class="mods">' + (mods || '<span class="no">n/a</span>') + "</div></td>" +
        '<td class="td-tags" data-label="Best for"><div class="tags">' + (tags || '<span class="no">–</span>') + "</div></td>" +
        '<td class="num td-price" data-label="PowerTokens $/1M in / out"><span class="price"><b>' + fmtPrice(m.pt_input) + '</b><span class="sep">/</span><b>' + fmtPrice(m.pt_output) + "</b></span>" + tierPopup(m) + "</td>" +
        '<td class="c" data-label="On PowerTokens"><a class="on-pt" href="' + esc(m.pt_docs) + '" target="_blank" rel="noopener"><span class="yes">✓</span> Docs</a></td>' +
        "</tr>";
    }).join("");
    $("#modelRows").innerHTML = html;
    $("#emptyState").hidden = list.length > 0;
    var sel = $("#sortSelect"), key = state.sortKey + ":" + state.sortDir;
    if (sel && Array.prototype.some.call(sel.options, function (o) { return o.value === key; })) sel.value = key;
    $("#resultCount").textContent = list.length + " of " + state.models.length + " models";
    $$("th[data-sort]").forEach(function (th) {
      if (th.dataset.sort === state.sortKey) th.setAttribute("aria-sort", state.sortDir === 1 ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    });
    renderCalc();
  }

  // ---------- chips ----------
  function renderChips() {
    var fams = ["All"].concat(Array.from(new Set(state.models.map(function (m) { return m.family; }))).sort());
    $("#familyChips").innerHTML = '<span class="chip-label">Family</span>' + fams.map(function (f) {
      var n = f === "All" ? state.models.length : state.models.filter(function (m) { return m.family === f; }).length;
      return '<button type="button" class="chip" data-family="' + esc(f) + '" aria-pressed="' + (state.family === f) + '">' + esc(f) + ' <span class="muted">' + n + "</span></button>";
    }).join("");
    $("#tagChips").innerHTML = '<span class="chip-label">Best for</span>' + TAGS.map(function (t) {
      return '<button type="button" class="chip" data-tag="' + esc(t) + '" aria-pressed="' + !!state.tags[t] + '">' + esc(t) + "</button>";
    }).join("");
    var fc = $("#featureChips");
    if (!fc.querySelector(".chip-label")) fc.insertAdjacentHTML("afterbegin", '<span class="chip-label">Needs</span>');
    $$("#familyChips .chip[data-family]").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.family === state.family));
      var n = b.querySelector(".muted"); if (n && b.dataset.family === state.family) n.style.color = "inherit";
    });
  }

  // ---------- calculator ----------
  function tierFor(m, promptSize) {
    var tiers = m.pt_tiers || [];
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i];
      var lo = t.from_tokens || 0, hi = t.to_tokens || Infinity;
      if (promptSize > lo && promptSize <= hi) return t;
      if (lo === 0 && promptSize <= hi) return t;
    }
    return null;
  }
  function renderCalc() {
    var inM = Math.max(0, parseFloat($("#inTok").value) || 0);
    var outM = Math.max(0, parseFloat($("#outTok").value) || 0);
    var ps = parseInt($("#promptSize").value, 10);
    var rows = filtered().map(function (m) {
      if (m.context && ps > m.context) return { m: m, skip: "context " + fmtCtx(m.context) };
      var t = tierFor(m, ps);
      if (!t) return { m: m, skip: "no price for this size" };
      return { m: m, cost: inM * t.input + outM * t.output };
    });
    var ok = rows.filter(function (r) { return !r.skip; }).sort(function (a, b) { return a.cost - b.cost; });
    var skipped = rows.filter(function (r) { return r.skip; });
    var max = ok.reduce(function (a, r) { return Math.max(a, r.cost); }, 0) || 1;
    var limit = state.showAllCalc ? ok.length : 10;
    var html = ok.slice(0, limit).map(function (r) {
      var w = Math.max(0.5, (r.cost / max) * 100);
      return '<li><span class="b-name" title="' + esc(r.m.id) + '"><span class="fam-dot" style="display:inline-block;margin-right:6px;background:' + (FAMILY_COLORS[r.m.family] || "#888") + '"></span>' + esc(r.m.name) + '</span><span class="b-track"><span class="b-fill" style="width:' + w.toFixed(1) + '%"></span></span><span class="b-val">' + fmtMoney(r.cost) + "<span class=\"muted small\">/mo</span></span></li>";
    }).join("");
    if (state.showAllCalc && skipped.length) {
      html += skipped.map(function (r) {
        return '<li class="skip"><span class="b-name">' + esc(r.m.name) + '</span><span class="small">Skipped: ' + esc(r.skip) + '</span><span></span></li>';
      }).join("");
    }
    if (!ok.length && !skipped.length) html = '<li class="skip"><span>No models match the current filters.</span></li>';
    $("#calcResults").innerHTML = html;
    var more = $("#calcMore");
    var hidden = ok.length - 10 + skipped.length;
    more.hidden = !(ok.length > 10 || skipped.length);
    more.textContent = state.showAllCalc ? "Show top 10" : "Show all (" + (ok.length + skipped.length) + ")" + (skipped.length ? ", incl. " + skipped.length + " skipped" : "");
    void hidden;
  }

  // ---------- snippet ----------
  function snippetText(lang, model) {
    if (lang === "curl") {
      return 'curl ' + BASE_URL + '/chat/completions \\\n' +
        '  -H "Authorization: Bearer $POWERTOKENS_API_KEY" \\\n' +
        '  -H "Content-Type: application/json" \\\n' +
        "  -d '{\"model\": \"" + model + "\", \"messages\": [{\"role\": \"user\", \"content\": \"Hello\"}]}'";
    }
    if (lang === "node") {
      return 'import OpenAI from "openai";\n\n' +
        'const client = new OpenAI({\n  baseURL: "' + BASE_URL + '",\n  apiKey: process.env.POWERTOKENS_API_KEY,\n});\n\n' +
        'const res = await client.chat.completions.create({\n  model: "' + model + '",\n  messages: [{ role: "user", content: "Hello" }],\n});\nconsole.log(res.choices[0].message.content);';
    }
    return 'from openai import OpenAI\n\n' +
      'client = OpenAI(\n    base_url="' + BASE_URL + '",\n    api_key=os.environ["POWERTOKENS_API_KEY"],\n)\n\n' +
      'resp = client.chat.completions.create(\n    model="' + model + '",  # any model ID from the table\n    messages=[{"role": "user", "content": "Hello"}],\n)\nprint(resp.choices[0].message.content)';
  }
  function highlight(txt) {
    var h = esc(txt);
    h = h.replace(/(&quot;[^&\n]*?&quot;)/g, '<span class="str">$1</span>');
    return h.replace(new RegExp(esc(BASE_URL).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"), "g"), '<span class="hl">' + esc(BASE_URL) + "</span>");
  }
  function renderSnippet() {
    var txt = snippetText(state.lang, state.snippetModel);
    if (state.lang === "python") txt = "import os\n" + txt;
    $("#snippet").innerHTML = highlight(txt);
    $("#snippet").dataset.raw = txt;
    $$(".tab").forEach(function (t) { t.setAttribute("aria-selected", String(t.dataset.lang === state.lang)); });
  }

  // ---------- events ----------
  function bind() {
    $("#search").addEventListener("input", function (e) { state.q = e.target.value; renderTable(); });
    document.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) {
        $$(".tier-badge.open").forEach(function (x) { x.classList.remove("open"); });
        var tb = e.target.closest(".tier-badge");
        if (tb) tb.classList.add("open");
        return;
      }
      if (b.dataset.family) { state.family = b.dataset.family; renderChips(); renderTable(); }
      else if (b.dataset.feature) {
        state.features[b.dataset.feature] = !state.features[b.dataset.feature];
        b.setAttribute("aria-pressed", String(state.features[b.dataset.feature])); renderTable();
      } else if (b.dataset.tag) {
        state.tags[b.dataset.tag] = !state.tags[b.dataset.tag];
        b.setAttribute("aria-pressed", String(state.tags[b.dataset.tag])); renderTable();
      } else if (b.dataset.use) {
        state.snippetModel = b.dataset.use; renderSnippet();
        toast("Snippet now uses " + b.dataset.use);
      } else if (b.dataset.lang) { state.lang = b.dataset.lang; renderSnippet(); }
      else if (b.dataset.preset) {
        var p = b.dataset.preset.split(",");
        $("#inTok").value = p[0]; $("#outTok").value = p[1]; $("#promptSize").value = p[2]; renderCalc();
      } else if (b.id === "calcMore") { state.showAllCalc = !state.showAllCalc; renderCalc(); }
      else if (b.id === "resetFilters") {
        state.family = "All"; state.features = {}; state.tags = {}; state.q = ""; $("#search").value = "";
        $$("#featureChips .chip").forEach(function (c) { c.setAttribute("aria-pressed", "false"); });
        renderChips(); renderTable();
      } else if (b.id === "copySnippet") {
        var raw = $("#snippet").dataset.raw;
        (navigator.clipboard ? navigator.clipboard.writeText(raw) : Promise.reject()).then(
          function () { toast("Copied"); }, function () { toast("Copy failed; select the text instead"); });
      } else if (b.id === "themeToggle") {
        var root = document.documentElement;
        var dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
        root.dataset.theme = dark ? "light" : "dark";
        localStorage.setItem("theme", root.dataset.theme);
      }
    });
    $$("th[data-sort]").forEach(function (th) {
      th.tabIndex = 0;
      var go = function () {
        var k = th.dataset.sort;
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = (k === "name" || k === "family" || k === "pt_input") ? 1 : -1; }
        renderTable();
      };
      th.addEventListener("click", go);
      th.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
    });
    $("#sortSelect").addEventListener("change", function (e) {
      var v = e.target.value.split(":"); state.sortKey = v[0]; state.sortDir = parseInt(v[1], 10); renderTable();
    });
    ["#inTok", "#outTok", "#promptSize"].forEach(function (s) { $(s).addEventListener("input", renderCalc); });
  }

  // ---------- init ----------
  fetch("data/models.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (data) {
    state.models = data.models;
    $("#modelCount").textContent = data.models.length;
    $$(".js-date").forEach(function (el) { el.textContent = data.generated; });
    var c = data.sources && data.sources.capabilities;
    if (c && c.commit) {
      $("#mdCommit").innerHTML = '<a href="https://github.com/anomalyco/models.dev/tree/' + esc(c.commit) + '" target="_blank" rel="noopener">' + esc(c.commit.slice(0, 7)) + "</a> (" + esc(c.commit_date) + ")";
    }
    renderChips(); renderSnippet(); bind(); renderTable();
  }).catch(function (e) {
    $("#modelRows").innerHTML = '<tr><td colspan="10" class="empty">Could not load data/models.json (' + esc(e.message) + "). If you opened the file directly, serve the folder over HTTP.</td></tr>";
  });
})();
