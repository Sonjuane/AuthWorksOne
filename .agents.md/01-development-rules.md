# Development Rules — Policy as Contract

**Authority:** Binding. All rules are mandatory. No interpretation permitted.

---

## 1. Human-Readable Contract

- Agents **must** produce modular, reusable code designed for use across multiple projects.
- Agents **must** minimize total code size while maintaining clarity and readability.
- Agents **must** prefer concise implementations and **must not** introduce unnecessary abstraction.
- Agents **must** minimize external dependencies and **must not** add a dependency unless strictly required.
- Agents **must** prefer JavaScript for both frontend and backend implementations.
- Agents **must not** choose Python, PHP, or Bash unless explicitly required by the task.
- Agents **must** leverage established frameworks (e.g., Vue, Bootstrap, Tailwind) for larger projects when applicable.
- Agents **must** follow a schema-first approach for any system involving structured or repeated data.
- Agents **must** define schemas before implementing logic whenever forms, views, or repeated UI/logic structures exist.
- Agents **must** represent forms as JSON schemas when multiple or complex inputs are involved.
- Agents **must** refactor repeated logic into reusable utility functions.
- Agents **must not** duplicate logic that can be expressed as a shared utility.
- Agents **must** design utilities to accept generalized inputs (e.g., arrays, lists, schemas) rather than hard-coded values.

---

## 2. Machine-Readable Policy (YAML)

```yaml
policy:
  language_preference:
    allowed:
      - javascript
    conditionally_allowed:
      - python
      - php
      - bash
    rule: >
      Non-JavaScript languages are allowed only when explicitly required by the task.

  architecture:
    required:
      - modular_design
      - reusable_components
      - minimal_code_footprint
    forbidden:
      - monolithic_implementation
      - unnecessary_abstraction

  dependencies:
    rule: prefer_minimal
    forbidden:
      - unnecessary_dependencies
    required_check:
      - dependency_justification

  frameworks:
    allowed:
      - vue
      - bootstrap
      - tailwind
    condition: >
      Must be used for large or multi-view projects unless explicitly excluded.

  schema_first:
    required:
      - schema_definition_before_logic
    applies_when:
      - multiple_form_inputs
      - repeated_views
      - repeated_components
    schema_formats:
      allowed:
        - json_schema
    forbidden:
      - ad_hoc_structure_definition

  utilities:
    required:
      - refactor_repeated_logic
      - generalized_function_inputs
    forbidden:
      - logic_duplication

  enforcement:
    mode: strict
    violation_action:
      - halt_execution
      - refuse_output
```

---

## 3. Enforcement Clause

Any violation of this contract **must** result in immediate refusal to proceed. The agent **must** halt execution and **must not** produce partial, speculative, or non-compliant output until the violation is resolved or the constraints are explicitly modified.
