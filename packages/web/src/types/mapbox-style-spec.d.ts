// mapbox-gl ships the style spec's ESM build as dist/style-spec/index.es.js, and its types as
// dist/style-spec/index.d.ts, which TypeScript pairs only with an index.js that isn't there.
declare module "mapbox-gl/dist/style-spec/index.es.js" {
  export * from "mapbox-gl/dist/style-spec/index.js";
}
