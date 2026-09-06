/**
 * OilFlow MCP server — tool catalog.
 *
 * Thirteen tools mapping the OilFlow compliance API onto the Model Context
 * Protocol so any MCP-capable agent (Claude Desktop, Claude Code, Cursor,
 * etc.) can screen counterparties, check sanctions/fraud clusters, validate
 * trade tradability + letters of credit, and traverse UBO graphs.
 *
 * TIERS: THREE TOOLS NEED NO KEY
 * ==============================
 * Until 0.3.0 this package exited 1 on startup without OILFLOW_API_KEY, so an
 * agent that installed it and had no key got a dead server and no explanation
 * of how to get one. Every tool assumed a key because every tool called
 * /api/v1/*. The three keyless tools below call the PUBLIC endpoints instead
 * (the same ones the remote /api/mcp endpoint serves), so the package is useful
 * on first run and can hand the user a route to a key from inside the agent.
 *
 * Tiers mirror platform/src/app/api/mcp/tools.ts. The two catalogs are
 * deliberately NOT identical (this one assumes a desktop install and exposes
 * the polling tools the HTTP surface has no use for), but a tool that exists in
 * both must not disagree about whether it needs a key.
 *
 * TITLES + ANNOTATIONS
 * ====================
 * Every tool carries a human `title` and all four annotation hints. A client
 * with no annotations must assume a tool may be destructive, which buried the
 * read-only tools behind the same confirmation as the one that mints a
 * credential. Hints are set honestly: the verdict tools are NOT read-only,
 * because each writes a decision-ledger row and consumes quota.
 *
 * Honesty rail (mirrors the product's §8 hard constraints): tool descriptions
 * describe what the API actually returns — decision-support, not legal advice;
 * cluster "suspected" = publicly reported, not OilFlow-confirmed; AI-assisted
 * narratives ship as DRAFT for independent legal review. Every tool is a
 * passthrough; the server invents no claims of its own. PEP screening is not
 * shipped and coverage is sanctions-only, which the tools that touch sanctions
 * data state in their own descriptions because the agent is the party that has
 * to relay it.
 */

import type { OilFlowHttpClient } from "./client.js";

type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/** keyless = no Authorization header at all; sandbox = a free 30-day key is
 *  enough; production = a paid key (a sandbox key gets 403). */
export type ToolTier = "keyless" | "sandbox" | "production";

export type ToolAnnotationHints = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export interface ToolDef {
  name: string;
  /** Human-readable label. Rendered by MCP clients and directories. */
  title: string;
  tier: ToolTier;
  description: string;
  annotations: ToolAnnotationHints;
  inputSchema: JsonSchema;
  handler: (args: Record<string, unknown>, client: OilFlowHttpClient) => Promise<unknown>;
}

/** Require a non-empty string argument or throw a clear, agent-readable error. */
function reqString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    throw new Error(`Missing required argument "${key}" (expected a non-empty string).`);
  }
  return v.trim();
}

/** Require one of a fixed set of string values, or throw an agent-readable error.
 *  Used where the upstream route rejects anything else with a 400: a tool that
 *  forwards a bad value spends a call to learn what the schema already knew. */
function reqEnum(args: Record<string, unknown>, key: string, allowed: string[]): string {
  const v = reqString(args, key);
  if (!allowed.includes(v)) {
    throw new Error(
      `Invalid argument "${key}": expected one of ${allowed.join(" | ")}, got ${JSON.stringify(v)}.`,
    );
  }
  return v;
}

function optString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function optNumber(args: Record<string, unknown>, key: string): number | undefined {
  const v = args[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function optBool(args: Record<string, unknown>, key: string): boolean | undefined {
  const v = args[key];
  return typeof v === "boolean" ? v : undefined;
}

function optStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const v = args[key];
  if (Array.isArray(v)) {
    const clean = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    return clean.length ? clean : undefined;
  }
  return undefined;
}

function optObject(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = args[key];
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return undefined;
}

function reqObject(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = optObject(args, key);
  if (!v) throw new Error(`Missing required argument "${key}" (expected a JSON object).`);
  return v;
}

export const TOOLS: ToolDef[] = [
  // ── KEYLESS: work on first run, with no key and no account ──────────────
  {
    name: "predeal_preview",
    title: "Pre-deal clearance verdict (free)",
    tier: "keyless",
    annotations: {
      // Writes a decision-ledger row and burns one of 5 daily slots.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Run OilFlow's Pre-Deal Compliance check on a proposed physical-commodity deal and get a clearance probability (0-100) and verdict tier (clear/review/heavy_friction/block) with named blockers and a restructure suggestion. NO API KEY REQUIRED: this is the full verdict, not a teaser. QUOTA: 5 verdicts per caller per 24 hours; on exhaustion the error is demo_limit_reached, which means the free allowance is used up and NOT that OilFlow is down. Returns `receipt_id` and `verify_url`, so the user can hand anyone a signed record of the check, and `verdict_source` (\"claude\" = full synthesis, \"rule_based\" = deterministic fallback) plus `evidence_gaps`: relay both, because a score without them overstates its own confidence. REQUIRED INPUTS: counterparty_name, counterparty_role (buyer or seller), product and origin_country; the verdict endpoint rejects a call missing any of them, so ask the user for the missing one rather than guessing a side. Decision-support estimating how a compliance desk is likely to treat the deal. Not a clearance and not legal advice; the response carries a disclaimer, pass it on. For the keyed version with no daily cap and the full input set, use predeal_check.",
    inputSchema: {
      type: "object",
      properties: {
        counterparty_name: { type: "string", description: "The counterparty being assessed." },
        counterparty_role: {
          type: "string",
          enum: ["buyer", "seller"],
          description:
            "Which side of the deal the counterparty is on. REQUIRED: the verdict differs by side, so there is no safe default to guess. Ask the user if the deal description does not say.",
        },
        product: { type: "string", description: "e.g. 'EN590', 'Crude Oil', 'Jet A-1'." },
        origin_country: { type: "string", description: "Country of origin." },
        destination_country: { type: "string", description: "Destination country. Optional." },
        volume_mt: { type: "number", description: "Deal volume in metric tonnes (> 0). Optional." },
      },
      required: ["counterparty_name", "counterparty_role", "product", "origin_country"],
      additionalProperties: false,
    },
    // counterparty_role, product and origin_country are HARD-REQUIRED by
    // /api/v1/predeal/check, which the public proxy forwards to verbatim. The
    // 0.3.0 catalog sent none of them as required and did not even declare
    // counterparty_role, so this tool answered 400 on every possible call.
    handler: (args, client) =>
      client.request({
        method: "POST",
        path: "/api/public/predeal-check",
        body: {
          counterparty_name: reqString(args, "counterparty_name"),
          counterparty_role: reqEnum(args, "counterparty_role", ["buyer", "seller"]),
          product: reqString(args, "product"),
          origin_country: reqString(args, "origin_country"),
          destination_country: optString(args, "destination_country"),
          // volume_mt, not `volume`: the handler reads body.volume_mt and
          // ignores unknown keys, so a `volume` string was silently dropped.
          volume_mt: optNumber(args, "volume_mt"),
        },
      }),
  },

  {
    name: "verify_receipt",
    title: "Verify a screening receipt",
    tier: "keyless",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      // Closed world: only ever resolves receipts OilFlow itself issued.
      openWorldHint: false,
    },
    description:
      "Fetch and re-verify an OilFlow screening receipt. NO API KEY REQUIRED. Given a receipt id (a UUID, from `receipt_id`/`verify_url` on a verdict, or from a receipt the user was handed), returns the receipt, its canonical payload string and an HMAC-SHA256 signature. The signature proves OilFlow issued the receipt and that it has not been altered since; re-verification is performed by OilFlow at this same keyless endpoint, and it does not allow third-party verification without OilFlow (HMAC is symmetric: the verifying key is OilFlow's signing key). Say that to the user rather than implying the receipt can be validated without OilFlow. `receipt_type` says which kind of record it is: a sanctions_screen carries the list set it checked, a predeal_verdict carries the pre-deal tier plus the depth at which it consulted sanctions data. Read `coverage` back to the user: sanctions-only means PEP screening is not shipped, so a politically exposed person who is not also designated will not be flagged. Use this whenever a user has been HANDED a compliance receipt and wants to know whether it is genuine and what it actually covered.",
    inputSchema: {
      type: "object",
      properties: {
        receipt_id: { type: "string", description: "The receipt / screening id (UUID)." },
      },
      required: ["receipt_id"],
      additionalProperties: false,
    },
    handler: (args, client) =>
      client.request({
        method: "GET",
        path: `/api/public/verify/${encodeURIComponent(reqString(args, "receipt_id"))}`,
      }),
  },

  {
    name: "request_sandbox_key",
    title: "Request a free sandbox key",
    tier: "keyless",
    annotations: {
      // Mints a credential and sends an email.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Mint a free 30-day OilFlow sandbox API key (100 calls/day) scoped to the regulatory matrix and cluster endpoints, emailed to the address supplied. NO API KEY REQUIRED, which is the point: this is how an agent running keyless gets its user onto the keyed tools. CONSENT: requires the END USER'S email address and must only be called with their knowledge and agreement, because OilFlow emails the key and may send product follow-ups. Do not supply an address the user has not asked you to use. Limits: 3 keys per IP/hour, 5 per email/day. The sandbox scope does NOT cover kyc, ubo, lc or the keyed predeal endpoint; use predeal_preview for a free verdict, or https://oilflow.us/pricing for production access. Once the key arrives, set OILFLOW_API_KEY in this server's environment and restart it.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "The END USER's email, with their consent." },
        company: { type: "string", description: "Their company. Optional." },
        use_case: { type: "string", description: "What they intend to evaluate. Optional." },
      },
      required: ["email"],
      additionalProperties: false,
    },
    handler: (args, client) =>
      client.request({
        method: "POST",
        path: "/api/v1/keys/sandbox",
        body: {
          email: reqString(args, "email"),
          company: optString(args, "company"),
          use_case: optString(args, "use_case"),
        },
      }),
  },

  // ── KEYED ───────────────────────────────────────────────────────────────
  {
    name: "kyc_screen",
    title: "Counterparty KYC screen",
    tier: "production",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Run an OilFlow counterparty KYC screen: cluster-blocklist match, regulatory tradability, and the 7-step registration pipeline with 8-list sanctions screening (OFAC SDN, OFAC Consolidated, UN, EU, UK HMT, Canada SEMA, AU DFAT, Swiss SECO). PEP screening is NOT shipped — coverage is sanctions-only, so a politically exposed person who is not also designated will not be flagged; tell the user this. Sanctions/registration/asset/footprint steps run out-of-band and return as 'queued' with a poll_url. Returns a verdict (pass/review/fail) with per-check evidence. Decision-support for a compliance analyst, not a legal determination. Requires a production API key.",
    inputSchema: {
      type: "object",
      properties: {
        company_name: { type: "string", description: "Legal/trading name of the counterparty to screen." },
        country: { type: "string", description: "Full country name (e.g. 'United Arab Emirates'). Optional." },
        product: { type: "string", description: "Commodity/product the deal involves (e.g. 'EN590 diesel'). Optional." },
        listing_type: { type: "string", enum: ["supply", "demand"], description: "Counterparty's side of the trade. Defaults to 'demand'." },
        directors: { type: "array", items: { type: "string" }, description: "Named directors/officers to include in screening. Optional." },
      },
      required: ["company_name"],
      additionalProperties: false,
    },
    handler: (args, client) =>
      client.request({
        method: "POST",
        path: "/api/v1/kyc/screen",
        body: {
          company_name: reqString(args, "company_name"),
          country: optString(args, "country"),
          product: optString(args, "product"),
          listing_type: optString(args, "listing_type"),
          directors: optStringArray(args, "directors"),
          // No `metadata`: /api/v1/kyc/screen declares the field and reads it
          // nowhere, so anything an agent put there was accepted and dropped.
        },
      }),
  },

  {
    name: "regulatory_check",
    title: "Trade tradability check",
    tier: "sandbox",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Check whether a given commodity can be supplied/bought from a given jurisdiction under OilFlow's 235-jurisdiction regulatory matrix. Returns allowed:true/false plus any blockers. Compiled regulatory guidance, not legal advice — confirm with the relevant national regulator before acting.",
    inputSchema: {
      type: "object",
      properties: {
        country: { type: "string", description: "Country name or ISO-2 code (e.g. 'Nigeria' or 'NG')." },
        product: {
          type: "string",
          description:
            "Product keyword: crude, refined, diesel, gasoline, gasoil, fuel oil, fuel, naphtha, jet, kerosene, lpg, lng, or bitumen.",
        },
        listing_type: { type: "string", enum: ["supply", "demand"], description: "Trade side. Defaults to 'demand'." },
      },
      required: ["country", "product"],
      additionalProperties: false,
    },
    handler: (args, client) =>
      client.request({
        method: "GET",
        path: "/api/v1/regulatory/check",
        query: {
          country: reqString(args, "country"),
          product: reqString(args, "product"),
          listing_type: optString(args, "listing_type"),
        },
      }),
  },

  {
    name: "regulatory_countries",
    title: "List covered jurisdictions",
    tier: "sandbox",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "List every jurisdiction covered by the OilFlow regulatory matrix (235 jurisdictions). Returns a count and the country list with slugs for use in regulatory_check.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, client) => client.request({ method: "GET", path: "/api/v1/regulatory/countries" }),
  },

  {
    name: "regulatory_products",
    title: "List product categories",
    tier: "sandbox",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "List the commodity/product categories the regulatory matrix recognizes (with their canonical labels), for use as the `product` argument to regulatory_check.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: (_args, client) => client.request({ method: "GET", path: "/api/v1/regulatory/products" }),
  },

  {
    name: "cluster_check",
    title: "Fraud-cluster screen",
    tier: "sandbox",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "Look up a counterparty name against OilFlow's first-party-investigated Scam Cluster Intelligence Feed. Returns any matches with a severity: 'confirmed' (OilFlow-verified fraud), 'likely', or 'suspected' (publicly reported but NOT first-party confirmed — treat as a lead, verify the cited source). matched:false means no hit, which is not by itself an exoneration.",
    inputSchema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "Counterparty/entity name to check (>=2 alphanumeric characters)." },
        country: { type: "string", description: "Optional country filter." },
      },
      required: ["entity"],
      additionalProperties: false,
    },
    handler: (args, client) =>
      client.request({
        method: "GET",
        path: "/api/v1/clusters/check",
        query: { entity: reqString(args, "entity"), country: optString(args, "country") },
      }),
  },

  {
    name: "clusters_list",
    title: "Browse the fraud-cluster feed",
    tier: "sandbox",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    description:
      "List entries from the Scam Cluster Intelligence Feed, optionally filtered by severity, country, or date. Useful for browsing known fraud clusters. Severity 'suspected' rows are publicly reported leads, not OilFlow-confirmed.",
    inputSchema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["confirmed", "likely", "suspected"], description: "Filter by severity. Optional." },
        country: { type: "string", description: "Filter by country. Optional." },
        since: { type: "string", description: "ISO date (YYYY-MM-DD) — only entries added on/after this date. Optional." },
      },
      additionalProperties: false,
    },
    handler: (args, client) =>
      client.request({
        method: "GET",
        path: "/api/v1/clusters",
        query: {
          severity: optString(args, "severity"),
          country: optString(args, "country"),
          since: optString(args, "since"),
        },
      }),
  },

  {
    name: "lc_validate",
    title: "Letter-of-credit check (UCP 600)",
    tier: "production",
    annotations: {
      // Pure document examination: nothing is written.
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Validate a Letter of Credit presentation (LC + commercial invoice + bill of lading) against UCP 600 rules. Returns discrepancies with severity, an overall recommendation (honor/inquiry/refuse), and the UCP 600 articles cited. Requires a production API key (sandbox keys get 403). Output is DRAFT decision-support for a documentary-credit examiner — not a legal opinion.",
    inputSchema: {
      type: "object",
      properties: {
        lc: { type: "object", description: "Letter-of-credit fields (currency, beneficiary, amount, expiry_date, port_of_loading, ...)." },
        invoice: { type: "object", description: "Commercial-invoice fields (total_amount, currency, seller_name, presentation_date, ...)." },
        bl: { type: "object", description: "Bill-of-lading fields (currency, port_of_loading, issue_date, shipped_on_board, ...)." },
      },
      required: ["lc", "invoice", "bl"],
      additionalProperties: false,
    },
    handler: (args, client) =>
      client.request({
        method: "POST",
        path: "/api/v1/lc/validate",
        body: {
          lc: reqObject(args, "lc"),
          invoice: reqObject(args, "invoice"),
          bl: reqObject(args, "bl"),
        },
      }),
  },

  {
    name: "ubo_screen",
    title: "Beneficial-ownership screen",
    tier: "production",
    annotations: {
      // Starts and caches a graph build; force_refresh rebuilds it.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Start a beneficial-ownership (UBO) graph traversal for an entity: walks ownership across registries, flags shell-company patterns, and screens nodes for sanctions exposure (8 lists; PEP is NOT screened). Applies the OFAC 50%-rule to derived ownership. Returns the cached graph immediately when available, otherwise a graph_id to poll with ubo_graph. Coverage caveat to pass on: there is no functioning US domestic UBO registry post-March-2025, so beneficial-ownership coverage is partial and every result says so. Flagged patterns are structural signals to review, not a verdict on any individual. Requires a production API key.",
    inputSchema: {
      type: "object",
      properties: {
        root_entity_name: { type: "string", description: "The entity to start the ownership traversal from." },
        root_jurisdiction: { type: "string", description: "Jurisdiction (ISO-2 or slug) to disambiguate the root entity. REQUIRED: the endpoint rejects a call without it, because two registries can hold the same company name." },
        force_refresh: { type: "boolean", description: "Bypass the cache and rebuild the graph. Optional, default false." },
      },
      required: ["root_entity_name", "root_jurisdiction"],
      additionalProperties: false,
    },
    handler: (args, client) =>
      client.request({
        method: "POST",
        path: "/api/v1/ubo/screen",
        body: {
          root_entity_name: reqString(args, "root_entity_name"),
          root_jurisdiction: reqString(args, "root_jurisdiction"),
          force_refresh: optBool(args, "force_refresh"),
        },
      }),
  },

  {
    name: "ubo_graph",
    title: "Fetch a UBO graph",
    tier: "production",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    description:
      "Fetch the status/result of a UBO graph build started by ubo_screen. Pass the graph_id returned when the screen was queued. Returns the graph nodes, ownership edges, aggregate risk, and flagged patterns once status is 'ready'.",
    inputSchema: {
      type: "object",
      properties: {
        graph_id: { type: "string", description: "The graph_id returned by ubo_screen." },
      },
      required: ["graph_id"],
      additionalProperties: false,
    },
    handler: (args, client) =>
      client.request({
        method: "GET",
        path: `/api/v1/ubo/graph/${encodeURIComponent(reqString(args, "graph_id"))}`,
      }),
  },

  {
    name: "predeal_check",
    title: "Pre-deal clearance verdict (full)",
    tier: "production",
    annotations: {
      // Writes a decision-ledger row, and each call mints a new receipt.
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Run a Pre-Deal Compliance Copilot check for a front-office originator: a sub-30s clearance probability (0-100) and verdict tier (clear/review/heavy_friction/block) for a proposed physical-commodity deal, with blockers, a restructure suggestion, and an estimated post-restructure clearance. Runs cluster, regulatory, adverse-media, sanctions, and verified-profile primitives. The response is self-describing about its own reliability: `verdict_source` is \"claude\" for a full synthesis or \"rule_based\" when the deterministic fallback ran, and `evidence_gaps` lists evidence sources that could not be consulted for this verdict — surface both to the user rather than presenting the score bare. Decision-support that estimates how compliance is likely to treat the deal — not a clearance itself and not legal advice; carries a disclaimer in the response. Requires a production API key; use predeal_preview for a free verdict without one.",
    inputSchema: {
      type: "object",
      properties: {
        counterparty_name: { type: "string", description: "Name of the counterparty in the proposed deal." },
        counterparty_role: { type: "string", enum: ["buyer", "seller"], description: "The counterparty's role in the deal." },
        product: { type: "string", description: "Product/spec, e.g. 'gasoil EN590 10ppm'." },
        origin_country: { type: "string", description: "Country of origin." },
        destination_country: { type: "string", description: "Destination country. Optional." },
        payment_structure: { type: "string", description: "Payment terms, e.g. 'DLC at sight + SBLC'. Optional." },
        volume_mt: { type: "number", description: "Deal volume in metric tonnes (> 0). Optional." },
        notes: { type: "string", description: "Free-form deal context. Optional." },
      },
      required: ["counterparty_name", "counterparty_role", "product", "origin_country"],
      additionalProperties: false,
    },
    handler: (args, client) =>
      client.request({
        method: "POST",
        path: "/api/v1/predeal/check",
        body: {
          counterparty_name: reqString(args, "counterparty_name"),
          counterparty_role: reqString(args, "counterparty_role"),
          product: reqString(args, "product"),
          origin_country: reqString(args, "origin_country"),
          destination_country: optString(args, "destination_country"),
          payment_structure: optString(args, "payment_structure"),
          volume_mt: optNumber(args, "volume_mt"),
          notes: optString(args, "notes"),
        },
      }),
  },
];
