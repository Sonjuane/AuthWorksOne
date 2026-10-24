# Developer Profile

Load this file when you need context on developer style, preferences, or project philosophy.

---

## Planning Approach

- Plans upfront before beginning work, but stays flexible when changes emerge mid-project
- Updates original plans when modifications are needed — does not roll with ad hoc changes
- Documents folder structure, data flows, and component hierarchies before coding begins

---

## Language & Framework Preferences

- **Primary language:** JavaScript (frontend and backend)
- **Conditionally allowed:** Python, PHP, Bash — only when explicitly required by the task
- **Frameworks for larger projects:** Vue, Bootstrap, Tailwind
- Prefers minimal external dependencies; every dependency must be justified

---

## Code Philosophy

- Less code = less debugging — prefer brief, concise, readable implementations
- Code must be modular and reusable across projects
- Avoid unnecessary abstraction
- Write with empathy for the next developer reading the code

---

## Schema-First Approach

Evaluates schema opportunities before beginning any project:

- If an app has many form inputs → use a form library (e.g., Formio.js) so all forms exist as JSON schemas
- If an app has repeating views or components → each view is driven by a schema of components
- Schemas are defined **before** implementing logic

---

## Utility Functions

Any time logic repeats, it becomes a utility function:

- Utilities accept generalized inputs (arrays, lists, schemas) — never hard-coded values
- Utilities are stored in a `utils/` folder and designed to be shared across projects
- Example: a prompt-for-required-variables function takes an array and iterates — not a one-off script

---

## Documentation Style

- Uses Obsidian with markdown files as the primary documentation system
- One main README as the central index; a `docs/` subfolder for overflow content
- Updates documentation as work progresses — not in batches
- Inline comments are brief and orient the reader; component READMEs contain deeper context
- Prefers JSDocs structure; pragmatic with freeform when needed

---

## Project Structure

- Centralized `schemas/` folder for all data models
- `utils/` folder for reusable functions shared across projects
- Each component directory has its own README explaining how it works
- Consistent structure across personal and client projects for predictability

---

## For Coding Agents

- AGENTS.md (this system) functions as an LLM wiki with references to other files
- Load only files relevant to the current task — keep context lean and focused
- Path-based conditional loading is expected behavior, not optional
