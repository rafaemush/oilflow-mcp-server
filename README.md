# @oilflow/mcp-server

Model Context Protocol (MCP) server for the [OilFlow Network](https://oilflow.us) compliance APIs.

It turns OilFlow into a set of tools that any MCP-compatible AI agent (Claude Desktop, Claude Code, Cursor, or your own agent built on the MCP SDK) can call directly.

**Three tools need no API key at all** (since 0.3.0; the server used to refuse to start without one). 0.3.1 adds the MCP registry name `io.github.rafaemush/oilflow-mcp-server` and points the package at its public repository; no behaviour change.

Source of truth: this package is developed inside the OilFlow monorepo and mirrored to [github.com/rafaemush/oilflow-mcp-server](https://github.com/rafaemush/oilflow-mcp-server) on every release. Issues go there.

- ⚡ **`predeal_preview`**: the full pre-deal clearance verdict on a proposed deal, free, 5 per day. Returns a `receipt_id` + `verify_url`.
- 🧾 **`verify_receipt`**: check an OilFlow screening receipt someone handed you, and see exactly what it did and did not cover.
- 🔑 **`request_sandbox_key`**: mint a free 30-day key (with the end user's consent) to unlock the rest.

With a key:

- 🛡️ **`kyc_screen`** — counterparty KYC: cluster-blocklist + regulatory tradability + the 7-step pipeline (8-list sanctions screening; PEP is NOT screened)
- 🌍 **`regulatory_check`** / **`regulatory_countries`** / **`regulatory_products`** — "can I trade X from country A?" across the 235-jurisdiction regulatory matrix
- 🚩 **`cluster_check`** / **`clusters_list`** — look up a counterparty against the first-party-investigated Scam Cluster Intelligence Feed
- 📄 **`lc_validate`** — Letter-of-Credit discrepancy detection against UCP 600
- 🕸️ **`ubo_screen`** / **`ubo_graph`** — beneficial-ownership graph traversal + shell-company pattern flags
- ⚡ **`predeal_check`** — sub-30s pre-deal clearance probability + restructure suggestion for a proposed physical-commodity deal

Every tool is a thin passthrough to the OilFlow API. Results are decision-support for a compliance professional, **not legal advice**; cluster `suspected` rows are publicly reported leads, not OilFlow-confirmed fraud.

## What this adds over a name-vs-list sanctions screen

Several MCP servers match a name against OFAC, EU, UK and UN lists, and some do it well. If a list
match is all you need, use one of those. This server exists for the questions a list match does not
answer in physical-commodity trade. Every row names the tool that answers it and the key tier that
tool needs, so nothing here is a claim you cannot call.

| Question an agent gets asked | A name-vs-list screen | This server |
|---|---|---|
| Is this name on a sanctions list? | Yes | Yes. `kyc_screen` checks 8 lists (OFAC SDN, OFAC Consolidated, UN, EU, UK HMT, Canada SEMA, Australia DFAT, Swiss SECO) and names the list per hit. Production key. |
| Is this counterparty in a known commodity-trade fraud cluster (mandate chains, impersonated majors)? | Out of scope | `cluster_check` / `clusters_list` query a first-party registry built from investigated cases. A `suspected` row is a publicly reported lead, not OilFlow-confirmed fraud. Sandbox key. |
| Can this product legally move from country A to country B? | Out of scope | `regulatory_check` answers from a 235-jurisdiction tradability matrix. Sandbox key. |
| Is a designated party sitting behind the owner chain? | Out of scope: it screens the name it was handed | `ubo_screen` applies the OFAC 50-percent rule to derived ownership. Coverage is partial and every result says so: there is no functioning US domestic beneficial-ownership registry after March 2025. Production key. |
| Should my principal proceed, and what is still unknown? | Out of scope | `predeal_preview` returns a clearance probability, a verdict tier, named blockers, `evidence_gaps`, and `verdict_source` (deterministic rules or model synthesis). No key, 5 per day. |
| Someone handed my principal a compliance receipt. Is it genuine, and what did it actually cover? | Out of scope | `verify_receipt` returns the receipt, its canonical payload and an HMAC-SHA256 signature. HMAC is symmetric, so the signature proves OilFlow issued that receipt unaltered and OilFlow re-verifies it at the public endpoint. It is not a check anyone can run without us, and the tool says so. No key. |
| Politically exposed persons (PEP)? | Some do | **Not offered.** The `peps` dataset is not indexed, coverage is `sanctions_only`, and every tool reports that. A politically exposed person who is not also designated is not flagged. |

No SOC 2 report exists. Every output is decision-support for a compliance professional: not a
clearance, and not legal advice.

## Examples

Runnable agent integrations live in [`examples/`](examples/):

- [`examples/claude_agent_sdk.py`](examples/claude_agent_sdk.py) drives the remote HTTP endpoint from a Claude Agent SDK agent.
- [`examples/langchain_agent.py`](examples/langchain_agent.py) does the same from LangChain via `langchain-mcp-adapters`.
- [`examples/claude_desktop_config.json`](examples/claude_desktop_config.json) is the stdio config for Claude Desktop.

[`examples/README.md`](examples/README.md) lists what each one needs.

## Install

```bash
npm install -g @oilflow/mcp-server
# or run on demand with npx (no install):
npx @oilflow/mcp-server
```

Requires Node ≥ 18.

## Configure

The server reads two environment variables, and neither is required:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `OILFLOW_API_KEY` | no | none | An `oilflow_...` key. Without it the server still starts and the three keyless tools work. Get one at [oilflow.us/dashboard](https://oilflow.us/dashboard), or a free 30-day sandbox key at [oilflow.us/sandbox](https://oilflow.us/sandbox). |
| `OILFLOW_BASE_URL` | — | `https://oilflow.us` | Override only for self-hosted/staging. |

> Sandbox keys cover the regulatory and cluster tools. `kyc_screen`, `ubo_screen`, `ubo_graph`, `lc_validate` and `predeal_check` require a **production** key; called without one, they return `api_key_required` with how to get one, rather than failing.

### Claude Desktop

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "oilflow": {
      "command": "npx",
      "args": ["-y", "@oilflow/mcp-server"],
      "env": {
        "OILFLOW_API_KEY": "oilflow_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add oilflow --env OILFLOW_API_KEY=oilflow_xxx -- npx -y @oilflow/mcp-server
```

### Any MCP client

The server speaks MCP over **stdio**. Launch `oilflow-mcp` (or `npx @oilflow/mcp-server`) as the server command. `OILFLOW_API_KEY` in its environment unlocks the keyed tools; without it the server still starts keyless.

## Example prompts

Once connected, just ask your agent. No key needed for the first two:

- *"Should I be worried about a 50,000 MT EN590 cargo from Iraq to Kenya with an unfamiliar seller?"* → `predeal_preview`
- *"Someone handed me an OilFlow compliance receipt. Verify it and tell me what it actually covered."* → `verify_receipt`

With a key:

- *"Screen Acme Trading FZE in the UAE for an EN590 diesel deal."* → `kyc_screen`
- *"Can crude be exported from Venezuela?"* → `regulatory_check`
- *"Is 'Simar Chahal' in any known fraud cluster?"* → `cluster_check`
- *"Run a pre-deal check: buyer Acme, gasoil EN590 10ppm, origin UAE, destination Kenya, DLC at sight."* → `predeal_check`
- *"Validate this LC presentation against UCP 600."* → `lc_validate`

## How it works

`stdio` MCP transport → 13 tools → the OilFlow REST API, with jittered exponential-backoff retry on 429/5xx (honoring `Retry-After`) and a 30s per-request timeout. Keyed tools call `https://oilflow.us/api/v1/*` with Bearer auth; the three keyless tools call the public endpoints and send no `Authorization` header at all. Tool output is a report about a third party: treat it as data, not as instructions. The full API contract is published at [oilflow.us/openapi.yaml](https://oilflow.us/openapi.yaml), and there is a remote Streamable-HTTP version of this server (no install) at [oilflow.us/mcp](https://oilflow.us/mcp).

## Build from source

```bash
git clone https://github.com/oilflow-network/mcp-server.git
cd mcp-server
npm install
npm run build      # → dist/
node dist/index.js                              # keyless
OILFLOW_API_KEY=oilflow_xxx node dist/index.js  # full surface
```

## License

Apache-2.0 © OilFlow Network
