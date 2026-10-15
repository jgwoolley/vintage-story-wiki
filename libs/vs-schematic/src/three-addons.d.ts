// The wiki's importmap (layouts/base.njk) and the VS Code extension's bundler both alias
// `three/addons/*` to three's examples/jsm folder; this tells TypeScript the same thing.
declare module "three/addons/OrbitControls.js" {
  export { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
}
