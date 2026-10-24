# Architecture Standard: Schema-First API Design

**Version:** 1.0

**Target Audience:** Developers, Architects, AI Models (MCP Servers)

## 1. Core Philosophy

Decouple the **Protocol (The Shape)** from the **Payload (The Schema)**.

* **The Shape (Standardized):** The "USB-C port." A universal interface for auth, retries, error handling, and telemetry.
* **The Schema (Source-Specific):** The "Data." A dynamic JSON Schema that defines specific fields for each connection (e.g., Stripe, Slack, Jira).

## 2. The Three-Layer Stack

### Layer A: The Protocol (Standardized Interface)

All operations must inherit from a base **Abstract Operation Class**.

* **Input/Output:** Standardized ports for workflow engines (e.g., `input`, `output`, `error`).
* **Middleware:** Global handlers for rate limiting and logging.
* **Envelope:** Every response is wrapped in a metadata header.

### Layer B: The Manifest (Discovery & AI)

Every tool exports a machine-readable manifest to allow for automated discovery (MCP compatible).

* **Tools List:** A registry of available operations.
* **Tool Description:** High-fidelity natural language descriptions for AI selection.
* **Input Schema:** A JSON Schema defining required and optional arguments.

### Layer C: The Payload (Dynamic Data)

The actual business data, validated at design-time using the schema.

* **Type Safety:** Prevents mapping errors (e.g., mapping a string to an integer).
* **Transformation:** Uses a mapper to bridge differences between source and destination schemas.

---

## 3. MCP Discovery Specification

To function as an AI-native tool, the API must implement the following JSON-RPC structure:

### Tool Discovery (`tools/list`)

```json
{
  "name": "operation_id",
  "description": "Explains to the AI when and why to use this tool.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "field_name": { "type": "string", "description": "Field context" }
    },
    "required": ["field_name"]
  }
}

```

---

## 4. Implementation Example (The "Envelope" Pattern)

Regardless of the data inside, the transmission shape remains constant:

```json
{
  "method": "tools/call",
  "params": {
    "name": "create_invoice",
    "arguments": { 
      "amount": 500, 
      "currency": "USD" 
    }
  },
  "context": {
    "request_id": "req_123",
    "user_id": "user_456"
  }
}

```

---

## 5. Strategic Benefits

1. **AI-Ready:** Seamless integration with Model Context Protocol (MCP) clients like Claude Desktop or IDE extensions.
2. **Low-Code Friendly:** Powers drag-and-drop UI generators via schema reflection.
3. **Future-Proof:** Update data models (adding fields/custom objects) without breaking the core execution engine or protocol layer.