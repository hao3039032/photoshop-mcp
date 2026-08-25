# Anonymous Usage Analytics

This project collects **anonymous, aggregated usage events** to understand how the
MCP server and standalone UI are used and to improve the product. Analytics are
**enabled by default** and can be turned off at any time.

← Back to [README](../README.md)

## What we collect

- App version, operating system (platform, type, release), CPU count, Node.js version,
  launch method, system locale/timezone, and whether optional env overrides are
  configured (flags only — never paths or values).
  **App version is attached to every server-side event** via `buildRuntimeProperties()`,
  not only `mcp_session_started`.
- **MCP-only usage** (no UI required): process lifecycle, MCP client identity
  (name/version from the initialize handshake), virtual page views, Photoshop
  connection status, **batched** tool usage summaries (tool names and counts per
  agent turn — never arguments or results), and prompt template names when requested
- **UI server** startup/shutdown and setup funnel events (provider chosen, auth method,
  validation success/failure codes — not credentials), plus **active provider/model**
  on the anonymous person profile when a chat is created or the model changes
- **Browser UI** events (app loaded, setup completed, SPA page views on route
  changes). When analytics are enabled, the browser records named UI events via
  PostHog (see [Browser tracking](#browser-tracking))

Events use a random anonymous identifier stored locally at
`~/.photoshop-mcp/` (SQLite `kv` table and/or `analytics-store.json`). That ID
is registered with PostHog via `identify()` so MCP, UI server, and browser
events merge under one anonymous person per install — no email, name, or other
PII.

The person profile also stores **install cohort** fields (via PostHog `$set_once`):
`first_install_at`, `first_usage_surface` (`mcp` | `server` | `web`), and
`first_mcp_client_name` when an MCP client first connects. It also stores **total
installed RAM (GB)**, **memory tier (bucketed GB)**, and the **detected Photoshop
version** when available — these hardware fields are on the person profile only,
not repeated on every event.

Country/region signals come from PostHog GeoIP on ingest and from
`system_locale_region` / `browser_locale_region` as a secondary hint.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANALYTICS_DISABLED` | off | Set `1` or `true` to disable all analytics for that process |
| `POSTHOG_DISABLED` | — | Legacy alias for `ANALYTICS_DISABLED` |
| `POSTHOG_KEY` | embedded in `config.ts` | PostHog project API key (`DEFAULT_POSTHOG_KEY`) — override for forks or staging |
| `POSTHOG_API_HOST` | `https://a.alisait.com` | Ingest host (managed reverse proxy to PostHog) |
| `POSTHOG_UI_HOST` | `https://eu.posthog.com` | PostHog project UI host |

A default project key is embedded in the server config so MCP and UI analytics work
on every `npx` install without user configuration. Forks or staging environments can
override `POSTHOG_KEY` and the host variables (see `.env.example`).

## Browser tracking

When anonymous usage analytics are **enabled**, the standalone browser UI initializes
[posthog-js](https://posthog.com/docs/libraries/js) with:

- `capture_pageview: 'history_change'` — automatic page views on SPA route changes
- `autocapture: false` — no automatic click/input capture
- `person_profiles: 'identified_only'` — person profiles only after `identify()`

Named custom events are captured explicitly for setup and app lifecycle. **Session
replay is not enabled** in this configuration.

These features are **disabled** when you turn off anonymous usage analytics
(Settings → Privacy, or `ANALYTICS_DISABLED=1` / `POSTHOG_DISABLED=1`).

## MCP events

When you run `photoshop-mcp` directly (e.g. via Cursor MCP config), these events
are sent via [posthog-node](https://posthog.com/docs/libraries/node) using the
embedded project key.

| Event | When | Key properties |
| --- | --- | --- |
| `$pageview` | MCP session start | Virtual URL `photoshop-mcp://mcp`, `usage_surface: mcp` |
| `mcp_session_started` | MCP process start (stdio server up) | `app_version`, `photoshop_detected`, `tools_registered_count` |
| `mcp_client_connected` | MCP client completed initialize handshake | `mcp_client_name`, `mcp_client_version`, `mcp_client_connect_count` |
| `mcp_client_disconnected` | MCP transport closed | `mcp_client_name?`, `mcp_client_version?` |
| `mcp_session_startup_failed` | Startup error | `ok: false`, `error_code` |
| `mcp_photoshop_connection` | Initial connect or failed reconnect | `ok`, `photoshop_connected`, `error_code?` |
| `mcp_photoshop_first_connected` | First successful Photoshop connection (once per install) | `event_source: mcp` |
| `mcp_first_tool_success` | First successful tool call (once per install) | `tool_name`, `event_source: mcp` |
| `mcp_tool_batch` | 3s after last tool, 60s max hold, client disconnect, or session end | `tools_called_count`, `tools_error_count`, `unique_tools_count`, `tool_usage_summary`, `tools_used[]`, `had_errors`, `error_codes[]?`, `error_codes_summary?`, `batch_flush_reason`, `mcp_client_name?` |
| `mcp_prompt_requested` | Prompt template fetch | `prompt_name` |
| `$pageleave` | Graceful shutdown (SIGINT/SIGTERM/stdio close) | `duration_ms`, `shutdown_reason` |
| `mcp_session_ended` | Graceful shutdown | `duration_ms`, `shutdown_reason` |

Tool usage is **not** sent per call. Calls are aggregated in memory and flushed as
`mcp_tool_batch` when the MCP client pauses for 3 seconds after the last tool in a
burst (typical IDE agent turn), after 60 seconds of continuous tool activity, or
when the session ends or the MCP client disconnects.

One-time funnel milestones (`mcp_first_tool_success`, `mcp_photoshop_first_connected`)
use a persisted local flag plus PostHog `uuid` deduplication.

## Model tracking

| Surface | Where to see model | Notes |
| --- | --- | --- |
| **Cursor / Claude Desktop MCP** | Not available | The LLM runs inside the IDE; `photoshop-mcp` never sees the model name |
| **Standalone UI** (all users) | Person `active_provider` / `active_model`, event `ui_model_selected` | Set when a chat is created or provider/model changes — no prompt content |
| **Standalone UI** (beta opt-in) | `beta_chat_turn` event `model` property | Includes truncated prompt/response text |

## UI events (standalone server + browser)

| Event | When | Key properties |
| --- | --- | --- |
| `ui_server_started` | UI CLI process ready | `port`, `host`, `no_open`, `event_source: server` |
| `ui_server_ended` | UI CLI shutdown (SIGINT/SIGTERM) | `duration_ms`, `shutdown_reason`, `event_source: server` |
| `ui_model_selected` | Chat created or model/provider changed | `provider_id`, `model` |
| `setup_provider_selected` | Onboarding provider pick (browser) | `provider_id` |
| `setup_auth_method_selected` | Auth method saved (server API only) | `provider_id`, `auth_method`, `event_source: server` |
| `setup_validate_key` | API key validation (server) | `provider_id`, `ok`, `error_code?` |
| `setup_key_saved` | API key persisted (server) | `provider_id` |
| `setup_completed` | Onboarding finished (browser) | `provider_id`, `auth_method` |
| `app_loaded` | Browser UI ready | `has_auth` |

MCP-only installs appear in PostHog via the virtual `$pageview` at
`photoshop-mcp://mcp`, even when the standalone UI is never opened.

## What we do **not** collect (unless you opt into beta team sharing)

- API keys or OAuth tokens
- Chat messages, prompts, or model responses **by default**
- Photoshop document or layer names, file paths, or image content
- CLI account labels, email addresses, or other account identifiers
- Tool call **arguments** or **results** (MCP logs tool **names** only)

## Beta team content sharing (opt-in)

On first launch of the standalone UI, you are asked whether you want to **join the
beta team**. This is separate from anonymous usage analytics above.

If you accept:

- Your **prompts**, **assistant responses**, **reasoning text**, and **tool names**
  (not arguments or results) may be sent to PostHog after each chat turn via
  `getAnalytics().capture()` (`beta_chat_turn`)
- Content is truncated for very long messages
- Requires anonymous analytics to remain enabled

If you decline, no chat content is logged. You can change this later in
**Settings → General → Privacy → Beta team content sharing**.

Existing installs that have not answered yet are prompted once on the next launch.

## Processor and hosting

Analytics are processed by [PostHog](https://posthog.com/).

- **Browser UI:** posthog-js → ingest via `POSTHOG_API_HOST` (default reverse proxy
  at `https://a.alisait.com`)
- **MCP stdio and UI server:** posthog-node with the embedded project key — works on
  every `npx` install without user env configuration
- **Project UI:** `https://eu.posthog.com` (override with `POSTHOG_UI_HOST`)

Server-side events include a per-event `uuid` for ingest deduplication; one-time
milestones use a deterministic `uuid` per install. Person profile fields are written
via PostHog `identify()` and `$set_once`.

See the [PostHog privacy policy](https://posthog.com/privacy) for how PostHog
handles data on their side.

### Documentation site

The GitHub Pages documentation site (VitePress under `site/`) does **not** load any
analytics scripts. Docs traffic is not tracked.

### Geolocation

PostHog enriches events with country/region from the client IP on ingest (GeoIP).
Browser events also send `browser_locale_region` as a secondary hint.

## PostHog dashboard recipes (maintainers)

| Insight | PostHog approach |
| --- | --- |
| MCP active users | Filter `$pageview` where `$current_url` contains `photoshop-mcp://mcp` |
| MCP client breakdown | `mcp_client_connected` segmented by `mcp_client_name` |
| Install cohorts | Person property `first_usage_surface`, `first_mcp_client_name`, `first_install_at` |
| First tool / Photoshop reach | Funnel on `mcp_first_tool_success`, `mcp_photoshop_first_connected` |
| Country breakdown | Segment `mcp_tool_batch` or `$pageview` by country dimension |
| Tool error rate | `mcp_tool_batch` where `had_errors = true`, segment by `error_codes` or `error_codes_summary` |
| Photoshop reachability | `mcp_photoshop_connection` where `ok = false` |
| Session duration | Average `duration_ms` on `mcp_session_ended` or `ui_server_ended` |
| MCP vs UI usage | Person property `usage_surfaces` (comma-separated: `mcp`, `server`, `web`) |
| Standalone UI model | Person `active_provider` / `active_model` or event `ui_model_selected` |

## How to opt out

1. **Standalone UI:** Settings → General → Privacy → set **Anonymous usage
   analytics** to **Off** (also disables beta content sharing).
2. **Beta content only:** Settings → General → Privacy → set **Beta team content
   sharing** to **Off** (anonymous analytics can stay on).
3. **Environment variable:** set `ANALYTICS_DISABLED=1` (or the legacy alias
   `POSTHOG_DISABLED=1`) before starting `photoshop-mcp` or `photoshop-mcp-ui`
   (disables all analytics for that process and persists opt-out in local
   storage).
