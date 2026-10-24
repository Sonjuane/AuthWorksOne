# Lab Experiments — `lab-ex/` Convention

The `lab-ex/` directory is the project's **R&D sandbox**. It holds throwaway test scripts, prototype components, and exploratory ideas that may (or may not) be promoted into the main project.

---

## Rules

- **Location:** `lab-ex/` lives at the project root.
- **Per-experiment isolation:** Each experiment gets its **own subdirectory** under `lab-ex/` (e.g. `lab-ex/parser-spike/`, `lab-ex/ui-toast-prototype/`). Do not place loose files directly in `lab-ex/`.
- **Naming:** Use short, descriptive kebab-case directory names that hint at the experiment's purpose.
- **Scope:** Anything inside `lab-ex/` is considered **non-production**. It is not subject to the same rigor as project code and may be incomplete, unpolished, or abandoned.

---

## Agent Behavior

- **Do not modify** `lab-ex/` content unless the task explicitly references it.
- **Do not import from** `lab-ex/` into production code. If an experiment graduates, it must be moved out and properly integrated.
- **Do not apply** main-project rules (simplicity audits, refactor passes, doc requirements) to `lab-ex/` files unless asked.
- When the user asks for a "test script," "spike," "prototype," or "experiment," propose creating it under `lab-ex/<name>/` rather than in the main source tree.
- Treat each `lab-ex/<name>/` directory as self-contained — do not cross-link between experiments.
