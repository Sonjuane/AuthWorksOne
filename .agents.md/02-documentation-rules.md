# Documentation Rules — Policy as Contract

**Authority:** Binding. All rules are mandatory. No interpretation permitted.

---

## 1. Purpose (Non-Negotiable)

Documentation exists **only** to support:

- Fix implementation
- Fix validation
- Structural correction of existing systems
- Structural orientation (non-root README directory maps)

If documentation does not directly enable one of the above, **it must not be created**.

---

## 2. Allowed Content (Whitelist Only)

Agents may document **only**:

- Code changes required to apply or validate a fix
- Configuration changes that must be modified or verified
- Existing patterns or structures that require correction
- Data transformations that are repaired or updated

Anything not on this list **must not be documented**.

---

## 3. Forbidden Content (Zero Tolerance)

Agents must **never** include:

- Conceptual or theoretical explanations
- Background or historical context
- Educational, tutorial, or onboarding material
- Narrative prose or descriptive filler
- Explanations of *why* something exists unless required to apply the fix correctly

### Allowed (and Encouraged)

Two bounded exceptions are permitted (encouraged, not required):

- A **summary** of the unit — ≤3 sentences, or a `summary:` frontmatter field — stating what it does.
- In a **non-root README**, a brief **directory overview**: one line of context plus a contents list naming each file/subdirectory with a one-line description.

These exist to help humans and AI models orient within the project. Anything beyond this scope — narrative, rationale, tutorials — is filler and falls under the ban above.

---

## 4. Documentation Style (Enforced)

All documentation must be:

- Markdown only (docs-as-code)
- Brief, corrective, and implementation-focused
- Optimized for fast scanning and execution
- Free of narrative prose or descriptive filler

---

## 5. Required File Structure

### 5.1 README.md — Authoritative Entry Point

- Location: project root **or** directory of the active file
- Length: **500–1,500 words**
- Must contain fix workflows or remediation steps
- Must link to **every** file in `docs/`

Non-root READMEs **may** also serve as a directory map (see §3) — a directory overview plus contents list. When a README is used purely as a map, the word-count and fix-workflow requirements above do not apply.

README.md is the **single source of truth**.

### 5.2 docs/ — Overflow Only

- Used **only** when content does not fit cleanly in README.md
- Files must use ordered numeric prefixes (`01-`, `02-`, etc.)
- Files must be topic-focused and actionable
- Files must be explicitly linked from README.md

Orphaned documentation files are **forbidden**.

---

## 6. Creation Control (Strict)

Agents must **never** create or modify documentation without explicit user approval.

Before writing documentation:

1. Check for an existing `README.md` in the active directory
2. If one exists, prompt the user to choose:
   - Append to the existing README.md
   - Create a new README.md

Assuming documentation is desired is a **contract violation**.

---

## 7. Machine-Readable Policy (YAML)

```yaml
documentation_policy:
  contract_type: hard_constraints
  authority: agents_md

  purpose:
    allowed_only_for:
      - fix_implementation
      - fix_validation
      - structural_correction
      - structural_orientation        # non-root README directory maps
    forbid_if_outside_allowed_purposes: true

  content:
    allow:
      - code_changes_for_fixes
      - configuration_changes_or_validation
      - correction_of_existing_patterns
      - repaired_or_updated_data_transformations
      - orientation_summary_max_3_sentences
      - non_root_directory_overview
    forbid:
      - conceptual_explanations
      - background_or_historical_context
      - educational_or_tutorial_material
      - onboarding_content
      - narrative_prose_or_descriptive_filler
      - unnecessary_why_explanations

  style:
    format: markdown_only
    requirements:
      - brief
      - corrective
      - implementation_focused
      - fast_scannable
    forbid:
      - narrative_prose
      - descriptive_filler

  structure:
    readme:
      required: true
      role: authoritative_entry_point
      allowed_locations:
        - project_root
        - active_file_directory
      length_words:
        min: 500
        max: 1500
      must_include:
        - fix_workflows_or_remediation_steps
        - links_to_all_docs_files
      non_root_map_mode:
        allowed: true
        required: false
        may_include:
          - directory_overview
          - contents_list
        exempt_from:
          - length_words
          - fix_workflows_or_remediation_steps
    docs_directory:
      purpose: overflow_only
      allowed_locations:
        - project_root
        - active_file_directory
      file_rules:
        numeric_prefix_required: true
        must_be_actionable: true
        must_be_linked_from_readme: true
      forbid_orphans: true

  creation_control:
    explicit_user_approval_required: true
    forbid_implicit_creation: true
    before_writing:
      - check_for_existing_readme
      - if_exists_prompt_user_choice:
          - append_existing_readme
          - create_new_readme

  enforcement:
    self_lint_required: true
    block_output_on_any_violation: true
```

---

## 8. Agent Self-Validation Checklist (Mandatory)

Run all checks before producing any documentation. All items must pass.

### Content
- [ ] Every section directly enables a fix
- [ ] No conceptual, background, or educational content is present
- [ ] No explanatory prose unless required to apply a fix

### Scope
- [ ] Every documented item maps to an actual code, config, or data change
- [ ] No assumptions or speculative content are introduced

### Structure
- [ ] README.md exists or user approval was obtained to create one
- [ ] README.md links to all `docs/` files
- [ ] No orphaned or unreferenced documentation files exist

### Process
- [ ] User explicitly approved documentation creation or modification
- [ ] User was prompted when a README.md already existed
- [ ] No documentation was created implicitly or by assumption

---

## 9. Enforcement Clause

If **any** checklist item fails:

- Documentation **must not** be produced
- The agent **must stop** and request clarification
- Partial, speculative, or "best-guess" documentation is **forbidden**
