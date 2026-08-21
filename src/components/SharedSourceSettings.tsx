import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import React from 'react';
import {
  buildSharedConfigMapYaml,
  createSharedConfigMap,
  DEFAULT_SHARED_CONFIG_MAP,
  loadSharedForwards,
  namespaceExists,
  SHARED_DATA_KEY,
} from '../sharedConfigMap';
import { SharedConfigMapRef, SharedForwardsResult } from '../types';

export interface SharedSourceSettingsProps {
  cluster: string;
  configMap?: SharedConfigMapRef;
  onChange: (ref: SharedConfigMapRef | undefined) => void;
}

/**
 * Configures and bootstraps the in-cluster source of shared forwards.
 *
 * The point of the Create button is that nobody has to hand-write a ConfigMap
 * to get started. It goes through the normal cluster API, so it simply fails
 * with a permission error for users who may only read - and the copyable
 * manifest is there for them to pass on.
 */
export function SharedSourceSettings({ cluster, configMap, onChange }: SharedSourceSettingsProps) {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<SharedForwardsResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  // Only meaningful once we know the ConfigMap is missing, so the Create button
  // can say whether it is also about to create a namespace.
  const [nsMissing, setNsMissing] = React.useState(false);

  const namespace = configMap?.namespace ?? '';
  const name = configMap?.name ?? '';
  const isConfigured = !!namespace && !!name;

  const probe = React.useCallback(() => {
    if (!cluster || !namespace || !name) {
      setStatus(null);
      return;
    }
    loadSharedForwards(cluster, { sharedConfigMap: { namespace, name } }).then(async result => {
      setStatus(result);
      setNsMissing(result.missing ? !(await namespaceExists(cluster, namespace)) : false);
    });
  }, [cluster, namespace, name]);

  React.useEffect(probe, [probe]);

  function update(patch: Partial<SharedConfigMapRef>) {
    const next = { namespace, name, ...patch };
    onChange(next.namespace || next.name ? next : undefined);
  }

  async function handleCreate() {
    setBusy(true);
    try {
      await createSharedConfigMap(cluster, { namespace, name }, []);
      probe();
    } catch (err) {
      setStatus({
        forwards: [],
        error: `${t('Could not create the ConfigMap')}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyYaml() {
    await navigator.clipboard.writeText(
      buildSharedConfigMapYaml({ namespace, name }, status?.forwards ?? [], nsMissing)
    );
    setCopied(true);
  }

  function renderStatus() {
    if (!isConfigured) {
      return (
        <Alert severity="info" sx={{ mt: 2 }}>
          {t('Set a namespace and name to read shared forwards from the cluster.')}
        </Alert>
      );
    }

    if (!status) {
      return null;
    }

    if (status.missing) {
      return (
        <Alert
          severity="warning"
          sx={{ mt: 2 }}
          action={
            <Stack direction="row" spacing={1}>
              <Button size="small" disabled={busy} onClick={handleCreate}>
                {nsMissing ? t('Create namespace + ConfigMap') : t('Create')}
              </Button>
              <Button size="small" onClick={handleCopyYaml}>
                {copied ? t('Copied') : t('Copy YAML')}
              </Button>
            </Stack>
          }
        >
          {nsMissing
            ? `${t('Neither this ConfigMap nor the namespace')} "${namespace}" ${t('exist yet.')}`
            : t('This ConfigMap does not exist yet.')}
        </Alert>
      );
    }

    if (status.forbidden) {
      return (
        <Alert
          severity="error"
          sx={{ mt: 2 }}
          action={
            <Button size="small" onClick={handleCopyYaml}>
              {copied ? t('Copied') : t('Copy YAML')}
            </Button>
          }
        >
          {`${status.error}. ${t('Ask whoever administers the cluster to apply it.')}`}
        </Alert>
      );
    }

    if (status.error) {
      return (
        <Alert severity="error" sx={{ mt: 2 }}>
          {status.error}
        </Alert>
      );
    }

    return (
      <Alert severity="success" sx={{ mt: 2 }}>
        {`${status.forwards.length} ${t('shared forward(s) found')}`}
      </Alert>
    );
  }

  return (
    <Box mt={3}>
      <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
        {t('Shared forwards from the cluster')}
      </Typography>
      <Typography variant="body2" color="textSecondary">
        {t('Read from a ConfigMap through the cluster API, so it needs no external hosting.')}
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
        <TextField
          label={t('Namespace')}
          value={namespace}
          placeholder={DEFAULT_SHARED_CONFIG_MAP.namespace}
          onChange={e => update({ namespace: e.target.value.trim() })}
          fullWidth
          size="small"
        />
        <TextField
          label={t('ConfigMap name')}
          value={name}
          placeholder={DEFAULT_SHARED_CONFIG_MAP.name}
          onChange={e => update({ name: e.target.value.trim() })}
          fullWidth
          size="small"
          helperText={`${t('Definitions live under the key')} ${SHARED_DATA_KEY}`}
        />
      </Stack>

      {!isConfigured && (
        <Button
          size="small"
          startIcon={<Icon icon="mdi:auto-fix" />}
          sx={{ mt: 1 }}
          onClick={() => onChange({ ...DEFAULT_SHARED_CONFIG_MAP })}
        >
          {`${t('Use suggested')}: ${DEFAULT_SHARED_CONFIG_MAP.namespace}/${
            DEFAULT_SHARED_CONFIG_MAP.name
          }`}
        </Button>
      )}

      {renderStatus()}
    </Box>
  );
}
