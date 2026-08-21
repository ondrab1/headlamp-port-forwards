import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';
import React from 'react';
import { PortForwardEntry } from '../types';

export interface StartOnPortDialogProps {
  /** The forward to start, or null when the dialog is closed. */
  portForward: PortForwardEntry | null;
  onCancel: () => void;
  onConfirm: (port: string) => void;
}

/**
 * Asks for a local port before starting a forward.
 *
 * Headlamp ships its own dialog for this, but it lives below
 * lib/components/, which the plugin bundler cannot resolve.
 */
export function StartOnPortDialog({ portForward, onCancel, onConfirm }: StartOnPortDialogProps) {
  const { t } = useTranslation();
  const [port, setPort] = React.useState('');

  React.useEffect(() => {
    setPort(portForward?.port || '');
  }, [portForward]);

  const target = portForward ? portForward.service || portForward.pod : '';
  const isValid = /^\d+$/.test(port) && Number(port) > 0 && Number(port) < 65536;

  return (
    <Dialog open={!!portForward} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{t('Start port forward')}</DialogTitle>
      <DialogContent>
        <DialogContentText>
          {t('Forwarding {{ target }}:{{ targetPort }} to a local port.', {
            target,
            targetPort: portForward?.targetPort || '',
          })}
        </DialogContentText>
        <TextField
          fullWidth
          margin="normal"
          label={t('Local port')}
          value={port}
          onChange={event => setPort(event.target.value.trim())}
          error={port !== '' && !isValid}
          helperText={t('Leave the suggested port or pick another free one.')}
          onKeyDown={event => {
            if (event.key === 'Enter' && isValid) {
              onConfirm(port);
            }
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t('Cancel')}</Button>
        <Button variant="contained" disabled={!isValid} onClick={() => onConfirm(port)}>
          {t('Start')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
