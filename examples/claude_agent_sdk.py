"""Run an OilFlow pre-deal check from a Claude Agent SDK agent, over the remote HTTP endpoint.

    pip install claude-agent-sdk
    export ANTHROPIC_API_KEY=...
    export AGENT_MODEL=...        # optional; a Claude model id. No default here on
                                  # purpose: pick your own, and never hardcode one.
    export OILFLOW_API_KEY=...    # optional; the keyless tools work without it
    python examples/claude_agent_sdk.py

WHICH TOOLS NEED A KEY
======================
This example points at the REMOTE Streamable-HTTP server (https://oilflow.us/api/mcp),
where four tools are keyless: `cluster_check`, `predeal_preview`, `verify_receipt` and
`request_sandbox_key`. The npm package in this repository is the stdio server, and there
`cluster_check` is a sandbox-key tool, so the keyless set is the other three. The two
surfaces are configured separately (mcp/src/tools.ts and the platform's own catalog);
do not assume a tier from one applies to the other.

Everything else (`kyc_screen`, `ubo_screen`, `ubo_graph`, `lc_validate`, `predeal_check`)
needs a key, and returns `api_key_required` with instructions rather than an outage when
called without one.

WHAT TO DO WITH THE ANSWER
==========================
A verdict carries `coverage`, `evidence_gaps` and `verdict_source`. Read them back to the
user: a clearance probability quoted without its gaps overstates its own confidence. PEP
screening is not offered and coverage is sanctions-only, so a politically exposed person
who is not also designated is not flagged. Nothing here is a clearance or legal advice.

VERIFIED AGAINST
================
https://code.claude.com/docs/en/agent-sdk/mcp (fetched 2026-09-06) for the HTTP
`mcp_servers` shape (`type`/`url`/`headers`), the `mcp__<server>__<tool>` naming used by
`allowed_tools`, and reading the answer off `ResultMessage.result` when
`subtype == "success"`; https://code.claude.com/docs/en/agent-sdk/python for the
`ClaudeAgentOptions` field list, where `model` is `str | None` defaulting to None.
"""
import asyncio
import os

from claude_agent_sdk import ClaudeAgentOptions, ResultMessage, query

OILFLOW_MCP: dict = {
    "type": "http",
    "url": os.environ.get("OILFLOW_MCP_URL", "https://oilflow.us/api/mcp"),
}
# Keyed tools: add the bearer once a sandbox or production key exists. The server
# never sends this header on a keyless tool.
if os.environ.get("OILFLOW_API_KEY"):
    OILFLOW_MCP["headers"] = {"Authorization": f"Bearer {os.environ['OILFLOW_API_KEY']}"}

PROMPT = (
    "I've been offered 50,000 MT of EN590 from a UAE-registered trader I have not dealt "
    "with before, destination Kenya. Run an OilFlow pre-deal check and give me the "
    "clearance read, including its evidence gaps and what the check did NOT cover."
)


async def main() -> None:
    options = ClaudeAgentOptions(
        mcp_servers={"oilflow": OILFLOW_MCP},
        # Named rather than wildcarded: these four need no key, so the run cannot
        # stall on a missing credential. `mcp__oilflow__*` would also admit the
        # keyed tools.
        allowed_tools=[
            "mcp__oilflow__predeal_preview",
            "mcp__oilflow__cluster_check",
            "mcp__oilflow__verify_receipt",
            "mcp__oilflow__request_sandbox_key",
        ],
        # None means "the SDK's default model". No model id is written into this
        # file: a model bump must never be a source edit.
        model=os.environ.get("AGENT_MODEL"),
    )
    async for message in query(prompt=PROMPT, options=options):
        if isinstance(message, ResultMessage) and message.subtype == "success":
            print(message.result)


if __name__ == "__main__":
    asyncio.run(main())
