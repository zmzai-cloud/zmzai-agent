# Cloud Agent Workbench Design

## 1. Product direction

`zmzai-agent` will become a cloud Agent Workbench for developers and technical business users. It combines the task orchestration, approvals, audit, connectors, relay, sandbox, and artifact capabilities already present in `zmzai-agent` with Lectern's focused workbench interaction model.

The primary work unit is a persistent cloud Workspace and its Sessions, rather than a one-shot chat response. Users can give an outcome-oriented goal, observe the plan and execution, authorize risky actions, inspect changes, and receive a versioned deliverable.

The first release targets developers and technical operators. It does not attempt to be a general-purpose Manus replacement.

## 2. First-release scope

### Included

- Cloud file Workspace with Project and GitHub repository context
- Persistent Sessions, Tasks, Runs, events, approvals, and checkpoints
- Workbench UI with session rail, conversation/timeline, file tree, editor, terminal, Diff, and artifact preview
- Real-time event streaming with reconnect and cursor recovery
- Cloud Sandbox file operations, commands, tests, and snapshots
- Approval for high-risk actions
- Run pause, resume, cancel, retry, and recovery
- Versioned Artifacts with preview, download, and sharing
- Workspace, Project, Session, and Artifact authorization
- Audit trail and usage visibility

### Deferred

- Multi-user real-time collaborative editing
- Browser automation
- Visual multi-agent graph authoring
- Enterprise organization and advanced policy administration
- Electron/local execution
- Broad non-technical task templates

## 3. User flow

1. Select or create a Cloud Workspace.
2. Select a Project or connect a GitHub repository.
3. Enter a goal, such as repairing an endpoint and adding tests.
4. Agent creates a plan and starts a Run.
5. Agent reads and edits files, invokes connectors, and runs tests in the cloud Sandbox.
6. High-risk actions create an Approval request.
7. User reviews live progress, terminal output, and Diff.
8. Agent produces versioned Artifacts with preview and download links.
9. User can continue the Session, resume a paused Run, or share the result.

## 4. Workbench experience

The `/quill` route is the single workbench entry point.

- Left rail: Workspace, Project, Session list, and task status
- Main pane: prompt, plan, messages, tool calls, approvals, and progress timeline
- Right pane: file tree, code editor, Diff, terminal, and Artifact preview
- Status area: Run state, usage, pause/resume, cancel, and delivery actions

The browser is a client of the Agent APIs. It never connects directly to the Sandbox.

## 5. Architecture and data flow

```text
Browser /quill
  | HTTP APIs + SSE event stream
zmzai-agent
  |-- Session/Task/Run orchestration
  |-- Approval and policy decisions
  |-- Event persistence and projection
  |-- Workspace file index and revision checks
  |-- Artifact metadata, access, and sharing
  |-- zmzai-relay: model inference and model catalog
  `-- zmzai-sandbox: cloud execution, files, commands, tests, snapshots
```

When a Session is created it is bound to `workspaceId`, optional `projectId`, and run configuration. Agent events are persisted before being published to the client. File changes arrive from Sandbox with revision information; Agent stores the Workspace file index and produces Diff data. Terminal events are scoped to Session and Run. Completed Sandbox output is converted into Artifact metadata and access URLs.

The existing Agent boundaries remain authoritative: Agent owns identity, authorization, orchestration, approvals, audit, and billing-related usage; Relay owns model calls; Sandbox owns isolated execution.

## 6. State and recovery

Run states are:

`created -> running -> waiting_input | waiting_approval -> paused -> running -> succeeded | failed | cancelled`

The implementation must preserve terminal state and event ordering. A disconnected browser does not stop a Run. Reconnection uses an event cursor to replay missed events. Sandbox restart recovery uses the latest checkpoint; unrecoverable runs become `failed` while retaining their logs. Approval expiry blocks continuation and allows a fresh request. Run retries must not repeat already-confirmed tool calls.

## 7. File and artifact consistency

Every save carries the client revision. Agent rejects stale writes with the current version and a Diff so the user can keep, overwrite, or merge intentionally. Artifact packaging may fail independently of execution; the Run log remains available and packaging can be retried.

## 8. Acceptance criteria

- A browser user can create a Workspace and Session.
- A real Run can modify files and execute tests in cloud Sandbox.
- File tree, editor, terminal, and Diff reflect confirmed server state.
- Refresh and reconnect preserve Run state, history, and event ordering.
- High-risk actions cannot execute without Approval.
- Completed Runs expose previewable, downloadable, shareable Artifacts.
- Retries are idempotent and do not duplicate Runs or deliveries.
- Authorization is enforced across Workspace, Project, Session, and Artifact boundaries.
- Typecheck, lint, focused unit tests, and one end-to-end Sandbox flow pass.

## 9. Implementation sequence

1. Define the cloud Workspace/session/file execution contract and event vocabulary.
2. Complete Agent-to-Sandbox file, terminal, checkpoint, and artifact flows.
3. Move the Lectern workbench panels into `/quill` against Agent APIs.
4. Add reconnect, recovery, revision conflict, and approval UX.
5. Validate the end-to-end developer workflow and harden authorization and idempotency.

