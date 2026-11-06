/**
 * Front-matter → properties panel.
 *
 * This is a **line-based** YAML reader, not a YAML parser: it understands `key: value`, a
 * `- item` block list directly under a key, and `[a, b]` inline lists. Nested maps, block
 * scalars, anchors and multi-line strings are out of scope, and a comma inside an inline list
 * item splits it. That is deliberate — it runs on every render of every document, and the
 * panel only ever displays flattened scalars.
 */

export type YamlPropertyType = "text" | "tags" | "aliases" | "date" | "boolean" | "number" | "list";

export interface YamlProperty {
  key: string;
  type: YamlPropertyType;
  values: string[];
}

function trimYamlScalar(rawValue: string): string {
  const val = rawValue.trim();
  if (val.length >= 2) {
    const first = val[0];
    const last = val[val.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return val.slice(1, -1);
    }
  }
  if (val.toLowerCase() === "true" || val.toLowerCase() === "false") {
    return val.toLowerCase();
  }
  return val;
}

function inferYamlPropertyType(key: string): YamlPropertyType {
  const lower = key.trim().toLowerCase();
  switch (lower) {
    case "tags":
    case "tag":
      return "tags";
    case "aliases":
    case "alias":
      return "aliases";
    case "date":
    case "created":
    case "updated":
    case "modified":
    case "publishdate":
    case "published_at":
      return "date";
    case "draft":
    case "pin":
    case "favorite":
    case "enable":
    case "enabled":
    case "disabled":
      return "boolean";
    default:
      return "text";
  }
}

function isYamlBooleanTrue(val: string): boolean {
  return String(val).trim().toLowerCase() === "true";
}

function yamlPropertyIcon(propType: YamlPropertyType): string {
  switch (propType) {
    case "tags":
      return "tag";
    case "aliases":
      return "alias";
    case "date":
      return "date";
    case "boolean":
      return "toggle";
    case "number":
      return "number";
    case "list":
      return "list";
    default:
      return "text";
  }
}

export function parseYamlProperties(rawContent: string): YamlProperty[] {
  const content = rawContent.trim();
  if (!content) {
    return [];
  }

  const lines = content.split("\n");
  const props: YamlProperty[] = [];
  let listKey = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("- ") && listKey) {
      const item = trimYamlScalar(trimmed.slice(2).trim());
      if (!item) {
        continue;
      }
      for (let index = props.length - 1; index >= 0; index--) {
        if (props[index].key === listKey) {
          props[index].values.push(item);
          break;
        }
      }
      continue;
    }

    const colon = trimmed.indexOf(":");
    if (colon < 0) {
      continue;
    }

    const key = trimmed.slice(0, colon).trim();
    const val = trimmed.slice(colon + 1).trim();
    if (!key) {
      continue;
    }

    listKey = "";
    let propType = inferYamlPropertyType(key);

    if (!val) {
      listKey = key;
      if (propType === "text") {
        propType = "list";
      }
      props.push({ key, type: propType, values: [] });
      continue;
    }

    if (val.startsWith("[") && val.endsWith("]")) {
      const inner = val.slice(1, -1).trim();
      if (!inner) {
        props.push({ key, type: propType, values: [] });
        continue;
      }
      const values: string[] = [];
      for (const part of inner.split(",")) {
        const item = trimYamlScalar(part.trim());
        if (item) {
          values.push(item);
        }
      }
      props.push({ key, type: propType, values });
      continue;
    }

    const scalar = trimYamlScalar(val);
    if (scalar.toLowerCase() === "true" || scalar.toLowerCase() === "false") {
      propType = "boolean";
    }
    props.push({ key, type: propType, values: [scalar] });
  }

  return props;
}

function renderPropertyValues(prop: YamlProperty, escapeHtml: (value: string) => string): string {
  if (!prop.values.length) {
    return '<span class="vditor-properties__empty">—</span>';
  }

  switch (prop.type) {
    case "tags": {
      let html = "";
      for (let index = 0; index < prop.values.length; index++) {
        if (index > 0) {
          html += " ";
        }
        let tag = prop.values[index];
        if (!tag.startsWith("#")) {
          tag = `#${tag}`;
        }
        html += `<span class="obsidian-tag">${escapeHtml(tag)}</span>`;
      }
      return html;
    }
    case "aliases": {
      let html = "";
      for (let index = 0; index < prop.values.length; index++) {
        if (index > 0) {
          html += " ";
        }
        const alias = prop.values[index];
        html += `<span class="obsidian-wikilink" data-href="${escapeHtml(alias)}">${escapeHtml(alias)}</span>`;
      }
      return html;
    }
    case "list": {
      let html = '<ul class="vditor-properties__list">';
      for (const val of prop.values) {
        html += `<li>${escapeHtml(val)}</li>`;
      }
      html += "</ul>";
      return html;
    }
    case "boolean": {
      const checked = isYamlBooleanTrue(prop.values[0]) ? ' is-checked="true"' : "";
      return (
        `<span class="vditor-properties__checkbox"${checked}></span>` +
        `<span class="vditor-properties__boolean-label">${escapeHtml(prop.values[0])}</span>`
      );
    }
    default:
      return `<span class="vditor-properties__text">${escapeHtml(prop.values.join(", "))}</span>`;
  }
}

function valueClassName(propType: YamlPropertyType): string {
  switch (propType) {
    case "tags":
      return " vditor-properties__value--tags";
    case "aliases":
      return " vditor-properties__value--aliases";
    case "list":
      return " vditor-properties__value--list";
    case "boolean":
      return " vditor-properties__value--boolean";
    default:
      return "";
  }
}

export function renderPropertiesPanel(
  properties: YamlProperty[],
  escapeHtml: (value: string) => string,
): string {
  if (!properties.length) {
    return "";
  }

  let html = '<div data-type="yaml-front-matter"><div class="vditor-properties">';
  html += '<div class="vditor-properties__heading">';
  html += '<span class="vditor-properties__heading-icon" aria-hidden="true"></span>';
  html += '<span class="vditor-properties__heading-text">Properties</span>';
  html += '</div><div class="vditor-properties__table">';

  for (const prop of properties) {
    const icon = yamlPropertyIcon(prop.type);
    html += `<div class="vditor-properties__row" data-key="${escapeHtml(prop.key)}" data-value-type="${escapeHtml(prop.type)}">`;
    html += '<div class="vditor-properties__key">';
    html += `<span class="vditor-properties__key-icon" data-icon="${escapeHtml(icon)}"></span>`;
    html += `<span class="vditor-properties__key-label">${escapeHtml(prop.key)}</span>`;
    html += "</div>";
    html += `<div class="vditor-properties__value${valueClassName(prop.type)}">`;
    html += renderPropertyValues(prop, escapeHtml);
    html += "</div></div>";
  }

  html += "</div></div></div>";
  return html;
}
