/**
 * The published version of this package, in ONE place.
 *
 * Three files used to carry it independently: package.json, index.ts's
 * SERVER_VERSION, and the User-Agent string in client.ts. The third was still
 * reporting "oilflow-mcp/0.1.0" two releases later, so every agent_hits row
 * this package produced named a version that had not been on npm for months,
 * and "which client version is calling us" was unanswerable from the data.
 *
 * Keep in lockstep with mcp/package.json "version" AND with SERVER_VERSION in
 * platform/src/app/api/mcp/route.ts. The route/package pair is enforced by
 * scripts/audit_drift.py::check_mcp_tools_wired(); this file is imported by
 * everything in the package that needs the number, so it cannot drift from the
 * server it identifies.
 */
export const SERVER_VERSION = "0.3.0";
