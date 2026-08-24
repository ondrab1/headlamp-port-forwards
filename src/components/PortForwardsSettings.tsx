import { Icon } from '@iconify/react';
import { K8s, useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Switch,
  Typography,
  useTheme,
} from '@mui/material';
import React, { useEffect, useState } from 'react';
import { loadSharedForwards } from '../sharedConfigMap';
import { removePersistentForward, setAutoStart, store } from '../store';
import { SharedConfigMapRef } from '../types';
import { PluginSettingsData, SharedPortForward } from '../types';
import { getSharedPortsExampleJSON } from '../utils';
import { PLUGIN_BUILD } from '../version';
import { SharedSourceSettings } from './SharedSourceSettings';

export function PortForwardsSettings(props: any) {
  const { t } = useTranslation();
  const { onDataChange } = props;
  // Headlamp snapshots the settings data once on mount and only commits it on
  // Save, so props.data goes stale as soon as the port forwards list writes to
  // the store - and saving that snapshot would undo those writes. Render from
  // the live store instead, and keep the draft in sync on every change.
  const data: PluginSettingsData = store.useConfig()() || {};
  const clusters = K8s.useClustersConf() || {};
  const theme = useTheme();
  const [externalForwards, setExternalForwards] = useState<{
    [clusterName: string]: SharedPortForward[];
  }>({});
  const [selectedCluster, setSelectedCluster] = useState<string>('');

  useEffect(() => {
    const clusterNames = Object.keys(clusters);
    if (clusterNames.length > 0 && !selectedCluster) {
      setSelectedCluster(clusterNames[0]);
    }
  }, [clusters, selectedCluster]);

  useEffect(() => {
    async function fetchExternal() {
      for (const clusterName in data?.clusters) {
        const clusterConfig = data.clusters[clusterName];
        if (!clusterConfig?.sharedConfigMap) {
          continue;
        }

        // Same resolver the list and the auto-starter use, so this section can
        // never disagree with them about what is shared.
        const { forwards } = await loadSharedForwards(clusterName, clusterConfig);

        setExternalForwards(prev => ({
          ...prev,
          [clusterName]: forwards,
        }));
      }
    }

    // Fire and forget: each cluster's result lands via setExternalForwards.
    void fetchExternal();
  }, [data]);

  /**
   * Hands Headlamp the config we just wrote, so its Save button cannot later
   * commit an older snapshot over it.
   */
  function syncDraft() {
    if (typeof onDataChange === 'function') {
      onDataChange(store.get());
    }
  }

  function handleConfigMapChange(clusterName: string, ref: SharedConfigMapRef | undefined) {
    const current = store.get() || {};
    const newData: PluginSettingsData = {
      ...current,
      clusters: {
        ...(current.clusters || {}),
        [clusterName]: {
          ...(current.clusters?.[clusterName] || {}),
          sharedConfigMap: ref,
        },
      },
    };

    store.set(newData);
    syncDraft();
  }

  // Both take the entry itself rather than its id. Not every stored entry has
  // one - a shared forward deliberately has no id - and passing `undefined`
  // matched every id-less entry at once, so deleting one of them removed the lot.
  function handleAutoStartChange(
    clusterName: string,
    entry: SharedPortForward,
    autoStart: boolean
  ) {
    setAutoStart(clusterName, entry, autoStart);
    syncDraft();
  }

  function handleDeletePersistent(clusterName: string, entry: SharedPortForward) {
    // Applied straight away: waiting for the Save button made deleting look
    // like it did nothing, and the stale draft could bring the entry back.
    removePersistentForward(clusterName, entry);
    syncDraft();
  }

  // Defaulted to arrays so lengths can be compared without optional chaining
  // producing `number | undefined`.
  const localForwards: SharedPortForward[] = selectedCluster
    ? data?.clusters?.[selectedCluster]?.persistentForwards ?? []
    : [];
  const externalList: SharedPortForward[] = selectedCluster
    ? externalForwards[selectedCluster] ?? []
    : [];

  return (
    <Box p={2}>
      <Typography variant="h6">{t('Port Forwards Configuration')}</Typography>
      <Typography variant="caption" color="textSecondary">
        {`build ${PLUGIN_BUILD}`}
      </Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        {t(
          'Share port-forwards with your team through a ConfigMap, or manage your locally saved persistent ones.'
        )}
      </Typography>
      <Accordion
        variant="outlined"
        sx={{
          mt: 2,
          mb: 2,
          backgroundColor: theme.palette.mode === 'dark' ? '#333' : '#f5f5f5',
          '&:before': { display: 'none' },
        }}
      >
        <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
          <Typography variant="subtitle2">{t('Example ConfigMap content')}</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <pre style={{ fontSize: '0.8rem', overflow: 'auto', margin: 0 }}>
            {getSharedPortsExampleJSON()}
          </pre>
        </AccordionDetails>
      </Accordion>
      <Divider sx={{ my: 3 }} />
      {Object.values(clusters).length === 0 ? (
        <Typography color="textSecondary">
          {t('No clusters found. Check your connection.')}
        </Typography>
      ) : (
        <>
          <FormControl fullWidth sx={{ mb: 4 }}>
            <InputLabel id="cluster-select-label">{t('Select Cluster')}</InputLabel>
            <Select
              labelId="cluster-select-label"
              id="cluster-select"
              value={selectedCluster}
              label={t('Select Cluster')}
              onChange={e => setSelectedCluster(e.target.value as string)}
            >
              {Object.values(clusters).map((cluster: any) => (
                <MenuItem key={cluster.name} value={cluster.name}>
                  {cluster.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {selectedCluster && clusters[selectedCluster] && (
            <Paper key={selectedCluster} variant="outlined" sx={{ p: 3, mb: 4, borderRadius: 2 }}>
              <Box display="flex" alignItems="center" mb={2}>
                <Icon
                  icon="mdi:kubernetes"
                  width="24"
                  height="24"
                  style={{ marginRight: '8px', color: theme.palette.primary.main }}
                />
                <Typography variant="h6">
                  {t('Cluster: {{ cluster }}', { cluster: selectedCluster })}
                </Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />

              <SharedSourceSettings
                cluster={selectedCluster}
                configMap={data?.clusters?.[selectedCluster]?.sharedConfigMap}
                onChange={ref => handleConfigMapChange(selectedCluster, ref)}
              />

              {localForwards.length + externalList.length > 0 && (
                <Box mt={3}>
                  <Typography
                    variant="subtitle2"
                    color="textSecondary"
                    gutterBottom
                    sx={{
                      fontWeight: 'bold',
                      textTransform: 'uppercase',
                      fontSize: '0.75rem',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {t('Configured Port Forwards')}
                  </Typography>
                  <List
                    dense
                    sx={{ border: `1px solid ${theme.palette.divider}`, borderRadius: 1, p: 0 }}
                  >
                    {/* Local persistent forwards */}
                    {localForwards.map((pf: SharedPortForward, index: number) => (
                      <React.Fragment key={`local-${pf.id || pf.name}`}>
                        {index > 0 && <Divider />}
                        <ListItem
                          secondaryAction={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <FormControlLabel
                                sx={{ mr: 0 }}
                                control={
                                  <Switch
                                    size="small"
                                    checked={pf.autoStart === true}
                                    onChange={e =>
                                      handleAutoStartChange(
                                        selectedCluster,
                                        pf,
                                        e.target.checked
                                      )
                                    }
                                  />
                                }
                                label={<Typography variant="caption">{t('Auto-start')}</Typography>}
                              />
                              <IconButton
                                edge="end"
                                aria-label="delete"
                                onClick={() => handleDeletePersistent(selectedCluster, pf)}
                                size="small"
                              >
                                <Icon icon="mdi:delete" />
                              </IconButton>
                            </Box>
                          }
                        >
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                  {pf.id || pf.name}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    backgroundColor: theme.palette.action.selected,
                                    px: 1,
                                    borderRadius: 1,
                                    fontSize: '0.65rem',
                                  }}
                                >
                                  {t('Local')}
                                </Typography>
                              </Box>
                            }
                            secondary={`${pf.namespace}/${pf.pod || pf.service} : ${
                              pf.targetPort
                            } -> ${pf.localPort || 'auto'}`}
                          />
                        </ListItem>
                      </React.Fragment>
                    ))}
                    {/* External forwards from URL */}
                    {externalList.map((pf: SharedPortForward, idx: number) => (
                      <React.Fragment key={`external-${idx}`}>
                        {(idx > 0 || localForwards.length > 0) && <Divider />}
                        <ListItem
                          secondaryAction={
                            <Typography
                              variant="caption"
                              color={pf.autoStart === true ? 'success.main' : 'textSecondary'}
                            >
                              {pf.autoStart === true ? t('Auto-start on') : t('Auto-start off')}
                            </Typography>
                          }
                        >
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                  {pf.name}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    backgroundColor: theme.palette.info.light,
                                    color: theme.palette.info.contrastText,
                                    px: 1,
                                    borderRadius: 1,
                                    fontSize: '0.65rem',
                                  }}
                                >
                                  {t('External')}
                                </Typography>
                              </Box>
                            }
                            secondary={`${pf.namespace}/${pf.pod || pf.service} : ${
                              pf.targetPort
                            } -> ${pf.localPort || 'auto'}`}
                          />
                        </ListItem>
                      </React.Fragment>
                    ))}
                  </List>
                </Box>
              )}
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
