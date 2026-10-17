# ADR 0002: Separate runtime from repository execution

Date: 2026-10-15. Status: Accepted.

Repository commands and installation scripts can execute untrusted code.
A worktree separates changes but does not isolate execution.

The model/runtime holds credentials outside repository execution. The initial
executor will run tools and verification in a disposable Linux Docker container,
behind an injected ExecutionEnvironment interface. A future host supplies that
interface; workers need neither nested Docker nor a mounted host Docker socket.

Containers must be non-root, resource bounded, unprivileged, and deny execution
network access by default. Do not mount home directories, SSH agents, Docker
sockets, provider keys, cloud credentials, or private session storage. Trusted
dependency setup is a separate explicit network/trust phase. Repository guidance
cannot grant execution permissions. V1 containers do not promise secure execution
of arbitrary hostile repositories in a multi-tenant service.

Snapshot an explicit revision into a disposable copy. Dirty input needs a visible
manifest of tracked changes and explicitly selected untracked files; ignored
files and secrets are excluded by default. Preserve the original working tree.
Export a patch and manifest; a future explicit apply command checks the baseline
and refuses stale/conflicting changes. In-place autonomous execution is deferred.

Linux and Windows through WSL2 are the initial host targets. Foundation checks
currently run in Ubuntu/WSL; Docker execution is future CH-010/CH-011 work.
Native Windows and macOS support require compatibility evidence before release.
