import { K8s } from '@kinvolk/headlamp-plugin/lib';

/**
 * An error from the cluster proxy, as something worth showing a user.
 *
 * The status is appended because the message on its own is often meaningless:
 * the proxy reads a failed response's body as JSON to find a message, and the
 * port forward endpoints answer in plain text, so parsing fails and every
 * non-ok status arrives as the literal "Unreachable" - which reads as a network
 * problem no matter whether the real answer was 404 or 500. The status is on the
 * error all along, it was just never shown.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }

  const status = (err as { status?: number }).status;
  return status ? `${err.message} (HTTP ${status})` : err.message;
}

export function getService(
  cluster: string,
  namespace: string,
  serviceName: string
): Promise<K8s.service.KubeService> {
  return new Promise((resolve, reject) => {
    (K8s.ResourceClasses.Service.apiEndpoint as any).get(
      namespace,
      serviceName,
      (service: K8s.service.KubeService) => resolve(service),
      (err: any) => reject(err),
      undefined,
      cluster
    );
  });
}

export function getPods(cluster: string, namespace: string): Promise<K8s.pod.KubePod[]> {
  return new Promise((resolve, reject) => {
    (K8s.ResourceClasses.Pod.apiEndpoint as any).list(
      namespace,
      (pods: K8s.pod.KubePod[]) => resolve(pods),
      (err: any) => reject(err),
      undefined,
      cluster
    );
  });
}

/** Documents the format of the ConfigMap's port-forwards.json for hand editing. */
export function getSharedPortsExampleJSON(): string {
  return `[
  {
    "name": "Redis Cache",
    "namespace": "cache",
    "service": "redis-master",
    "localPort": 6379,
    "targetPort": 6379,
    "autoStart": true
  }
]`;
}

/**
 * Determines whether the app runs inside Electron.
 *
 * Port forwarding is only available there, which is why Headlamp disables its
 * own /portforwards route outside Electron. We mirror that so replacing the
 * route does not make the page reachable where it cannot work.
 */
export function isElectron(): boolean {
  const proc = (window as any)?.process;
  if (proc?.type === 'renderer') {
    return true;
  }
  return navigator?.userAgent?.indexOf('Electron') >= 0;
}

/**
 * isDockerDesktop checks if ddClient is available in the window object.
 *
 * Headlamp's own helper lives at lib/helpers/isDockerDesktop, but deep imports
 * below lib/<Module> are mangled by the plugin bundler's externals mapping, so
 * we replicate the (trivial) check here.
 */
export function isDockerDesktop(): boolean {
  return (window as any)?.ddClient !== undefined;
}

/** The bind address Headlamp uses when starting a port forward. */
export function getForwardAddress(): string {
  return isDockerDesktop() ? '0.0.0.0' : 'localhost';
}

/**
 * Finds a running pod backing the given service.
 *
 * Stopped port forwards remember the pod they were bound to, but that pod is
 * often gone by the time the forward is resumed. When the forward targets a
 * service we can look the pod up again.
 *
 * @returns the resolved pod name, or fallbackPod when it cannot be resolved.
 */
export async function resolvePodForService(
  cluster: string,
  namespace: string,
  serviceName: string,
  fallbackPod?: string
): Promise<string | undefined> {
  try {
    const service = await getService(cluster, namespace, serviceName);
    const selector = service?.spec?.selector;
    if (!selector) {
      return fallbackPod;
    }

    const pods = await getPods(cluster, namespace);
    const runningPod = pods.find((pod: K8s.pod.KubePod) => {
      const labels = pod.metadata?.labels || {};
      return (
        pod.status?.phase === 'Running' &&
        Object.entries(selector).every(([key, value]) => labels[key] === value)
      );
    });

    return runningPod?.metadata?.name || fallbackPod;
  } catch (err) {
    console.error(`Failed to resolve pod for service ${serviceName}:`, err);
    return fallbackPod;
  }
}
