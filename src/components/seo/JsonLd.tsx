/**
 * Renders a schema.org JSON-LD block (server component). `<` is escaped to its
 * unicode form so no string in the data can ever close the script tag early -
 * the standard hardening for JSON embedded in HTML.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replaceAll('<', '\\u003c') }}
    />
  );
}
