#!/usr/bin/env python3
"""Build data/models.json for the Chinese model picker.

Sources
  1. Model list: https://docs.powertokens.ai/llms.txt (text models under zmodelChat)
  2. PowerTokens prices: POST https://powertokens.ai/api/model/pricing
     (the public endpoint behind https://powertokens.ai/pricing), USD per 1M tokens
  3. Capabilities (context, max output, tool calling, reasoning, input modalities,
     open weights, release date, description): models.dev lab files
     models/<lab>/<model>.toml. Read from a local clone if one is given via
     --models-dev / MODELS_DEV_DIR, otherwise fetched from GitHub raw.

Only the PowerTokens price is stored. No third-party or lab prices are fetched.

Usage: python3 scripts/fetch_prices.py [--models-dev /path/to/models.dev]
Python 3.11+ (tomllib). No third-party packages.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import tomllib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "models.json"

LLMS_TXT = "https://docs.powertokens.ai/llms.txt"
PRICING_API = "https://powertokens.ai/api/model/pricing"
MODELS_DEV_REPO = "https://github.com/anomalyco/models.dev"
MODELS_DEV_RAW = "https://raw.githubusercontent.com/anomalyco/models.dev/dev/models/{path}.toml"
DEFAULT_CLONE = "/workspace/clones/anomalyco_models.dev"

# Generic protocol pages in llms.txt that are not models.
NOT_MODELS = {"claude", "responses"}

# Allowlist. Only these PowerTokens model IDs are published, so a new model only
# appears after it is reviewed and added here (new IDs are reported as gaps).
# PowerTokens model ID (lower-case) -> (lab label, family label, models.dev lab path)
LAB_MAP: dict[str, tuple[str, str, str]] = {
    "minimax-m2.5": ("MiniMax", "MiniMax", "minimax/MiniMax-M2.5"),
    "minimax-m2.5-highspeed": ("MiniMax", "MiniMax", "minimax/MiniMax-M2.5-highspeed"),
    "minimax-m2.7": ("MiniMax", "MiniMax", "minimax/MiniMax-M2.7"),
    "minimax-m2.7-highspeed": ("MiniMax", "MiniMax", "minimax/MiniMax-M2.7-highspeed"),
    "minimax-m3": ("MiniMax", "MiniMax", "minimax/MiniMax-M3"),
    "qwen3.5-flash": ("Alibaba", "Qwen", "alibaba/qwen3.5-flash"),
    "qwen3.6-plus": ("Alibaba", "Qwen", "alibaba/qwen3.6-plus"),
    "qwen3.7-plus": ("Alibaba", "Qwen", "alibaba/qwen3.7-plus"),
    "qwen3.7-max": ("Alibaba", "Qwen", "alibaba/qwen3.7-max"),
    "qwen3.8-max": ("Alibaba", "Qwen", "alibaba/qwen3.8-max"),
    "qwen3.8-flash": ("Alibaba", "Qwen", "alibaba/qwen3.8-flash"),
    "qwen3-coder-plus": ("Alibaba", "Qwen", "alibaba/qwen3-coder-plus"),
    "qwen3-max": ("Alibaba", "Qwen", "alibaba/qwen3-max"),
    "deepseek-v3-2-251201": ("DeepSeek", "DeepSeek", "deepseek/deepseek-v3.2"),
    "seed-1-6-250915": ("ByteDance", "Seed", "bytedance-seed/seed-1-6"),
    "seed-1-6-flash-250715": ("ByteDance", "Seed", "bytedance-seed/seed-1-6-flash"),
    "seed-1-8-251228": ("ByteDance", "Seed", "bytedance-seed/seed-1-8"),
    "seed-2-0-lite-260228": ("ByteDance", "Seed", "bytedance-seed/seed-2.0-lite"),
    "seed-2-0-mini-260215": ("ByteDance", "Seed", "bytedance-seed/seed-2.0-mini"),
    "seed-2-0-pro-260328": ("ByteDance", "Seed", "bytedance-seed/seed-2.0-pro"),
    "dola-seed-2-1-turbo-260628": ("ByteDance", "Seed", "bytedance-seed/seed-2.1-turbo"),
    "mimo-v2.5": ("Xiaomi", "MiMo", "xiaomi/mimo-v2.5"),
    "mimo-v2.5-pro": ("Xiaomi", "MiMo", "xiaomi/mimo-v2.5-pro"),
    "glm-4.5-air": ("Zhipu AI / Z.ai", "GLM", "zhipuai/glm-4.5-air"),
    "glm-4.7": ("Zhipu AI / Z.ai", "GLM", "zhipuai/glm-4.7"),
    "glm-4.7-flash": ("Zhipu AI / Z.ai", "GLM", "zhipuai/glm-4.7-flash"),
    "glm-5": ("Zhipu AI / Z.ai", "GLM", "zhipuai/glm-5"),
    "glm-5-turbo": ("Zhipu AI / Z.ai", "GLM", "zhipuai/glm-5-turbo"),
    "glm-5.1": ("Zhipu AI / Z.ai", "GLM", "zhipuai/glm-5.1"),
    "glm-5.2": ("Zhipu AI / Z.ai", "GLM", "zhipuai/glm-5.2"),
    "glm-5.3": ("Zhipu AI / Z.ai", "GLM", "zhipuai/glm-5.3"),
    "glm-5.3-flash": ("Zhipu AI / Z.ai", "GLM", "zhipuai/glm-5.3-flash"),
}

UA = {"User-Agent": "powertokens-model-compare/1.0 (+https://github.com/PowerTokens)"}


def http_get(url: str) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def http_post_json(url: str, body: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={**UA, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def docs_text_models() -> dict[str, str]:
    """Return {lower-case id: docs page URL} for zmodelChat entries in llms.txt."""
    txt = http_get(LLMS_TXT)
    out: dict[str, str] = {}
    for m in re.finditer(r"\[([^\]]+)\]\((/api-reference/en/zmodelChat/[^)]+?)\.json\)", txt):
        mid, path = m.group(1), m.group(2)
        if mid.lower() in NOT_MODELS:
            continue
        page = "https://docs.powertokens.ai" + path.replace("/api-reference", "", 1)
        out[mid.lower()] = page
    return out


def pt_pricing() -> dict[str, dict]:
    """All chat models from the PowerTokens pricing endpoint, keyed by lower-case ID."""
    out: dict[str, dict] = {}
    page = 1
    while True:
        d = http_post_json(PRICING_API, {"model_or_provider": "", "page": page, "page_size": 200})
        data = d.get("data") or {}
        items = data.get("list") or []
        for it in items:
            if it.get("model_type") != "chat":
                continue
            out[it["upstream_id"].lower()] = it
        total = data.get("total") or 0
        if not items or page * 200 >= total:
            break
        page += 1
    return out


def price_tiers(item: dict) -> list[dict]:
    tiers = []
    for p in sorted(item.get("model_pricing_list") or [], key=lambda p: p.get("token_start") or 0):
        tiers.append({
            "from_tokens": p.get("token_start") or 0,
            "to_tokens": p.get("token_end") or None,  # None = no upper bound
            "input": p.get("sale_input_price"),
            "output": p.get("sale_output_price"),
            "cache_price": p.get("sale_cache_price"),
            "cache_hit_price": p.get("sale_input_cache_hit_price"),
        })
    return tiers


class ModelsDev:
    def __init__(self, clone: str | None):
        self.clone = Path(clone) if clone and Path(clone, "models").is_dir() else None
        self.commit = None
        self.commit_date = None
        if self.clone:
            try:
                # Cite the upstream commit (merge-base with origin/dev) when the
                # clone is on a local branch; models/ is read-only here.
                ref = "HEAD"
                try:
                    ref = subprocess.check_output(
                        ["git", "-C", str(self.clone), "merge-base", "HEAD", "origin/dev"],
                        text=True, stderr=subprocess.DEVNULL).strip() or "HEAD"
                except Exception:
                    pass
                self.commit, self.commit_date = subprocess.check_output(
                    ["git", "-C", str(self.clone), "log", "-1", "--format=%H %cs", ref], text=True
                ).split()
            except Exception:
                pass

    def load(self, path: str) -> dict | None:
        try:
            if self.clone:
                f = self.clone / "models" / f"{path}.toml"
                if not f.exists():
                    return None
                return tomllib.loads(f.read_text())
            return tomllib.loads(http_get(MODELS_DEV_RAW.format(path=path)))
        except Exception as e:  # noqa: BLE001
            print(f"  models.dev: could not load {path}: {e}", file=sys.stderr)
            return None


def derive_tags(m: dict) -> list[str]:
    """Best-for tags, derived only from models.dev descriptions/limits and PT prices."""
    tags = []
    desc = (m.get("description") or "").lower()
    name = (m["id"] + " " + (m.get("name") or "")).lower()
    if "cod" in desc or "coder" in name:
        tags.append("Coding")
    if "agent" in desc:
        tags.append("Agents")
    if (m.get("context") or 0) >= 1_000_000:
        tags.append("Long context")
    if len([x for x in (m.get("input_modalities") or []) if x != "text"]) > 0:
        tags.append("Multimodal input")
    if re.search(r"(^|[-. ])(flash|highspeed|turbo|mini|air)([-. ]|$)", name) or any(
        k in desc for k in ("low-latency", "low latency", "fast", "high-throughput", "high-speed")
    ):
        tags.append("Fast")
    out_price = m.get("pt_output")
    if out_price is not None and out_price <= 0.5:
        tags.append("Low cost")
    return tags


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models-dev", default=os.environ.get("MODELS_DEV_DIR", DEFAULT_CLONE),
                    help="path to a local models.dev clone (falls back to GitHub raw)")
    args = ap.parse_args()

    today = dt.date.today().isoformat()
    print("Fetching PowerTokens docs model list ...")
    docs = docs_text_models()
    print(f"  {len(docs)} text models in llms.txt")
    print("Fetching PowerTokens prices ...")
    prices = pt_pricing()
    print(f"  {len(prices)} chat models on the pricing endpoint")
    md = ModelsDev(args.models_dev)
    print(f"models.dev source: {'clone ' + str(md.clone) + ' @ ' + str(md.commit) if md.clone else 'GitHub raw'}")

    models, gaps, skipped = [], [], []
    for mid_l, docs_url in docs.items():
        if mid_l not in LAB_MAP:
            skipped.append(mid_l)  # printed locally only, never written to models.json
            continue
        item = prices.get(mid_l)
        if not item:
            gaps.append(f"{mid_l}: listed in docs but not on the pricing endpoint; omitted")
            continue
        lab, family, md_path = LAB_MAP[mid_l]
        cap = md.load(md_path) if md_path else None
        if md_path and cap is None:
            gaps.append(f"{mid_l}: models.dev file {md_path} not found")
        cap = cap or {}
        tiers = price_tiers(item)
        base = tiers[0] if tiers else {}
        limit = cap.get("limit") or {}
        m = {
            "id": item["upstream_id"],
            "name": item.get("name") or item["upstream_id"],
            "lab": lab,
            "family": family,
            "context": limit.get("context"),
            "max_output": limit.get("output"),
            "tool_call": cap.get("tool_call"),
            "reasoning": cap.get("reasoning"),
            "input_modalities": (cap.get("modalities") or {}).get("input"),
            "open_weights": cap.get("open_weights"),
            "release_date": cap.get("release_date"),
            "description": cap.get("description"),
            "models_dev_path": f"models/{md_path}.toml" if md_path else None,
            "pt_input": base.get("input"),
            "pt_output": base.get("output"),
            "pt_tiers": tiers,
            "pt_docs": docs_url,
            "on_powertokens": True,
        }
        m["tags"] = derive_tags(m)
        models.append(m)

    fam_order = ["DeepSeek", "GLM", "MiniMax", "MiMo", "Qwen", "Seed"]
    models.sort(key=lambda m: (fam_order.index(m["family"]) if m["family"] in fam_order else 99, m["name"]))

    for m in models:
        assert m["id"].lower() in LAB_MAP, m["id"]

    data = {
        "generated": today,
        "currency": "USD",
        "unit": "per 1M tokens",
        "sources": {
            "model_list": {"url": LLMS_TXT, "checked": today},
            "powertokens_prices": {"url": "https://powertokens.ai/pricing", "api": PRICING_API, "checked": today},
            "capabilities": {
                "name": "models.dev",
                "url": MODELS_DEV_REPO,
                "commit": md.commit,
                "commit_date": md.commit_date,
                "checked": today,
            },
        },
        "gaps": gaps,
        "models": models,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"Wrote {OUT} with {len(models)} models")
    for g in gaps:
        print("  gap:", g)
    if skipped:
        print(f"  {len(skipped)} docs model(s) not in the LAB_MAP allowlist were skipped:", file=sys.stderr)
        for x in skipped:
            print("   -", x, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
