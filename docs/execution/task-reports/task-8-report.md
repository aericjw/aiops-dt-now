# Task 8 Report: Scaffold the ServiceNow Fluent application

## Scope name

**`x_1906732_dtaiops`**

The instance's vendor prefix is `x_1906732_` (10 characters). Total length is 17 characters, under the 18-character limit. Tasks 9-13 must use this scope name for all `Table()`/`Record()`/other definitions.

## Orientation summary (SDK 4.11.2)

Ran the mandatory orientation before any Fluent work:
- `npx @servicenow/sdk@4.11.2 explain quickstart --list --format=raw`
- `npx @servicenow/sdk@4.11.2 explain fluent-language --list --format=raw`
- `npx @servicenow/sdk@4.11.2 --help`

Read every topic returned by both lists in full, plus `keys-file` by name:
`developing-apps-guide`, `fluent-overview`, `keys-file`, `module-guide`, `now-config-reference`, `now-id-guide` (quickstart list); `data-helpers-guide`, `fluent-overview`, `now-attach-guide`, `now-del-guide`, `now-include-guide`, `now-ref-guide`, `override-guide`, `now-id-guide` (fluent-language list).

### Key conventions for Tasks 9-13

**`Now.ID` and record identity**
- Every top-level Fluent record should get `$id: Now.ID['descriptive-key']`. The build system — not the developer — generates the actual sys_id on first build and keeps it stable on every subsequent build by looking up the key in `keys.ts`.
- **Never fabricate or hardcode a sys_id.** LLM-generated sys_ids are known to collide across unrelated projects (one specific value has already caused real collisions in the wild). The only legitimate raw sys_id values are ones returned by a `query` or `transform` against a real instance.
- `Now.ID['key']` is only for **assigning** identity, never for referencing a record elsewhere. To reference a same-project record, import and pass the exported variable (or `.{$id}` when only the identifier is needed). To reference a platform/instance record, use `Now.ref(table, keys)` (coalesce keys) or a raw sys_id/`Now.ref(table, sysId)`.
- Renaming a key creates a new record and orphans the old one — treat key names as stable once assigned.

**`keys.ts` — the identity registry**
- Location: `src/fluent/generated/keys.ts` (auto-generated; not normally hand-edited).
- Maps `explicit` keys (developer-chosen names from `Now.ID[...]`) and `composite` keys (auto-managed coalesce keys for child/descendant records like columns and choices) to `{table, id}`, plus a `deleted` section.
- **Must be committed to version control** — it is the source of truth for record identity across environments/upgrades.
- Use `--frozenKeys` in CI to prevent silent regeneration from a stale committed file.

**Deleting `Record()`/`Table()`/`BusinessRule()` definitions — safety-critical**
- Removing Fluent code that defines a record does **not** just make it vanish from the build. Because its `keys.ts` entry still exists, the build treats the removal as an intentional delete: it marks the entry deleted and generates a delete record, which ships as part of the package and **removes the record on any instance the app is installed on, including through future upgrades.**
- Two distinct scenarios that look identical in code but require different handling (code alone cannot tell them apart — install history is the deciding factor):
  1. Record was already installed somewhere and the deletion should propagate through upgrades → delete the Fluent code, **leave** the `keys.ts` entry (this is what generates/ships the delete record).
  2. Record was never installed anywhere, or the deletion has already fully propagated → delete the Fluent code **and** remove the matching `keys.ts` entry in the same change (otherwise a delete record is still generated even though it isn't wanted).
- **Rule for this project going forward: never delete a `Table()`, `BusinessRule()`, `Record()`, or other API call from a `.now.ts` file, and never touch its `keys.ts` entry, without confirming with the user first** which of the two scenarios applies.
- `Now.del(table, keysOrSysId)` is the separate mechanism for explicitly deleting out-of-box/pre-existing platform records (not ones defined in this project's Fluent code) — it's a top-level statement, not usable inline.

**Scoping**
- `now.config.json` scope pattern: `^((x|sn)_[a-z0-9_]+|global)$`, 4-18 characters.
- On this PDI, the vendor prefix `x_1906732_` is mandatory — `init` rejects a scope name that doesn't start with it (confirmed empirically: attempting `dtaiops` alone failed with `Invalid scope: must match pattern 'x/sn_<vendor>_<name>'`).
- `now.config.json` does not store instance connection info — that's handled separately via `auth`.

**Other cross-cutting rules retained for Tasks 9-13**
- `Now`, `Now.ID`, `Now.ref`, `Now.include`, `Now.attach`, `Now.del`, and the data helpers (`Duration`, `Time`, `TemplateValue`, `FieldList`) are all **globals** — never import them from `@servicenow/sdk/core` or anywhere else; only constructors (`Table`, `Record`, `BusinessRule`, column types, etc.) are imported.
- Server-side logic: prefer JavaScript/TypeScript **modules** under `src/server/` (import `gs`/`GlideRecord`/etc. from `@servicenow/glide`) for APIs whose `script` property accepts a function (BusinessRule, ScriptAction, UiAction, RestApi routes, CatalogItemRecordProducer, ScheduledScript). Use `Now.include()` for string-only APIs (ScriptInclude, ClientScript, catalog client/UI policy scripts, SPWidget, HTML/CSS) and for Record API data fields (always strings).
- Script Include module files using `Class.create` must NOT import Glide APIs (auto-available there); ordinary module files with plain functions MUST import them explicitly.
- `$override` is an escape hatch for columns not modeled by the typed API (custom `x_`/`u_` fields, fields from other apps/plugins, or not-yet-surfaced OOB columns). Keys are literal database column names, not Fluent property names. Cannot be used for `sys_id`, `sys_scope`, `sys_update_name`, `sys_domainpath` (build error) — use `$id` for identity instead.

## Init / build / deploy output

### Init
```
npx @servicenow/sdk@4.11.2 init --auth pdi \
  --appName "Dynatrace AIOps Event Pipeline" \
  --packageName dynatrace-aiops-pipeline \
  --scopeName x_1906732_dtaiops \
  --template base
```
First attempt with `--scopeName dtaiops` failed:
```
[now-sdk] WARN: The scope name 'dtaiops' does not start with your instance's vendor prefix 'x_1906732_'. ...
[now-sdk] ERROR: scopeName Invalid scope: must match pattern 'x/sn_<vendor>_<name>'
```
Retried with the vendor prefix prepended, succeeded:
```
[now-sdk] Bootstrapping a new ServiceNow application project with SDK 4.11.2...
[now-sdk] Attempting to log into instance https://dev285073.service-now.com/ as admin.
[now-sdk] Application created successfully.
```

Generated `servicenow/now.config.json`:
```json
{
    "scope": "x_1906732_dtaiops",
    "scopeId": "d5b99ccceace439b97ff46dc715c21bc",
    "name": "Dynatrace AIOps Event Pipeline"
}
```
Also generated: `servicenow/package.json`, `servicenow/package-lock.json`, `servicenow/.gitignore` (already covers `node_modules/`, `dist/`, `target/`, `.now/`, `*.tsbuildinfo`, `.jest_cache`, `.DS_Store`), `servicenow/.vscode/extensions.json`.

`npm install` ran clean (526 packages; only pre-existing deprecation/audit warnings, no errors).

The `base` template did not scaffold a `src/` tree, so I created `servicenow/src/fluent/index.now.ts` by hand as an intentionally empty entry point (per the "deliberately small" scope of this task), with a comment pointing future tasks at where `Record()`/`Table()` definitions should go.

### Build
```
$ npx @servicenow/sdk@4.11.2 build
[now-sdk] Initiating the build process with SDK 4.11.2...
[now-sdk] Building project from /Users/aeric/Projects/aiops-dt-now/servicenow...
[now-sdk] Build completed successfully
```

### Deploy
```
$ npx @servicenow/sdk@4.11.2 deploy --auth pdi
[now-sdk] Starting installation with SDK 4.11.2...
[now-sdk] Attempting to log into instance https://dev285073.service-now.com/ as admin.
[now-sdk] Rollback (undo installation): https://dev285073.service-now.com/sys_rollback_context.do?sys_id=6725f967830f43900b9fffefeeaad35c
[now-sdk] Installation completed. Access the application at: https://dev285073.service-now.com/sys_app.do?sys_id=d5b99ccceace439b97ff46dc715c21bc
```

## Confirming query

```
$ npx --yes @servicenow/sdk@4.11.2 query sys_app -q 'nameLIKEDynatrace AIOps' -f name,scope,version -o json -a pdi
{"ok":true,"hasMore":false,"nextOffset":null,"records":[{"scope":"x_1906732_dtaiops","name":"Dynatrace AIOps Event Pipeline","version":"0.0.1"}]}
```
One record, as expected, confirming the app exists on the instance (not just a successful exit code).

## Files changed

- `servicenow/now.config.json` (new, generated)
- `servicenow/package.json` (new, generated)
- `servicenow/package-lock.json` (new, generated)
- `servicenow/.gitignore` (new, generated by SDK — already covers `node_modules/`)
- `servicenow/.vscode/extensions.json` (new, generated)
- `servicenow/src/fluent/index.now.ts` (new, hand-written empty entry point)
- `servicenow/src/fluent/generated/keys.ts` (new, generated by `build`; empty registry since no `Now.ID` keys were used yet)

`node_modules/` was created under `servicenow/` by `npm install`; it is already excluded by the SDK-generated `servicenow/.gitignore`, so no changes to the root `.gitignore` were needed.

## Python test suite

`python3 -m pytest -q` → **20 passed**, confirmed green before committing.

## Self-review findings

- The task brief listed `servicenow/src/index.now.ts` as the entry-point path, but the SDK's actual default (`fluentDir: "src/fluent"`, confirmed in `now-config-reference`) is `src/fluent/index.now.ts`. I followed the SDK default rather than the brief's literal path, since the brief itself says the file is "generated by `now-sdk init`" / SDK convention and the orientation step is explicitly authoritative over assumptions when they conflict.
- The `base` template produced no starter `.now.ts` file at all, so I added a minimal placeholder rather than leaving `src/fluent/` absent, to match the brief's stated file list and to give Tasks 9-13 an existing entry point to build alongside.
- No secrets were written to any file; auth is handled entirely through the pre-configured `pdi` alias, never touched by generated files.

## Concerns

- None blocking. One minor note: the generated `servicenow/package.json` pins `@servicenow/sdk` and `@servicenow/glide` versions in `devDependencies` (4.11.2 and 27.0.5 respectively) — future tasks should not bump these without explicit instruction, per the module-guide's "never modify existing dependency versions" rule.
- `keys.ts` currently has no entries (empty scaffold, no `Now.ID` usage yet). Task 9 will be the first to populate it — remind that task to commit `keys.ts` alongside its `.now.ts` changes.
