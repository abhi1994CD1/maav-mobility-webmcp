<div align="center">

<img src="public/brand/neo-lab-logo.png" alt="NEO / LAB" width="440" />

# MAAV Stress Lab

### Design it. Break it. Make it resilient.

A browser-native, deterministic mobility assurance lab where humans and browser agents<br />
design two synthetic fleets, apply equivalent stress, compare immutable evidence, and keep the final decision human.

[![WebMCP](https://img.shields.io/badge/WebMCP-6%20trusted%20tools-22d3ee?style=for-the-badge&labelColor=071015)](docs/WEBMCP_TOOLS.md)
[![Tests](https://img.shields.io/badge/tests-278%20passing-6ee7b7?style=for-the-badge&labelColor=071015)](#verification)
[![Next.js](https://img.shields.io/badge/Next.js-16.3.3-f8fafc?style=for-the-badge&logo=nextdotjs&logoColor=white&labelColor=071015)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-818cf8?style=for-the-badge&logo=typescript&logoColor=white&labelColor=071015)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-a78bfa?style=for-the-badge&labelColor=071015)](LICENSE)

**Synthetic simulation · No live fleet control · Human-reviewed findings**

</div>

![MAAV Stress Lab showing the authored Sandton–Rosebank replay at the deterministic 08:42 vehicle failure](artifacts/gate9-correction/scenario-a-road-geometry-1440x900.jpg)

## The product

Mobility design decisions are often buried in disconnected dashboards, opaque assumptions, or AI prose that cannot be reproduced. MAAV Stress Lab makes the experiment itself inspectable:

```text
scenario revision
  → deterministic run
  → immutable evidence
  → compatible comparison
  → evidence-linked finding
  → visible human review
```

A human or compatible browser agent can configure Scenario A and Scenario B, apply the same documented failure policy, run both against one shared passenger trace, compare trusted artifacts, and stage a finding. The agent can operate the lab. It cannot manufacture evidence or approve its own conclusion.

> MAAV Stress Lab is a synthetic decision-support experiment workbench. It is not a live fleet dashboard, operational dispatcher, autonomous optimizer, digital twin, or scientifically calibrated transport model.

## The golden experiment

One deliberately bounded experiment makes the demo fast, repeatable, and auditable.

| Contract | Scenario A | Scenario B |
|---|---:|---:|
| Fleet | 12 vehicles × 8 seats | 10 vehicles × 10 seats |
| Network | `sandton-rosebank-v1` | `sandton-rosebank-v1` |
| Demand | 120 synthetic requests · seed `07` | 120 synthetic requests · seed `07` |
| Window | 08:30–09:00 · 30-second tick | 08:30–09:00 · 30-second tick |
| Stress | 08:42 deterministic vehicle failure | 08:42 deterministic vehicle failure |
| Resolved vehicle | `A-09` | `B-03` |

At 08:42, each run independently selects the active vehicle with the highest onboard occupancy. Ties are resolved by reserved-passenger count, active-service state, then ascending vehicle ID. The rule is fixed before execution; the selected vehicle is never random or manually chosen for effect.

### Reproducible outcome

| Evidence | Scenario A | Scenario B |
|---|---:|---:|
| Served at horizon | 82 | 81 |
| In service at horizon | 29 | 28 |
| Unserved | 9 | 11 |
| Maximum wait | 1,050 s | 780 s |
| Total energy | 37,799 Wh | 31,665 Wh |
| Minimum reserve | 7,633 bp | 7,648 bp |
| Recovery time | 120 s | 450 s |
| Standing observed | 0 | 0 |
| Maximum-wait constraint | **FAIL** | **FAIL** |

The result is intentionally not a universal winner: Scenario A serves more passengers and recovers faster; Scenario B lowers maximum wait and energy consumption. The supported finding is **TRADE_OFF / BALANCED / PENDING HUMAN REVIEW**.

Passenger conservation is explicit:

```text
Scenario A · 82 served + 29 in service + 9 unserved = 120
Scenario B · 81 served + 28 in service + 11 unserved = 120
```

## Native agent workflow

The public WebMCP catalog is static and contains exactly six purpose-bounded tools.

| Tool | Purpose | Mutates state |
|---|---|:---:|
| `read_lab_state` | Inspect current scenarios, runs, evidence, and prerequisites | No |
| `configure_scenario` | Create or revise Scenario A or B | Yes |
| `inject_disruption` | Attach the deterministic 08:42 vehicle-failure policy | Yes |
| `run_scenario` | Execute one immutable scenario revision | Yes |
| `compare_scenarios` | Compare two explicit, current, compatible run artifacts | Yes |
| `stage_finding` | Stage an evidence-linked finding for human review | Yes |

All six tools remain discoverable throughout the lifecycle. Strict validation, revisions, source-aware idempotency, cancellation, artifact compatibility, and stale-evidence rules are enforced by the shared application service—not by dynamically hiding tools.

Use this prompt in a supported Chrome/WebMCP browser-agent surface:

> Configure the seed-07 A/B Stress Lab, apply the equivalent deterministic 08:42 failure to each scenario, run both, compare verified evidence, and stage a TRADE_OFF / BALANCED finding for human review.

The browser agent may inspect, configure, stress, run, compare, and stage. **Accept**, **Challenge**, and deterministic **Reset** remain visible human-only controls and do not exist in WebMCP.

## Trust architecture

```mermaid
flowchart TB
    Human[Human operator] --> UI[React manual interface]
    Agent[Browser agent] --> MCP[Six static WebMCP tools]
    Maps[Google Maps presentation] --> UI
    UI --> Service[StressLabService]
    MCP --> Service
    Service --> Domain[Deterministic domain engine]
    Service --> Repo[Revisioned per-tab repository]
    Domain --> Ledger[Immutable event ledger]
    Ledger --> Run[Verified run artifact]
    Run --> Comparison[Compatible comparison]
    Comparison --> Finding[Evidence-linked finding]
    Finding --> Review[Human Accept or Challenge]
```

Dependency direction stays one-way:

```text
UI / WebMCP / Google / Zustand adapters
                    ↓
          application services
                    ↓
          deterministic domain
```

- **Domain authority:** arrivals, assignments, movement, capacity, energy, battery, failures, recovery, ledger events, metrics, constraints, comparisons, and supported finding claims.
- **Application authority:** validation, expected revisions, idempotency, cancellation, compatibility, invalidation, and one atomic publication.
- **Adapter responsibility:** validate, inject source context, call the service, render compact results, and expose bounded transient activity.
- **Human authority:** Accept, Challenge, and Reset.
- **Google boundary:** geographic presentation only. Google never supplies simulation distance, time, traffic, dispatch, energy, metrics, or findings.

## Deterministic replay

The full-width map and timeline project one current committed run at a time. Vehicles, passengers, demand, the failure marker, inspectors, and frame controls are derived from immutable snapshots and ledger-prefix evidence.

- A/B switching never mixes run artifacts.
- Seeking selects an exact committed frame.
- Playback speed changes wall-clock cadence only.
- Invalidation immediately removes stale dynamic overlays.
- Map camera, layers, selection, and playback create no revision or audit record.
- The authored fallback preserves the manual workflow when Google Maps is unavailable.

Google road geometry may refine screen position only. The authored network remains the topology and evidence authority.

## Reliability and security

- Strict Zod validation plus closed-world JSON Schema at the WebMCP boundary.
- Exact operation retry returns the original terminal result.
- Changed arguments or cross-source operation-ID reuse fail closed.
- Concurrent writes against one revision publish at most one winner.
- Cancellation creates no partial artifact or later ghost completion.
- Scenario edits preserve history and atomically invalidate only affected current pointers.
- Tool output is bounded, sanitized, and excludes raw exceptions, prompts, storage, keys, and unrestricted URLs.
- Browser and Google keys remain outside source, evidence, activity, and fingerprints.
- Manual mode stays complete when WebMCP is unsupported.

## Run locally

### Requirements

- Node.js 20+
- pnpm 8.11.0
- Google Chrome 150 with WebMCP testing enabled for native browser-agent testing

```bash
git clone https://github.com/abhi1994CD1/maav-mobility-webmcp.git
cd maav-mobility-webmcp
pnpm install
pnpm dev
```

Open [http://localhost:3000/lab](http://localhost:3000/lab).

The complete manual experiment works without a Google key. For the Google presentation surface, add restricted browser credentials to an ignored `.env.local`:

```bash
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_restricted_browser_key
NEXT_PUBLIC_GOOGLE_MAP_ID=your_public_map_id
```

Never commit `.env.local`. Restrict the browser key by HTTP referrer and to the required Google Maps APIs in Google Cloud.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Current local release-candidate evidence:

```text
ESLint                 PASS
TypeScript strict      PASS
Vitest                 36 files · 278 tests PASS
Next.js production     PASS
/lab                   statically generated
```

Native browser-agent behavior must also be smoke-tested in the exact deployed Chrome/WebMCP environment; unit tests and direct page execution are not substitutes for that proof.

## Repository guide

| Path | Responsibility |
|---|---|
| `src/domain/stress-lab/` | Deterministic engine, fixtures, events, metrics, comparison, findings |
| `src/application/` | Ports, command authority, cancellation, idempotency, atomic publication |
| `src/infrastructure/webmcp/` | Six strict WebMCP adapters and lifecycle-safe registration |
| `src/infrastructure/persistence/` | Revisioned production repository adapter |
| `src/state/` | Shared tab-scoped runtime and presentation hooks |
| `src/features/stress-lab/` | Premium manual workbench, evidence, review, activity, replay |
| `tests/` | Unit, contract, deterministic regression, and browser-independent UI proof |
| `artifacts/` | Gate evidence and review captures |
| `docs/` | Product, architecture, simulation, WebMCP, demo, and delivery contracts |

## Evidence gallery

| Comparison | Pending human review |
|---|---|
| ![Scenario A and B comparison evidence](artifacts/gate8/maav-gate8-comparison-1440x900.jpg) | ![Trade-off finding pending human review](artifacts/gate8/maav-gate8-pending-review-1366x768.jpg) |

These captures are development evidence. The public demo and final video should be recorded from the same deployed release SHA.

## Honest boundaries

The H0 release intentionally excludes arbitrary cities, live passenger or vehicle feeds, GTFS import, external optimizers, demand-surge modeling, charging simulation, authentication, databases, multi-user workspaces, exports, operational dispatch, and real passenger data.

Roadmap ideas are future work—not implemented claims.

## Documentation

- [Product contract](docs/PRODUCT.md)
- [Architecture and state flow](docs/ARCHITECTURE.md)
- [Deterministic simulation contract](docs/SIMULATION_ENGINE.md)
- [WebMCP contracts](docs/WEBMCP_TOOLS.md)
- [Golden demonstration](docs/DEMO.md)
- [Challenge delivery plan](docs/CHALLENGE_PLAN.md)
- [Devpost draft](devpost-submission.md)

## License

Released under the [MIT License](LICENSE).

Copyright © 2026 Abhishek Dhar.

---

<div align="center">

Built for **The WebMCP Challenge**.

**MAAV Stress Lab · v0.5**

</div>
