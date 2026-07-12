/**
 * Code Generator — Language generators
 *
 * Pure functions that render a {@link EndpointRenderModel} into a syntactically
 * complete snippet for each MVP language (Python, JavaScript, cURL). Required
 * parameters and the resolved authentication mechanism are emitted as active
 * code (Req 7.3); optional parameters are emitted as commented-out entries that
 * a user can enable without altering the snippet's syntactic completeness
 * (Req 7.4).
 *
 * Validates: Requirements 7.1, 7.3, 7.4
 */

import type { EndpointRenderModel, RenderBodyField, RenderParam } from './code-generator.validators';

const INDENT = '    ';

/** Split a param list into its required and optional partitions. */
function partition<T extends { required: boolean }>(
  items: T[]
): { required: T[]; optional: T[] } {
  return {
    required: items.filter((i) => i.required),
    optional: items.filter((i) => !i.required),
  };
}

// ---------------------------------------------------------------------------
// Python (requests)
// ---------------------------------------------------------------------------

export function generatePython(model: EndpointRenderModel): string {
  const lines: string[] = [];
  lines.push('import requests');
  lines.push('');
  lines.push(`url = ${pyStr(model.url)}`);

  const params = [...model.authQuery, ...model.query];
  if (params.length > 0) {
    const { required, optional } = partition(params);
    lines.push('');
    lines.push('params = {');
    for (const p of required) {
      lines.push(`${INDENT}${pyStr(p.name)}: ${pyStr(p.value)},`);
    }
    for (const p of optional) {
      lines.push(`${INDENT}# ${pyStr(p.name)}: ${pyStr(p.value)},  # optional`);
    }
    lines.push('}');
  }

  const headers = [...model.authHeaders, ...model.headers];
  const contentTypeNeeded = model.hasBody;
  if (headers.length > 0 || contentTypeNeeded) {
    const { required, optional } = partition(headers);
    lines.push('');
    lines.push('headers = {');
    if (contentTypeNeeded) {
      lines.push(`${INDENT}${pyStr('Content-Type')}: ${pyStr('application/json')},`);
    }
    for (const h of required) {
      lines.push(`${INDENT}${pyStr(h.name)}: ${pyStr(h.value)},`);
    }
    for (const h of optional) {
      lines.push(`${INDENT}# ${pyStr(h.name)}: ${pyStr(h.value)},  # optional`);
    }
    lines.push('}');
  }

  if (model.hasBody) {
    lines.push('');
    lines.push('payload = {');
    renderBodyLines(model.bodyFields, (name, value, optional) => {
      lines.push(
        optional
          ? `${INDENT}# ${pyStr(name)}: ${pyStr(value)},  # optional`
          : `${INDENT}${pyStr(name)}: ${pyStr(value)},`
      );
    });
    lines.push('}');
  }

  lines.push('');
  const call: string[] = ['url'];
  if (params.length > 0) {
    call.push('params=params');
  }
  if (headers.length > 0 || contentTypeNeeded) {
    call.push('headers=headers');
  }
  if (model.hasBody) {
    call.push('json=payload');
  }
  lines.push(`response = requests.${model.method.toLowerCase()}(${call.join(', ')})`);
  lines.push('');
  lines.push('print(response.status_code)');
  lines.push('print(response.text)');

  return appendAuthNotes(lines.join('\n'), model.authNotes, '#');
}

function pyStr(value: string): string {
  return `"${escapeDouble(value)}"`;
}

// ---------------------------------------------------------------------------
// JavaScript (fetch)
// ---------------------------------------------------------------------------

export function generateJavaScript(model: EndpointRenderModel): string {
  const lines: string[] = [];
  lines.push(`const url = new URL(${jsStr(model.url)});`);

  const params = [...model.authQuery, ...model.query];
  if (params.length > 0) {
    const { required, optional } = partition(params);
    for (const p of required) {
      lines.push(`url.searchParams.append(${jsStr(p.name)}, ${jsStr(p.value)});`);
    }
    for (const p of optional) {
      lines.push(`// url.searchParams.append(${jsStr(p.name)}, ${jsStr(p.value)}); // optional`);
    }
  }

  lines.push('');
  lines.push('const options = {');
  lines.push(`${INDENT}method: ${jsStr(model.method)},`);

  const headers = [...model.authHeaders, ...model.headers];
  const contentTypeNeeded = model.hasBody;
  if (headers.length > 0 || contentTypeNeeded) {
    const { required, optional } = partition(headers);
    lines.push(`${INDENT}headers: {`);
    if (contentTypeNeeded) {
      lines.push(`${INDENT}${INDENT}${jsStr('Content-Type')}: ${jsStr('application/json')},`);
    }
    for (const h of required) {
      lines.push(`${INDENT}${INDENT}${jsStr(h.name)}: ${jsStr(h.value)},`);
    }
    for (const h of optional) {
      lines.push(`${INDENT}${INDENT}// ${jsStr(h.name)}: ${jsStr(h.value)}, // optional`);
    }
    lines.push(`${INDENT}},`);
  }

  if (model.hasBody) {
    lines.push(`${INDENT}body: JSON.stringify({`);
    renderBodyLines(model.bodyFields, (name, value, optional) => {
      lines.push(
        optional
          ? `${INDENT}${INDENT}// ${jsStr(name)}: ${jsStr(value)}, // optional`
          : `${INDENT}${INDENT}${jsStr(name)}: ${jsStr(value)},`
      );
    });
    lines.push(`${INDENT}}),`);
  }

  lines.push('};');
  lines.push('');
  lines.push('fetch(url, options)');
  lines.push(`${INDENT}.then((response) => response.json())`);
  lines.push(`${INDENT}.then((data) => console.log(data))`);
  lines.push(`${INDENT}.catch((error) => console.error(error));`);

  return appendAuthNotes(lines.join('\n'), model.authNotes, '//');
}

function jsStr(value: string): string {
  return `"${escapeDouble(value)}"`;
}

// ---------------------------------------------------------------------------
// cURL
// ---------------------------------------------------------------------------

export function generateCurl(model: EndpointRenderModel): string {
  const url = withQueryString(model.url, [...model.authQuery, ...model.query].filter((p) => p.required));

  const lines: string[] = [];
  const parts: string[] = [`curl -X ${model.method} "${escapeDouble(url)}"`];

  if (model.hasBody) {
    parts.push(`-H "Content-Type: application/json"`);
  }
  for (const h of model.authHeaders) {
    parts.push(`-H "${escapeDouble(h.name)}: ${escapeDouble(h.value)}"`);
  }
  for (const h of model.headers.filter((x) => x.required)) {
    parts.push(`-H "${escapeDouble(h.name)}: ${escapeDouble(h.value)}"`);
  }

  if (model.hasBody) {
    const body = curlBody(model.bodyFields);
    parts.push(`-d '${body}'`);
  }

  // The active command joins all required parts with line continuations.
  lines.push(parts.join(' \\\n  '));

  // Optional parameters are appended as comment lines so the runnable command
  // above stays syntactically complete (Req 7.4).
  const optionalQuery = [...model.query].filter((p) => !p.required);
  const optionalHeaders = model.headers.filter((x) => !x.required);
  const optionalBody = model.bodyFields.filter((f) => !f.required);
  if (optionalQuery.length > 0 || optionalHeaders.length > 0 || optionalBody.length > 0) {
    lines.push('');
    lines.push('# Optional parameters (enable by adding to the command above):');
    for (const p of optionalQuery) {
      lines.push(`#   query: ${p.name}=${p.value}`);
    }
    for (const h of optionalHeaders) {
      lines.push(`#   header: -H "${h.name}: ${h.value}"`);
    }
    for (const f of optionalBody) {
      lines.push(`#   body field: "${f.name}": "${f.value}"`);
    }
  }

  return appendAuthNotes(lines.join('\n'), model.authNotes, '#');
}

function curlBody(fields: RenderBodyField[]): string {
  const required = fields.filter((f) => f.required);
  const lines: string[] = ['{'];
  required.forEach((f, index) => {
    const comma = index < required.length - 1 ? ',' : '';
    lines.push(`  "${escapeDouble(f.name)}": "${escapeDouble(f.value)}"${comma}`);
  });
  lines.push('}');
  return lines.join('\n');
}

function withQueryString(url: string, params: RenderParam[]): string {
  if (params.length === 0) {
    return url;
  }
  const qs = params
    .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`)
    .join('&');
  return url.includes('?') ? `${url}&${qs}` : `${url}?${qs}`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function renderBodyLines(
  fields: RenderBodyField[],
  emit: (name: string, value: string, optional: boolean) => void
): void {
  for (const f of fields.filter((x) => x.required)) {
    emit(f.name, f.value, false);
  }
  for (const f of fields.filter((x) => !x.required)) {
    emit(f.name, f.value, true);
  }
}

function appendAuthNotes(code: string, notes: string[], commentPrefix: string): string {
  if (notes.length === 0) {
    return code;
  }
  const noteLines = notes.map((n) => `${commentPrefix} ${n}`);
  return `${code}\n\n${noteLines.join('\n')}`;
}

function escapeDouble(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
