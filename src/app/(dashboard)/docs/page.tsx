export default function DocsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-foreground">API Documentation</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Interactive docs powered by Swagger UI. Raw schema at{' '}
          <a
            href="/api/schema.json"
            target="_blank"
            className="underline hover:no-underline font-mono text-xs"
          >
            /api/schema.json
          </a>
          .
        </p>
      </div>

      {/* Swagger UI embedded via CDN */}
      <div
        id="swagger-ui"
        className="rounded-lg border border-border overflow-hidden bg-white dark:bg-slate-950"
      />

      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"
      />
      <SwaggerInit />
    </div>
  )
}

function SwaggerInit() {
  return (
    <script
      dangerouslySetInnerHTML={{
        __html: `
          (function() {
            var script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js';
            script.onload = function() {
              SwaggerUIBundle({
                url: '/api/schema.json',
                dom_id: '#swagger-ui',
                presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
                layout: 'BaseLayout',
                deepLinking: true,
              });
            };
            document.head.appendChild(script);
          })();
        `,
      }}
    />
  )
}
