# ADR 0001: Own the harness; reuse model transport only

Date: 2026-10-15. Status: Accepted.

We need one runtime that a CLI and a future Ant Swarm worker can both call.
Adopting another coding-agent framework would also adopt its session, tool,
permission, and scheduling decisions.

We own the loop, tools, context, compaction, policy, budgets, sessions,
verification, and result contracts. Reuse `@earendil-works/pi-ai` only behind
our model adapter for transport, normalized streaming, metadata, and usage.
Do not depend on Pi agent core, coding agent, sessions, or extension frameworks.
Public harness contracts must contain no Pi types.

Core will receive model, execution, storage, event, approval, and clock
interfaces. Terminal I/O stays in the CLI; provider credentials stay in the
adapter/runtime. Keep one package until a working slice needs separation.

The current CLI is an argument-parsing demo. Pi is not installed yet; its exact
published version, compatibility, license, and first provider/model are CH-003
work. This decision does not establish a working agent loop.
