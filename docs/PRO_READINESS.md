# Preparing for Pro

Pro is the second sector of BLAXZY: far more control and many more parts, for experienced users.
Its design is being worked out separately and it will be **quite different from the Wizard**, not
the Wizard with more buttons. So the preparation is not to pre-build Pro features. It is to keep
the core generic enough that Pro can be built on it without rewriting what the Wizard uses.

These rules apply to everything built for the Wizard. A change that breaks one of them needs a
reason written down here.

## The rules

1. **No business logic in Wizard screens.** Pages and components only collect input and show
   state. Everything else lives in `src/server/<module>` services. Pro will call the same services
   from different screens.

2. **Projects know their mode.** `project.mode` is `wizard` or `pro` from the first migration, and
   the Wizard lives in its own route group, so Pro gets its own routes and layouts beside it.

3. **Every hidden choice is stored as data.** When the Wizard picks a model, parameters,
   references or a dami for the user, the choice is recorded on the record it applies to. Pro can
   then show and edit what the Wizard decided silently.

4. **Damis are standalone.** Each has a key, a version, typed input and typed output, and can be
   run on its own. The Wizard chains them; Pro may run one at a time, swap one, or rerun one with
   different input.

5. **Generation goes through a provider layer.** No screen or service names a model or calls
   Higgsfield directly. Models come from a catalog; the provider is an interface. Pro's model
   picker is then a view over the catalog, and a second provider is an implementation, not a rewrite.

6. **Stages are data, not page order.** The Wizard's four stages are a state machine stored on the
   project. Pro can skip, reorder, repeat or add steps without touching the Wizard.

7. **Everything is versioned and append-only.** Scripts, prompts, sheets and generations get new
   versions; nothing is overwritten or hard-deleted. Pro needs history, comparison and rollback,
   and those are impossible to add to data that was overwritten.

8. **Reviews keep their reasons.** Every accept or reject stores the reason and the version of the
   dami that produced the output. This is the raw material for improving damis and, later, for any
   Pro feature that learns from a user's taste.

## What the core shares with Pro

| Shared core | Wizard-only |
|---|---|
| Accounts, credits, ledger | The four-stage guided flow |
| Projects, episodes, script versions | Guided question sets |
| Assets, looks, sheets | Hint and coaching content |
| Prompt blocks, generations, takes | Fixed model choices |
| Dami framework and dami runs | |
| Job queue, workers, storage | |
| Provider layer and model catalog | |
| Reviews | |

## Checklist for any new Wizard feature

- Could a Pro screen call this service as it is? If not, the logic is in the wrong layer.
- Did the Wizard make a choice for the user here? Is that choice stored where Pro could read it?
- Does this overwrite anything? Make it a new version instead.
- Is a model, a dami or a stage name hard-coded in a component? Move it to data.

## When Pro's design arrives

Review it against the shared core table above before building. Anything Pro needs that the core
cannot express is a core change to make first, with the Wizard kept working on top of it.
