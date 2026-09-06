"""Use OilFlow's compliance tools from a LangChain agent, over the remote HTTP endpoint.

    pip install langchain-mcp-adapters langgraph "langchain[anthropic]"
    export ANTHROPIC_API_KEY=...
    export AGENT_MODEL=anthropic:<model id you use>   # required, no default on purpose
    export OILFLOW_API_KEY=...                        # optional; keyless tools work without it
    python examples/langchain_agent.py

WHICH TOOLS NEED A KEY
======================
Against the REMOTE server used here (https://oilflow.us/api/mcp) four tools are keyless:
`cluster_check`, `predeal_preview`, `verify_receipt` and `request_sandbox_key`. The npm
package in this repository is the stdio server and tiers `cluster_check` as a sandbox
tool, so its keyless set is the other three. Check the tier on the surface you are
actually calling.

`predeal_preview` is capped at 5 verdicts per caller per 24 hours. Exhaustion comes back
as `demo_limit_reached`, which means the free allowance is spent and NOT that OilFlow is
down, so an agent should offer the next step rather than report an outage. Every verdict
carries `coverage` and `evidence_gaps`; PEP screening is not offered, and coverage is
sanctions-only.

VERIFIED AGAINST
================
https://github.com/langchain-ai/langchain-mcp-adapters (README fetched 2026-09-06) for
`MultiServerMCPClient`, `"transport": "http"`, per-server `headers`, `await
client.get_tools()`, and `create_agent(model, tools)` imported from `langchain.agents`.
One nuance worth knowing: `langchain_mcp_adapters/sessions.py` declares the TypedDict as
`transport: Literal["streamable_http"]`, while its own dispatch accepts
`{"streamable_http", "streamable-http", "http"}`. "http" is what the README documents and
what runs; a strict type checker may prefer "streamable_http".
"""
import asyncio
import os

from langchain.agents import create_agent
from langchain_mcp_adapters.client import MultiServerMCPClient

server: dict = {
    "transport": "http",
    "url": os.environ.get("OILFLOW_MCP_URL", "https://oilflow.us/api/mcp"),
}
if os.environ.get("OILFLOW_API_KEY"):
    server["headers"] = {"Authorization": f"Bearer {os.environ['OILFLOW_API_KEY']}"}

PROMPT = (
    "Screen 'Simar Chahal' against OilFlow's fraud-cluster registry, then tell me exactly "
    "what that check does and does not cover before I act on it."
)


async def main() -> None:
    client = MultiServerMCPClient({"oilflow": server})
    tools = await client.get_tools()
    # No model id literal in this file. AGENT_MODEL is read with no default, so a
    # missing value fails loudly here instead of silently pinning some model.
    agent = create_agent(os.environ["AGENT_MODEL"], tools)
    result = await agent.ainvoke({"messages": PROMPT})
    print(result["messages"][-1].content)


if __name__ == "__main__":
    asyncio.run(main())
