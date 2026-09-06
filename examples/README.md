# Examples

Four ways to reach OilFlow, and what each one needs. None of them is required to use the
server: the fastest path is still `npx @oilflow/mcp-server` plus the config in
[`claude_desktop_config.json`](claude_desktop_config.json).

| File | What it shows | Needs |
|---|---|---|
| [`claude_desktop_config.json`](claude_desktop_config.json) | The stdio server, launched by Claude Desktop over `npx`. | Node >= 18. `OILFLOW_API_KEY` only for the keyed tools. |
| [`claude_agent_sdk.py`](claude_agent_sdk.py) | A Claude Agent SDK agent calling the remote HTTP server and reading the verdict's gaps back to the user. | `pip install claude-agent-sdk`, `ANTHROPIC_API_KEY`. Optional: `AGENT_MODEL` (a Claude model id), `OILFLOW_API_KEY`. |
| [`langchain_agent.py`](langchain_agent.py) | The same server as LangChain tools, via `langchain-mcp-adapters`. | `pip install langchain-mcp-adapters langgraph "langchain[anthropic]"`, `ANTHROPIC_API_KEY`, and `AGENT_MODEL` (required, e.g. `anthropic:<model id>`). Optional: `OILFLOW_API_KEY`. |
| Any MCP client | `claude mcp add --transport http oilflow https://oilflow.us/api/mcp` | Nothing. Four tools answer with no key. |

Neither Python example hardcodes a model id: `AGENT_MODEL` is read from the environment
with no default, so a model bump is an env change and never a source edit.

## Two surfaces, two keyless sets

There is a stdio server (this npm package) and a remote Streamable-HTTP server at
`https://oilflow.us/api/mcp`. They carry the same tools but tier `cluster_check`
differently: it is keyless on the remote endpoint and a sandbox-key tool in the package.
Both Python examples point at the remote endpoint and say so. Read the tier off the
surface you are calling rather than assuming.

## What to hand back to your user

Every verdict carries `coverage`, `evidence_gaps` and, for pre-deal, `verdict_source`
(deterministic rules or model synthesis). Relay them. PEP screening is not offered and
coverage is `sanctions_only`, so a politically exposed person who is not also designated
is not flagged, and each tool states this itself. Output is decision-support for a
compliance professional: not a clearance, and not legal advice.
