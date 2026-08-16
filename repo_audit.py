#!/usr/bin/env python3
"""
repo_audit.py

Portfolio inventory and diligence scan across every repository on a GitHub
account. Built for preparing an asset sale: it produces the inventory table a
buyer asks for in the first email, and it surfaces the issues that kill deals
in diligence before a buyer finds them.

Outputs (written to --out, default ./audit_out):
  repo_inventory.csv    one row per repo, every field below
  repo_inventory.md     human readable summary, grouped by tier
  flags.md              only the repos with diligence blockers, ranked

Usage:
  export GITHUB_TOKEN=ghp_xxx
  python3 repo_audit.py
  python3 repo_audit.py --out ./audit_out --keep-clones
  python3 repo_audit.py --owner someorg --skip-forks

Token needs: repo scope (read access to private repos).
Create at https://github.com/settings/tokens

Optional but recommended, improves the secret scan a lot:
  gitleaks on PATH  (https://github.com/gitleaks/gitleaks)
The script falls back to a git pickaxe scan if gitleaks is missing.

Nothing is written to GitHub. This script is read only against your account.
"""

import argparse
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

API = "https://api.github.com"

# Files that signal a repo is a deployable product rather than an experiment
DEPLOY_MARKERS = [
    "vercel.json", "netlify.toml", "Dockerfile", "docker-compose.yml",
    "fly.toml", "render.yaml", "railway.json", "app.yaml", "Procfile",
    "next.config.js", "next.config.mjs", "next.config.ts",
    "capacitor.config.ts", "capacitor.config.json",
]

# Extensions counted as source for the rough LOC number
CODE_EXT = {
    ".js", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go", ".rs", ".java",
    ".kt", ".swift", ".c", ".h", ".cpp", ".cs", ".php", ".sh", ".sql",
    ".html", ".css", ".scss", ".vue", ".svelte",
}

DOC_EXT = {".md", ".mdx", ".txt", ".rst", ".pdf", ".docx"}

SKIP_DIRS = {
    ".git", "node_modules", "dist", "build", ".next", "out", "vendor",
    "__pycache__", ".venv", "venv", ".cache", "coverage", ".turbo",
}

# High signal literal fragments for the fallback history scan. Short list on
# purpose: git pickaxe runs once per fragment per repo.
SECRET_LITERALS = [
    "ghp_", "github_pat_", "hf_", "sk-ant-", "sk-proj-", "sk-live-",
    "AKIA", "AIza", "SUPABASE_SERVICE_ROLE", "service_role",
    "-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN OPENSSH PRIVATE KEY-----",
    "xoxb-", "SG.",
]

# Working tree regex scan, catches assignment shaped leaks the literals miss
SECRET_PATTERNS = [
    (r"(?i)\b(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['\"][A-Za-z0-9_\-\.]{16,}['\"]", "assigned credential"),
    (r"eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}", "jwt literal"),
    (r"(?i)VITE_[A-Z0-9_]*(KEY|TOKEN|SECRET)\s*[:=]", "client exposed env var"),
    (r"(?i)NEXT_PUBLIC_[A-Z0-9_]*(KEY|TOKEN|SECRET)\s*[:=]", "client exposed env var"),
]

# Copyleft strings. Any hit means the repo cannot be sold as proprietary
# without a review of what the dependency is and how it is linked.
COPYLEFT_PATTERNS = [
    (r"GNU AFFERO GENERAL PUBLIC LICENSE", "AGPL"),
    (r"GNU GENERAL PUBLIC LICENSE", "GPL"),
    (r"\bAGPL-3\.0\b", "AGPL"),
    (r"\bGPL-3\.0\b", "GPL"),
    (r"\bGPL-2\.0\b", "GPL"),
    (r"Server Side Public License", "SSPL"),
    (r"\bBUSL-1\.1\b", "BUSL"),
]

# Third party or restricted data that must be pulled out of any sale package.
# Edit this list to match your own carve outs.
RESTRICTED_TERMS = [
    "chickasaw", "chikasha", "chikashshanompa", "enrollment_number",
    "tribal_id", "phi", "protected health", "patient_record", "mrn",
    "pubmed", "hipaa", "ssn",
]

TEXT_SCAN_EXT = CODE_EXT | DOC_EXT | {".json", ".yml", ".yaml", ".env", ".toml", ".csv", ".jsonl"}

# Files with no extension that still need reading. LICENSE and COPYING are the
# reason the copyleft scan works at all.
EXTLESS_SCAN = {
    "license", "licence", "copying", "notice", "authors", "dockerfile",
    "procfile", "makefile", "readme",
}

MAX_FILE_BYTES = 2_000_000


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def api_get(path, token, params=None):
    url = API + path
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    req = Request(url, headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "repo-audit",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    try:
        with urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except HTTPError as e:
        if e.code == 401:
            log("Auth failed. Check GITHUB_TOKEN.")
            sys.exit(1)
        if e.code == 403:
            log("Rate limited or forbidden. Wait and rerun.")
            sys.exit(1)
        raise
    except URLError as e:
        log(f"Network error: {e}")
        sys.exit(1)


def list_repos(token, owner=None):
    repos = []
    page = 1
    while True:
        if owner:
            path = f"/users/{owner}/repos"
            params = {"per_page": "100", "page": str(page), "sort": "pushed"}
        else:
            path = "/user/repos"
            params = {"per_page": "100", "page": str(page),
                      "affiliation": "owner", "sort": "pushed"}
        batch = api_get(path, token, params)
        if not batch:
            break
        repos.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    return repos


def run(cmd, cwd=None, timeout=300):
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                           timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except FileNotFoundError:
        return 127, "", "not found"


def clone(full_name, token, dest):
    url = f"https://x-access-token:{token}@github.com/{full_name}.git"
    code, _, err = run(["git", "clone", "--quiet", url, str(dest)], timeout=600)
    return code == 0, err


def iter_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            yield Path(dirpath) / fn


def read_text(p):
    try:
        if p.stat().st_size > MAX_FILE_BYTES:
            return ""
        return p.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def scan_tree(root):
    loc = 0
    code_files = 0
    doc_files = 0
    deploy_hits = set()
    has_readme = False
    has_license = False
    committed_env = []
    secret_hits = []
    copyleft_hits = set()
    restricted_hits = set()
    dep_count = 0
    pkg_name = ""

    for p in iter_files(root):
        rel = str(p.relative_to(root))
        low = p.name.lower()
        ext = p.suffix.lower()

        if low.startswith("readme"):
            has_readme = True
        if low.startswith("license") or low.startswith("copying"):
            has_license = True
        if p.name in DEPLOY_MARKERS:
            deploy_hits.add(p.name)
        if low == ".env" or low.startswith(".env."):
            if not low.endswith(".example") and not low.endswith(".sample"):
                committed_env.append(rel)

        if ext in CODE_EXT:
            code_files += 1
        if ext in DOC_EXT:
            doc_files += 1

        if p.name == "package.json" and p.parent == Path(root):
            txt = read_text(p)
            try:
                pkg = json.loads(txt)
                pkg_name = pkg.get("name", "")
                dep_count = len(pkg.get("dependencies", {})) + \
                    len(pkg.get("devDependencies", {}))
            except (ValueError, AttributeError):
                pass

        if p.name in ("requirements.txt", "pyproject.toml") and p.parent == Path(root):
            txt = read_text(p)
            dep_count = max(dep_count, len([
                ln for ln in txt.splitlines()
                if ln.strip() and not ln.strip().startswith("#")
            ]))

        extless_ok = (not ext) and (low.split(".")[0] in EXTLESS_SCAN)
        if ext not in TEXT_SCAN_EXT and not low.startswith(".env") and not extless_ok:
            continue

        txt = read_text(p)
        if not txt:
            continue

        if ext in CODE_EXT:
            loc += txt.count("\n") + 1

        for pattern, label in SECRET_PATTERNS:
            m = re.search(pattern, txt)
            if m:
                secret_hits.append(f"{rel}: {label}")
                break

        for pattern, label in COPYLEFT_PATTERNS:
            if re.search(pattern, txt):
                copyleft_hits.add(label)

        low_txt = txt.lower()
        for term in RESTRICTED_TERMS:
            if term in low_txt:
                restricted_hits.add(term)

    return {
        "loc": loc,
        "code_files": code_files,
        "doc_files": doc_files,
        "deploy_markers": sorted(deploy_hits),
        "has_readme": has_readme,
        "has_license": has_license,
        "committed_env": committed_env,
        "tree_secrets": secret_hits,
        "copyleft": sorted(copyleft_hits),
        "restricted": sorted(restricted_hits),
        "dep_count": dep_count,
        "pkg_name": pkg_name,
    }


def scan_history(root, use_gitleaks):
    """Return list of findings from commit history, not just the working tree."""
    findings = []
    if use_gitleaks:
        out_file = Path(root) / ".gitleaks_report.json"
        code, _, _ = run([
            "gitleaks", "detect", "--source", str(root),
            "--report-format", "json", "--report-path", str(out_file),
            "--no-banner", "--exit-code", "0",
        ], timeout=900)
        if out_file.exists():
            try:
                data = json.loads(out_file.read_text(encoding="utf-8") or "[]")
                for item in data:
                    desc = item.get("Description", "secret")
                    f = item.get("File", "")
                    findings.append(f"{desc} in {f}")
            except ValueError:
                pass
            out_file.unlink(missing_ok=True)
        if findings or code == 0:
            return findings

    for literal in SECRET_LITERALS:
        code, out, _ = run(
            ["git", "log", "--all", "--oneline", "-S", literal, "--max-count=5"],
            cwd=root, timeout=300)
        if code == 0 and out.strip():
            n = len(out.strip().splitlines())
            findings.append(f"history contains '{literal}' in {n}+ commit(s)")
    return findings


def git_stats(root):
    code, out, _ = run(["git", "rev-list", "--count", "HEAD"], cwd=root)
    commits = int(out.strip()) if code == 0 and out.strip().isdigit() else 0
    code, out, _ = run(["git", "shortlog", "-sne", "HEAD"], cwd=root)
    contributors = len(out.strip().splitlines()) if code == 0 else 0
    code, out, _ = run(
        ["git", "log", "-1", "--format=%cI"], cwd=root)
    last_commit = out.strip() if code == 0 else ""
    return commits, contributors, last_commit


def days_since(iso):
    if not iso:
        return 9999
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return (datetime.now(timezone.utc) - dt).days
    except ValueError:
        return 9999


def assign_tier(row):
    """
    A  sellable product: deployable, documented, alive, has a live URL
    B  credible asset: real code, builds, no live presence
    C  spec or docs: value is the documentation, not the code
    D  experiment: fork, stub, or abandoned
    """
    if row["is_fork"] and row["commits"] < 20:
        return "D", "fork with little original work"
    if row["archived"]:
        return "D", "archived"

    deployable = bool(row["deploy_markers"])
    live = bool(row["homepage"])
    alive = row["days_since_push"] <= 180

    # A live URL outranks everything else. Check it before any heuristic that
    # could demote a shipped product.
    if live and (deployable or row["loc"] >= 200):
        return "A", "live URL plus working build"
    if deployable and row["has_readme"] and alive and row["loc"] >= 200:
        return "A", "deployable, documented, recent, no live URL recorded"

    docs_heavy = row["doc_files"] > 0 and row["code_files"] <= 3
    if docs_heavy and row["loc"] < 300:
        return "C", "documentation repo"

    if deployable and row["loc"] >= 200:
        return "B", "deployable but stale or undocumented"
    if row["loc"] >= 1000:
        return "B", "substantial codebase, no deploy config"
    if row["loc"] < 200 and row["commits"] < 10:
        return "D", "stub or experiment"
    return "D", "small and inactive"


def blockers_for(row):
    out = []
    if row["history_secrets"]:
        out.append("SECRETS IN HISTORY")
    if row["tree_secrets"]:
        out.append("SECRETS IN WORKING TREE")
    if row["committed_env"]:
        out.append("COMMITTED .ENV")
    if row["copyleft"]:
        out.append("COPYLEFT: " + ", ".join(row["copyleft"]))
    if row["restricted"]:
        out.append("RESTRICTED DATA: " + ", ".join(row["restricted"]))
    if row["contributors"] > 1:
        out.append("MULTIPLE CONTRIBUTORS, ip assignment needed")
    if not row["has_license"]:
        out.append("no LICENSE file")
    return out


FIELDS = [
    "name", "tier", "tier_reason", "private", "is_fork", "archived",
    "homepage", "description", "language", "loc", "code_files", "doc_files",
    "dep_count", "commits", "contributors", "last_commit", "days_since_push",
    "has_readme", "has_license", "deploy_markers", "committed_env",
    "tree_secrets", "history_secrets", "copyleft", "restricted",
    "blockers", "clone_url",
]


def main():
    ap = argparse.ArgumentParser(description="Audit every repo on a GitHub account for an asset sale.")
    ap.add_argument("--out", default="audit_out", help="output directory")
    ap.add_argument("--owner", default=None, help="audit a specific user or org instead of the token owner")
    ap.add_argument("--skip-forks", action="store_true", help="exclude forks entirely")
    ap.add_argument("--keep-clones", action="store_true", help="keep cloned repos for manual review")
    ap.add_argument("--limit", type=int, default=0, help="stop after N repos, for a test run")
    args = ap.parse_args()

    token = os.environ.get("GITHUB_TOKEN", "").strip()
    if not token:
        log("Set GITHUB_TOKEN first. Needs repo scope.")
        sys.exit(1)

    if shutil.which("git") is None:
        log("git is not installed.")
        sys.exit(1)

    use_gitleaks = shutil.which("gitleaks") is not None
    log("gitleaks: " + ("found, full history scan" if use_gitleaks
                        else "not found, falling back to git pickaxe scan"))

    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    log("Listing repositories...")
    repos = list_repos(token, args.owner)
    if args.skip_forks:
        repos = [r for r in repos if not r.get("fork")]
    if args.limit:
        repos = repos[:args.limit]
    log(f"Found {len(repos)} repositories.")

    workdir = Path(args.keep_clones and (outdir / "clones") or tempfile.mkdtemp(prefix="repoaudit_"))
    workdir.mkdir(parents=True, exist_ok=True)

    rows = []
    for i, r in enumerate(repos, 1):
        name = r["name"]
        full = r["full_name"]
        log(f"[{i}/{len(repos)}] {full}")

        dest = workdir / name
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)

        ok, err = clone(full, token, dest)
        if not ok:
            log(f"  clone failed: {err.strip()[:120]}")
            rows.append({
                **{k: "" for k in FIELDS},
                "name": name,
                "tier": "?",
                "tier_reason": "clone failed",
                "private": r.get("private"),
                "is_fork": r.get("fork"),
                "archived": r.get("archived"),
                "homepage": r.get("homepage") or "",
                "description": (r.get("description") or "").replace("\n", " "),
                "language": r.get("language") or "",
                "blockers": "CLONE FAILED",
                "clone_url": r.get("html_url", ""),
            })
            continue

        tree = scan_tree(dest)
        commits, contributors, last_commit = git_stats(dest)
        history = scan_history(dest, use_gitleaks)

        row = {
            "name": name,
            "private": bool(r.get("private")),
            "is_fork": bool(r.get("fork")),
            "archived": bool(r.get("archived")),
            "homepage": r.get("homepage") or "",
            "description": (r.get("description") or "").replace("\n", " "),
            "language": r.get("language") or "",
            "loc": tree["loc"],
            "code_files": tree["code_files"],
            "doc_files": tree["doc_files"],
            "dep_count": tree["dep_count"],
            "commits": commits,
            "contributors": contributors,
            "last_commit": last_commit,
            "days_since_push": days_since(r.get("pushed_at")),
            "has_readme": tree["has_readme"],
            "has_license": tree["has_license"],
            "deploy_markers": "; ".join(tree["deploy_markers"]),
            "committed_env": "; ".join(tree["committed_env"]),
            "tree_secrets": "; ".join(tree["tree_secrets"][:6]),
            "history_secrets": "; ".join(history[:6]),
            "copyleft": "; ".join(tree["copyleft"]),
            "restricted": "; ".join(tree["restricted"]),
            "clone_url": r.get("html_url", ""),
        }
        # assign_tier reads list shaped fields, rebuild the few it needs
        row_for_tier = dict(row)
        row_for_tier["deploy_markers"] = tree["deploy_markers"]
        tier, reason = assign_tier(row_for_tier)
        row["tier"] = tier
        row["tier_reason"] = reason

        row_for_blockers = dict(row)
        row_for_blockers["copyleft"] = tree["copyleft"]
        row_for_blockers["restricted"] = tree["restricted"]
        row_for_blockers["committed_env"] = tree["committed_env"]
        row_for_blockers["tree_secrets"] = tree["tree_secrets"]
        row_for_blockers["history_secrets"] = history
        row["blockers"] = " | ".join(blockers_for(row_for_blockers))

        rows.append(row)

        if not args.keep_clones:
            shutil.rmtree(dest, ignore_errors=True)

    if not args.keep_clones:
        shutil.rmtree(workdir, ignore_errors=True)

    csv_path = outdir / "repo_inventory.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow(row)

    order = {"A": 0, "B": 1, "C": 2, "D": 3, "?": 4}
    rows.sort(key=lambda x: (order.get(x.get("tier", "?"), 9), -int(x.get("loc") or 0)))

    md = []
    md.append("# Repository inventory")
    md.append("")
    md.append(f"Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}. "
              f"{len(rows)} repositories.")
    md.append("")
    counts = {}
    for row in rows:
        counts[row.get("tier", "?")] = counts.get(row.get("tier", "?"), 0) + 1
    md.append("| Tier | Meaning | Count |")
    md.append("| --- | --- | --- |")
    md.append(f"| A | sellable product | {counts.get('A', 0)} |")
    md.append(f"| B | credible asset | {counts.get('B', 0)} |")
    md.append(f"| C | spec or docs | {counts.get('C', 0)} |")
    md.append(f"| D | experiment | {counts.get('D', 0)} |")
    if counts.get("?"):
        md.append(f"| ? | clone failed | {counts['?']} |")
    md.append("")

    for tier in ["A", "B", "C", "D", "?"]:
        group = [r for r in rows if r.get("tier") == tier]
        if not group:
            continue
        md.append(f"## Tier {tier}")
        md.append("")
        md.append("| Repo | Live URL | LOC | Commits | Last push | Blockers |")
        md.append("| --- | --- | --- | --- | --- | --- |")
        for r in group:
            md.append("| {} | {} | {} | {} | {}d ago | {} |".format(
                r.get("name", ""),
                r.get("homepage") or "",
                r.get("loc", ""),
                r.get("commits", ""),
                r.get("days_since_push", ""),
                (r.get("blockers") or "none")[:90],
            ))
        md.append("")

    (outdir / "repo_inventory.md").write_text("\n".join(md), encoding="utf-8")

    flagged = [r for r in rows if r.get("blockers")]
    severity = ["SECRETS IN HISTORY", "RESTRICTED DATA", "SECRETS IN WORKING TREE",
                "COMMITTED .ENV", "COPYLEFT", "MULTIPLE CONTRIBUTORS"]

    def sev_rank(r):
        b = r.get("blockers", "")
        for idx, s in enumerate(severity):
            if s in b:
                return idx
        return len(severity)

    flagged.sort(key=sev_rank)

    fl = ["# Diligence blockers", "",
          "Fix these before any buyer gets read access to a repo.", "",
          f"{len(flagged)} of {len(rows)} repositories have at least one flag.", ""]
    for r in flagged:
        fl.append(f"## {r.get('name')}  (tier {r.get('tier')})")
        fl.append("")
        for b in (r.get("blockers") or "").split(" | "):
            fl.append(f"- {b}")
        if r.get("history_secrets"):
            fl.append(f"- detail: {r['history_secrets']}")
        if r.get("tree_secrets"):
            fl.append(f"- detail: {r['tree_secrets']}")
        if r.get("committed_env"):
            fl.append(f"- committed env files: {r['committed_env']}")
        fl.append("")
    (outdir / "flags.md").write_text("\n".join(fl), encoding="utf-8")

    log("")
    log(f"Wrote {csv_path}")
    log(f"Wrote {outdir / 'repo_inventory.md'}")
    log(f"Wrote {outdir / 'flags.md'}")
    log(f"Tiers: A={counts.get('A', 0)} B={counts.get('B', 0)} "
        f"C={counts.get('C', 0)} D={counts.get('D', 0)}")
    log(f"Repos with diligence blockers: {len(flagged)}")


if __name__ == "__main__":
    main()
