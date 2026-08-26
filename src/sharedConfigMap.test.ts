import { describe, expect, it, vi } from 'vitest';

// Only the ConfigMap resource class is touched by the functions under test, and
// none of these exercise an actual request.
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { ResourceClasses: { ConfigMap: { apiEndpoint: {} } } },
}));

// Reached via ./forwards; the real module boots the whole Redux store.
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  PORT_FORWARD_RUNNING_STATUS: 'Running',
  PORT_FORWARD_STOP_STATUS: 'Stopped',
}));

import {
  buildSharedConfigMap,
  buildSharedConfigMapYaml,
  mergeSharedForward,
  parseSharedConfigMap,
  removeSharedForwardFrom,
  renameSharedForwardIn,
  SHARED_DATA_KEY,
  sharedForwardIdentity,
} from './sharedConfigMap';

const FORWARDS = [
  {
    name: 'ZNZ MSSQL Database',
    namespace: 'wpjshop-prod-fragranza',
    service: 'wg-tunnel',
    localPort: 1433,
    targetPort: 1433,
    autoStart: true,
  },
];

function configMap(data: Record<string, string>) {
  return { data } as any;
}

describe('parseSharedConfigMap', () => {
  it('reads the documented key', () => {
    const cm = configMap({ [SHARED_DATA_KEY]: JSON.stringify(FORWARDS) });
    expect(parseSharedConfigMap(cm)).toEqual(FORWARDS);
  });

  it('falls back to the only key present', () => {
    // A ConfigMap someone created by hand under a different key still works.
    const cm = configMap({ 'ports.json': JSON.stringify(FORWARDS) });
    expect(parseSharedConfigMap(cm)).toEqual(FORWARDS);
  });

  it('does not guess when several keys are present', () => {
    const cm = configMap({ a: '[]', b: '[]' });
    expect(() => parseSharedConfigMap(cm)).toThrow(SHARED_DATA_KEY);
  });

  it('rejects a payload that is not an array', () => {
    const cm = configMap({ [SHARED_DATA_KEY]: '{"nope": true}' });
    expect(() => parseSharedConfigMap(cm)).toThrow('not a JSON array');
  });

  it('reports invalid JSON rather than returning nothing', () => {
    // The whole point of surfacing errors: a typo must not look like "empty".
    const cm = configMap({ [SHARED_DATA_KEY]: '[{,]' });
    expect(() => parseSharedConfigMap(cm)).toThrow();
  });

  it('throws on an empty ConfigMap', () => {
    expect(() => parseSharedConfigMap(configMap({}))).toThrow(SHARED_DATA_KEY);
  });
});

describe('buildSharedConfigMap', () => {
  it('produces a body the API server can accept', () => {
    const body = buildSharedConfigMap({ namespace: 'headlamp', name: 'shared' }, FORWARDS);

    expect(body).toMatchObject({
      kind: 'ConfigMap',
      apiVersion: 'v1',
      metadata: { name: 'shared', namespace: 'headlamp' },
    });
    expect(JSON.parse(body.data[SHARED_DATA_KEY])).toEqual(FORWARDS);
  });

  it('round-trips through parseSharedConfigMap', () => {
    const body = buildSharedConfigMap({ namespace: 'ns', name: 'n' }, FORWARDS);
    expect(parseSharedConfigMap(body as any)).toEqual(FORWARDS);
  });

  it('creates an empty list for a fresh bootstrap', () => {
    const body = buildSharedConfigMap({ namespace: 'ns', name: 'n' }, []);
    expect(parseSharedConfigMap(body as any)).toEqual([]);
  });
});

describe('buildSharedConfigMapYaml', () => {
  const yaml = buildSharedConfigMapYaml({ namespace: 'headlamp', name: 'shared' }, FORWARDS);

  it('names the resource where the user asked for it', () => {
    expect(yaml).toContain('kind: ConfigMap');
    expect(yaml).toContain('  name: shared');
    expect(yaml).toContain('  namespace: headlamp');
  });

  it('indents the block scalar consistently', () => {
    // A mis-indented block scalar is invalid YAML, and this manifest is meant to
    // be pasted straight into a cluster.
    const lines = yaml.split('\n');
    const blockStart = lines.findIndex(l => l.includes(`${SHARED_DATA_KEY}: |`));
    const body = lines.slice(blockStart + 1).filter(l => l.trim());

    expect(body.length).toBeGreaterThan(0);
    body.forEach(line => expect(line.startsWith('    ')).toBe(true));
  });

  it('embeds the forwards verbatim', () => {
    expect(yaml).toContain('"ZNZ MSSQL Database"');
    expect(yaml).toContain('"autoStart": true');
  });

  it('ends with a newline', () => {
    expect(yaml.endsWith('\n')).toBe(true);
  });
});

describe('mergeSharedForward', () => {
  const colleague = {
    name: 'Redis',
    namespace: 'cache',
    service: 'redis',
    localPort: 6379,
    targetPort: 6379,
  };
  const mine = {
    name: 'Mine',
    namespace: 'ns',
    service: 'wg',
    localPort: 8443,
    targetPort: 8443,
  };

  it('keeps what is already shared', () => {
    // Regression: the caller used to pass its own cached list, so an entry a
    // colleague added between polls was silently dropped on the next share.
    expect(mergeSharedForward([colleague], mine)).toEqual([colleague, mine]);
  });

  it('appends onto an empty list', () => {
    expect(mergeSharedForward([], mine)).toEqual([mine]);
  });

  it('replaces an entry that resolves to the same id instead of duplicating it', () => {
    const updated = { ...mine, name: 'Renamed' };
    const result = mergeSharedForward([colleague, mine], updated);

    expect(result).toEqual([colleague, updated]);
    expect(result.filter(pf => pf.service === 'wg')).toHaveLength(1);
  });

  it('treats entries differing only in local port as distinct', () => {
    const other = { ...mine, name: 'Alt', localPort: 18443 };
    expect(mergeSharedForward([mine], other)).toHaveLength(2);
  });

  it('respects an explicit id over the derived one', () => {
    const a = { ...mine, id: 'fixed-a' };
    const b = { ...mine, id: 'fixed-b' };
    expect(mergeSharedForward([a], b)).toEqual([a, b]);
  });
});

describe('buildSharedConfigMapYaml with a missing namespace', () => {
  const yaml = buildSharedConfigMapYaml({ namespace: 'headlamp', name: 'shared' }, FORWARDS, true);

  it('prepends a Namespace document', () => {
    expect(yaml.startsWith('apiVersion: v1\nkind: Namespace')).toBe(true);
    expect(yaml).toContain('  name: headlamp');
  });

  it('separates the two documents', () => {
    const docs = yaml.split('\n---\n');
    expect(docs).toHaveLength(2);
    expect(docs[1]).toContain('kind: ConfigMap');
  });

  it('omits the Namespace document by default', () => {
    expect(buildSharedConfigMapYaml({ namespace: 'ns', name: 'n' }, [])).not.toContain(
      'kind: Namespace'
    );
  });
});

describe('renameSharedForwardIn', () => {
  const rabbit = {
    name: 'rabbitmq-cluster',
    namespace: 'rabbitmq',
    service: 'rabbitmq-cluster',
    localPort: 15672,
    targetPort: 15672,
  };
  const mssql = {
    name: 'wg-tunnel',
    namespace: 'ns',
    service: 'wg-tunnel',
    localPort: 1433,
    targetPort: 1433,
  };

  it('renames only the addressed entry', () => {
    const result = renameSharedForwardIn(
      [rabbit, mssql],
      sharedForwardIdentity(rabbit),
      'RabbitMQ Management'
    );

    expect(result[0].name).toBe('RabbitMQ Management');
    expect(result[1].name).toBe('wg-tunnel');
  });

  it('keeps everything else about the entry', () => {
    const [renamed] = renameSharedForwardIn([rabbit], sharedForwardIdentity(rabbit), 'New');
    expect(renamed).toEqual({ ...rabbit, name: 'New' });
  });

  it('does not confuse entries differing only in local port', () => {
    const alt = { ...mssql, localPort: 11433, name: 'alt' };
    const result = renameSharedForwardIn([mssql, alt], sharedForwardIdentity(alt), 'ZNZ MSSQL');

    expect(result[0].name).toBe('wg-tunnel');
    expect(result[1].name).toBe('ZNZ MSSQL');
  });

  it('leaves the list untouched when nothing matches', () => {
    const result = renameSharedForwardIn([rabbit], 'no-such-key', 'X');
    expect(result).toEqual([rabbit]);
  });

  it('survives a round trip through the ConfigMap encoding', () => {
    const renamed = renameSharedForwardIn([rabbit], sharedForwardIdentity(rabbit), 'ZNZ MSSQL db');
    const body = buildSharedConfigMap({ namespace: 'ns', name: 'n' }, renamed);
    expect(parseSharedConfigMap(body as any)[0].name).toBe('ZNZ MSSQL db');
  });
});

describe('removeSharedForwardFrom', () => {
  const rabbit = {
    name: 'RabbitMQ Management',
    namespace: 'rabbitmq',
    service: 'rabbitmq-cluster',
    localPort: 15672,
    targetPort: 15672,
  };
  const mssql = {
    name: 'ZNZ MSSQL Database',
    namespace: 'ns',
    service: 'wg-tunnel',
    localPort: 1433,
    targetPort: 1433,
  };

  it('drops only the addressed entry', () => {
    const result = removeSharedForwardFrom([rabbit, mssql], sharedForwardIdentity(rabbit));
    expect(result).toEqual([mssql]);
  });

  it('does not take a colleague’s forward down with it', () => {
    // Two forwards to the same service on different local ports are a pair the
    // list shows side by side, so the key has to tell them apart - deleting one
    // must not silently unshare the other.
    const alt = { ...mssql, localPort: 11433, name: 'alt' };
    const result = removeSharedForwardFrom([mssql, alt], sharedForwardIdentity(alt));
    expect(result).toEqual([mssql]);
  });

  it('leaves the list untouched when nothing matches', () => {
    expect(removeSharedForwardFrom([rabbit], 'no-such-key')).toEqual([rabbit]);
  });

  it('survives a round trip through the ConfigMap encoding', () => {
    const remaining = removeSharedForwardFrom([rabbit, mssql], sharedForwardIdentity(rabbit));
    const body = buildSharedConfigMap({ namespace: 'ns', name: 'n' }, remaining);
    expect(parseSharedConfigMap(body as any)).toEqual([mssql]);
  });
});
