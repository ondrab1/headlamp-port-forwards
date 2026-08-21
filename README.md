# Persistent Port Forwards

A [Headlamp](https://headlamp.dev) plugin that makes port forwards survive a restart and be
shareable with your team.

Headlamp can already start a port forward, but it forgets everything: after a restart you re-create
each one by hand, and there is no way to hand a colleague the set of forwards a project needs. This
plugin replaces the Port Forwarding page with one that remembers, auto-starts and shares.

<!-- Add docs/port-forwarding-list.png; see docs/README.md for what it should show. -->

![Port Forwarding list](docs/port-forwarding-list.png)

## What it adds

**One-click Resume.** A stopped forward gets a play button that starts it again on its original
port. When the forward targets a Service the pod is looked up again first, so it still works after
the pod was replaced — which is exactly when the built-in Start fails.

**Bulk Resume and Stop.** Select rows and act on all of them at once.

**Persistent forwards.** Pin a forward and the plugin recreates it on the next start. Stored in the
plugin settings, per cluster.

**Shared forwards.** A ConfigMap in the cluster holds the forwards your whole team should have.
Everyone pointing the plugin at it sees the same list.

**Auto-start, opt-in.** Each forward decides whether it starts by itself when you enter the
cluster. Anything without the flag is listed as stopped and waits for you.

**Names that mean something.** Call a forward `RabbitMQ Management` instead of reading
`rabbitmq-cluster`. Shown as the row title with the resource underneath.

## Sharing through a ConfigMap

The shared list lives in the cluster rather than behind a URL. It needs no hosting, is read through
the same authenticated path as everything else, and is not subject to CORS — a raw file URL from
GitLab or similar is blocked by the browser unless it sends `Access-Control-Allow-Origin`.

Point the plugin at a namespace and name in its settings. If the ConfigMap does not exist yet,
**Create** makes it (and its namespace, when that is missing too). Without permission to write, you
get the manifest to hand over.

<!-- Add docs/plugin-settings.png; see docs/README.md for what it should show. -->

![Plugin settings](docs/plugin-settings.png)

The manifest looks like this:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: shared-port-forwards
  namespace: headlamp
data:
  port-forwards.json: |
    [
      {
        "name": "RabbitMQ Management",
        "namespace": "rabbitmq",
        "service": "rabbitmq-cluster",
        "localPort": 15672,
        "targetPort": 15672,
        "autoStart": true
      }
    ]
```

| Field        | Required | Meaning                                                       |
| ------------ | -------- | ------------------------------------------------------------- |
| `name`       | yes      | Shown as the row title                                        |
| `namespace`  | yes      | Namespace of the service or pod                               |
| `service`    | one of   | Service to forward to; the pod is resolved from it            |
| `pod`        | one of   | Pod to forward to, when there is no service                   |
| `localPort`  | yes      | Port on your machine                                          |
| `targetPort` | yes      | Port on the pod                                               |
| `autoStart`  | no       | `true` starts it on entering the cluster. Absent means no.    |
| `id`         | no       | Stable identifier; derived from the fields above when omitted |

From the list, **Share with team** writes a forward into the ConfigMap, and **Rename** changes its
name there. Both read the current content before writing, so a colleague's change is not
overwritten.

### Permissions

Reading the shared list needs `get` on that ConfigMap. Sharing, renaming and toggling auto-start
need `update`. The **Create** button needs `create` on configmaps, and on namespaces when the
namespace is missing. Everything degrades to a clear message plus a copyable manifest, so read-only
users are not stuck.

## Install

Download the tarball from the [latest release](https://github.com/ondrab1/headlamp-port-forwards/releases)
and install it through Headlamp's plugin manager, or extract it into the plugin directory yourself.

To build from source instead:

```bash
npm install
npm run build
```

`npm start` does both continuously and copies into place on every change — the target is
`~/Library/Application Support/Headlamp/plugins/<plugin-name>/` on macOS,
`~/.config/Headlamp/plugins/<plugin-name>/` elsewhere.

Headlamp reads plugins at startup, so **restart the app** to pick up a new build. The plugin logs
its build stamp to the console on load, and shows it in its settings page, so you can tell which
build is running.

## Releasing

```bash
npm run build
npm run package-release
```

`package-release` stages the build under the package name before packaging. Running
`headlamp-plugin package` directly would name the folder inside the tarball after this repository
instead, and Headlamp would then load the release next to a development build rather than replacing
it — two copies of the plugin at once.

Attach the tarball to a GitHub release, then put its printed sha256 into `artifacthub-pkg.yml`
together with the release URL. ArtifactHub is what feeds Headlamp's in-app plugin catalog.

## Development

```bash
npm start     # watch, build and install on change
npm test      # unit tests
npm run tsc   # type check (strict)
npm run lint  # eslint, no warnings allowed
npm run i18n  # extract translatable strings
```

The logic that decides what a row is — whether it is configured, shared, auto-starting, running —
lives in `src/forwards.ts` with no React or Headlamp imports, and is covered by `src/forwards.test.ts`.
Keep it that way: the awkward bugs in this plugin were all cases of two parts of the UI reaching
different conclusions about the same forward.

Port forwarding only works in the desktop app, so the page is unavailable in the browser build —
same as Headlamp's own.

## Reference

- [Headlamp plugin docs](https://headlamp.dev/docs/latest/development/plugins/)
- [Plugin API reference](https://headlamp.dev/docs/latest/development/api/)
