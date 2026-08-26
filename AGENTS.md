# AGENTS.md

This file provides guidance for AI coding agents working on this Headlamp plugin.

## Available Scripts

The following npm scripts are available for development and testing:

- **`npm run format`** - Format code with prettier
- **`npm run lint`** - Lint code with eslint for coding issues
- **`npm run lint-fix`** - Automatically fix linting issues
- **`npm run build`** - Build the plugin for production
- **`npm run tsc`** - Type check code with TypeScript compiler
- **`npm run test`** - Run tests with vitest
- **`npm start`** - Start development server watching for changes
- **`npm run storybook`** - Start Storybook for component development
- **`npm run storybook-build`** - Build static Storybook
- **`npm run i18n`** - Extract translatable strings for internationalization
- **`npm run package`** - Create a tarball of the plugin package
- **`npm run package-release`** - Build the release tarball, staged under the package name so it matches what Headlamp installs (see `scripts/package-release.mjs`)

## Plugin Development Resources

### Example Plugins

Explore these example plugins in `node_modules/@kinvolk/headlamp-plugin/examples/` to learn common patterns:

- **activity** - Shows how to add activity tracking and monitoring
- **app-menus** - Demonstrates adding custom menus to the app bar
- **change-logo** - Shows how to customize the Headlamp logo
- **cluster-chooser** - Demonstrates cluster selection UI
- **custom-theme** - Shows how to create custom themes
- **customizing-map** - Demonstrates customizing resource visualization maps
- **details-view** - Shows how to customize resource detail views
- **dynamic-clusters** - Demonstrates dynamic cluster configuration
- **headlamp-events** - Shows how to work with Kubernetes events
- **pod-counter** - Simple example counting pods and displaying in app bar
- **projects** - Demonstrates project/namespace organization
- **resource-charts** - Shows how to add custom charts for resources
- **sidebar** - Demonstrates customizing the sidebar navigation
- **tables** - Shows how to create custom resource tables
- **ui-panels** - Demonstrates adding custom UI panels

### Official Plugins

Check out production-ready plugins in `node_modules/@kinvolk/headlamp-plugin/official-plugins/` for advanced patterns:

#### Using Custom Resource Definitions (CRDs)

- **cert-manager** - Complete CRD integration for cert-manager resources
  - Files: `official-plugins/cert-manager/src/resources/` (certificate.ts, issuer.ts, clusterIssuer.ts, etc.)
  - Shows how to register and display custom resources for certificates, issuers, challenges, and orders
- **flux** - GitOps CRDs for Flux resources
  - Files: `official-plugins/flux/src/` (kustomization, helmrelease, gitrepository resources)
  - Demonstrates working with Flux CRDs for GitOps workflows
- **keda** - Kubernetes Event Driven Autoscaling CRDs
  - Files: `official-plugins/keda/src/resources/` (scaledobject.ts, scaledjob.ts, triggerauthentication.ts)
  - Shows CRD integration for event-driven autoscaling
- **karpenter** - Node provisioning CRDs
  - Files: `official-plugins/karpenter/src/` (NodeClass, EC2NodeClass resources)
  - Demonstrates multiple CRD deployment types (EKS Auto Mode, self-installed)

#### Visualizing Relationships with Maps

- **keda** - Map view showing KEDA resource relationships
  - File: `official-plugins/keda/src/mapView.tsx`
  - Uses edge creation (`makeKubeToKubeEdge`) to visualize connections between ScaledObjects, ScaledJobs, and TriggerAuthentications
  - Shows how to build graph visualizations of resource dependencies

#### Adding Metrics and Charts

- **prometheus** - Advanced charts for workload resources
  - Files: `official-plugins/prometheus/src/components/Chart/`
  - Provides CPU, memory, network, and disk charts using Prometheus metrics
  - Includes specialized charts for Karpenter (KarpenterChart, KarpenterNodeClaimCreationChart)
  - Shows KEDA metrics (KedaActiveJobsChart, KedaScalerMetricsChart, KedaHPAReplicasChart)
  - File: `official-plugins/prometheus/src/request.tsx` for fetching Prometheus data
- **opencost** - Cost metrics and visualization
  - File: `official-plugins/opencost/src/detail.tsx`
  - Uses `recharts` library (AreaChart, CartesianGrid, Tooltip) to display cost data
  - Shows how to fetch and display custom metrics from external services
  - Demonstrates time-series data visualization with stacked area charts

#### Other Advanced Patterns

- **ai-assistant** - AI integration for cluster management
- **app-catalog** - Helm chart catalog powered by ArtifactHub
- **backstage** - Integration with Backstage developer portal

### Key Topics and Examples

#### Adding Items to the App Bar

- **Example:** `pod-counter` - Shows `registerAppBarAction` to add items to top bar
- **File:** `examples/pod-counter/src/index.tsx`

#### Customizing the Sidebar

- **Example:** `sidebar` - Demonstrates `registerSidebarEntry` and `registerSidebarEntryFilter`
- **File:** `examples/sidebar/src/index.tsx`

#### Working with Resource Details

- **Example:** `details-view` - Shows how to customize resource detail pages
- **File:** `examples/details-view/src/index.tsx`

#### Creating Custom Tables

- **Example:** `tables` - Demonstrates custom table implementations
- **File:** `examples/tables/src/index.tsx`

#### Adding Charts and Visualizations

- **Example:** `resource-charts` - Shows how to add custom charts
- **File:** `examples/resource-charts/src/index.tsx`

#### Theme Customization

- **Example:** `custom-theme` - Demonstrates theme customization
- **File:** `examples/custom-theme/src/index.tsx`

#### Internationalization (i18n)

- Use `npm run i18n <locale>` to add new locales (e.g., `npm run i18n es` for Spanish)
- Translation files are in `locales/<locale>/translation.json`
- Use `useTranslation()` hook from `@kinvolk/headlamp-plugin/i18n`

## Development Workflow

1. **Start Development:** Run `npm start` to watch for changes
2. **Make Changes:** Edit files in `src/`
3. **Type Check:** Run `npm run tsc` to check for TypeScript errors
4. **Lint:** Run `npm run lint` to check for code quality issues
5. **Format:** Run `npm run format` to format code
6. **Test:** Run `npm run test` to run tests
7. **Build:** Run `npm run build` to create production build

## Releasing

Releases are built and published by CI. `README.md` carries the full runbook under
[Releasing](README.md#releasing); what follows are the rules that are expensive to learn by
breaking them.

Cutting a release is three steps: update `changes:` in `artifacthub-pkg.template.yml`, bump
`version` in `package.json`, then `git push origin main vX.Y.Z`. CI does everything else.

**Never hand-write a file under `releases/`.** The workflow generates
`releases/<version>/artifacthub-pkg.yml` itself, and only after `gh release create` has
succeeded, so that no version is advertised before the artifact it names exists. Between the tag
and the publish, `package.json` sits one version ahead of `releases/` — that is the intended
state, not a step someone forgot. A hand-written entry is how 0.1.5 came to offer a download
that 404s.

**A version number is published once.** ArtifactHub keeps whatever it first indexed for a
version and never re-reads it, so a version published with a wrong URL or checksum cannot be
repaired — not by re-running the workflow, not by editing the generated file. The only remedy is
to withdraw it (delete `releases/<version>/`) and ship the same code under the next number.
That is what 0.1.6 is. If a tag ever ends up without a run, use the workflow's **Run workflow**
button promptly, before ArtifactHub indexes the version; never delete and re-push a tag.

**The changelog lives in `artifacthub-pkg.template.yml`, and nowhere else.** Headlamp's catalog
shows it and the GitHub release notes are rendered from it, so it is never written twice. The
files under `releases/` are records of releases already out; editing one rewrites what the
catalog offers for a version users have installed. An `artifacthub-pkg.yml` in the repository
root is worse still — ArtifactHub indexes it as a package version of its own, and CI fails on
one.

Before pushing, run what CI runs: `npm run tsc && npm run lint && npm test && npm run build`.
The separate `catalog` job downloads every artifact `releases/` points at and checks it against
the recorded checksum, so a catalog entry that has drifted — including an old release whose
asset was deleted later — surfaces as a red `main` instead of as a failed install for a user.

## Best Practices

- Follow the patterns shown in the example plugins
- Use TypeScript for type safety
- Keep plugins focused on a single feature or enhancement
- Document your plugin's functionality in the README.md

## API Documentation

For detailed API documentation, visit:

- [Headlamp Plugin API Reference](https://headlamp.dev/docs/latest/development/api/)
- [Plugin Development Guide](https://headlamp.dev/docs/latest/development/plugins/)
- [UI Component Storybook](https://headlamp.dev/docs/latest/development/frontend/#storybook)
