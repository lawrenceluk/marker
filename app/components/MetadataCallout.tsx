import type { FrontMatter, MetadataValue } from "../lib/frontmatter";

function Value({ value, depth = 0 }: { value: MetadataValue; depth?: number }) {
  if (depth >= 8) return <span>{JSON.stringify(value)}</span>;
  if (Array.isArray(value)) return value.length ? <ul>{value.map((item, index) => <li key={index}><Value value={item} depth={depth + 1} /></li>)}</ul> : <span>[]</span>;
  if (value !== null && typeof value === "object") return Object.keys(value).length ? <Fields fields={value} depth={depth + 1} /> : <span>{"{}"}</span>;
  return <span>{value === null ? "null" : value === "" ? '""' : String(value)}</span>;
}

function Fields({ fields, depth = 0 }: { fields: Record<string, MetadataValue>; depth?: number }) {
  return <dl>{Object.entries(fields).map(([key, value]) => <div className="metadata-field" key={key}><dt>{key}</dt><dd><Value value={value} depth={depth} /></dd></div>)}</dl>;
}

export function MetadataCallout({ metadata }: { metadata: FrontMatter }) {
  return <details className="metadata-callout">
    <summary>Metadata</summary>
    <div className="metadata-content">
      {metadata.fields === null ? <><p>Couldn’t format this metadata. Original YAML:</p><pre>{metadata.raw}</pre></> : Object.keys(metadata.fields).length ? <Fields fields={metadata.fields} /> : <p>No metadata fields.</p>}
    </div>
  </details>;
}
