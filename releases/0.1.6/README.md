<p align="center">
  <img src="https://raw.githubusercontent.com/ondrab1/headlamp-port-forwards/v0.1.6/docs/logo.png" alt="Persistent Port Forwards logo" width="160">
</p>

<h1 align="center">Persistent Port Forwards</h1>

<p align="center">
  A <a href="https://headlamp.dev">Headlamp</a> plugin for port forwards that survive a restart,
  start themselves, and can be shared with your team through a ConfigMap.
</p>

<p align="center">
  <a href="https://github.com/ondrab1/headlamp-port-forwards/actions/workflows/ci.yml"><img src="https://github.com/ondrab1/headlamp-port-forwards/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/ondrab1/headlamp-port-forwards/releases/latest"><img src="https://img.shields.io/github/v/release/ondrab1/headlamp-port-forwards?label=release" alt="Latest release"></a>
  <a href="https://github.com/ondrab1/headlamp-port-forwards/blob/v0.1.6/LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="Apache-2.0"></a>
  <img src="https://img.shields.io/badge/Headlamp-%E2%89%A5%200.30-informational" alt="Headlamp 0.30 or newer">
</p>

Headlamp can already start a port forward, but it forgets everything: after a restart you re-create
each one by hand, and there is no way to hand a colleague the set of forwards a project needs. This
plugin replaces the Port Forwarding page with one that remembers, auto-starts and shares.

![Port Forwarding list](https://raw.githubusercontent.com/ondrab1/headlamp-port-forwards/v0.1.6/docs/port-forwarding-list.png)

## Features

- **One-click Resume** for a stopped forward, on its original port. When it targets a Service the
  pod is resolved again first, so it still works after the pod was replaced — which is exactly when
  the built-in Start fails.
- **Persistent forwards.** Pin a forward and the plugin re-creates it on the next start. Kept in the
  plugin settings, per cluster.
- **Shared forwards.** A ConfigMap in the cluster holds the forwards the whole team should have.
  Everyone pointing the plugin at it sees the same list.
- **Auto-start, opt-in per forward.** Anything without the flag is listed as stopped and waits for
  you.
- **Names that mean something.** `RabbitMQ Management` as the row title, with `rabbitmq-cluster`
  underneath.
- **Bulk Resume and Stop** for selected rows, and a **running count in the app bar** with progress
  while forwards are starting.
- **Clickable local ports** while a forward runs, greyed with the reason while it does not.

## Requirements

- Headlamp **0.30 or newer**, **desktop app**, on Linux, macOS or Windows. Port forwarding is not
  available in the browser build, so the page is disabled there — same as Headlamp's own.
- Nothing at all for persistent forwards and auto-start; they live in the local plugin settings.
- For shared forwards, access to one ConfigMap — see [Permissions](#permissions).

## Install

In Headlamp Desktop, open the Plugin Catalog, search for _Persistent Port Forwards_ and click
Install. Alternatively, download the tarball from the
[latest release](https://github.com/ondrab1/headlamp-port-forwards/releases) and install it through
the plugin manager.

Headlamp reads plugins at startup, so **restart the app** afterwards.

To build from source instead:

```bash
npm install
npm run build
```

## Sharing through a ConfigMap

The shared list lives in the cluster rather than behind a URL. It needs no hosting, is read through
the same authenticated path as everything else, and is not subject to CORS — a raw file URL from
GitLab or similar is blocked by the browser unless it sends `Access-Control-Allow-Origin`.

Point the plugin at a namespace and name in its settings. If the ConfigMap does not exist yet,
**Create** makes it (and its namespace, when that is missing too). Without permission to write, you
get the manifest to hand over.

![Plugin settings](https://raw.githubusercontent.com/ondrab1/headlamp-port-forwards/v0.1.6/docs/plugin-settings.png)

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

From the list, **Share with team** writes a forward into the ConfigMap and **Rename** changes its
name there. **Delete** asks for confirmation, and for a shared forward it offers to remove the entry
from the ConfigMap as well — unchecked by default, since that takes it away from everyone. Without
it, the forward is only stopped and the next refresh lists it again. All of these read the current
content before writing, so a colleague's change is not overwritten.

### Permissions

| Action                                             | Needs on the shared ConfigMap                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------- |
| Reading the shared list                            | `get`                                                                   |
| Sharing, renaming, un-sharing, toggling auto-start | `update`                                                                |
| The **Create** button                              | `create` on configmaps, and on namespaces when the namespace is missing |

Everything degrades to a clear message plus a copyable manifest, so read-only users are not stuck.

## License

[Apache-2.0](https://github.com/ondrab1/headlamp-port-forwards/blob/v0.1.6/LICENSE)
