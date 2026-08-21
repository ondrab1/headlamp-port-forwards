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

export interface NameForwardDialogProps {
  open: boolean;
  /** Shown as the dialog title, so the same dialog serves naming and renaming. */
  title: string;
  /** What the forward points at, to remind the user what they are naming. */
  target: string;
  initialName: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

/** Asks for the human-readable name of a forward. */
export function NameForwardDialog({
  open,
  title,
  target,
  initialName,
  confirmLabel,
  onCancel,
  onConfirm,
}: NameForwardDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = React.useState(initialName);

  React.useEffect(() => {
    if (open) {
      setName(initialName);
    }
  }, [open, initialName]);

  const trimmed = name.trim();

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{target}</DialogContentText>
        <TextField
          fullWidth
          margin="normal"
          label={t('Name')}
          value={name}
          placeholder="RabbitMQ Management"
          onChange={event => setName(event.target.value)}
          helperText={t('Shown in the port forwards list instead of the service name.')}
          onKeyDown={event => {
            if (event.key === 'Enter' && trimmed) {
              onConfirm(trimmed);
            }
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t('Cancel')}</Button>
        <Button variant="contained" disabled={!trimmed} onClick={() => onConfirm(trimmed)}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
