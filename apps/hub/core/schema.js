// Runtime validation against apps/hub/openapi.json component schemas (schema-first, TV-07).
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

// Returns (schemaName, value) -> null when valid, else a readable error string.
export function openApiValidator(doc) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: 'openapi', components: doc.components });
  return (name, value) => {
    const validate = ajv.getSchema(`openapi#/components/schemas/${name}`);
    if (!validate) throw new Error(`openapi.json has no schema ${name}`);
    return validate(value) ? null : ajv.errorsText(validate.errors, { dataVar: 'body' });
  };
}
