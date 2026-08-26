import { Icon } from '@iconify/react';
import { useTranslation } from '@kinvolk/headlamp-plugin/lib';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControlLabel,
} from '@mui/material';
import React from 'react';

export interface ConfirmDeleteDialogProps {
  open: boolean;
  /** What the forward points at, so the user can see what they are deleting. */
  target: string;
  /** Name the forward is listed under, when it has one. */
  label?: string;
  /** Set when the forward comes from the shared ConfigMap. */
  shared?: {
    /** namespace/name of the ConfigMap, so the user knows what gets rewritten. */
    location: string;
    /** False when the ConfigMap cannot be written from here. */
    writable: boolean;
  };
  onCancel: () => void;
  /** @param unshare whether to remove the entry from the shared ConfigMap too. */
  onConfirm: (unshare: boolean) => void;
}

/**
 * Confirms deleting a forward, and lets a shared one be un-shared in the same
 * step.
 *
 * A shared forward used to be undeletable from here: Delete stopped it, the next
 * poll read the ConfigMap again and the row came straight back, so the only way
 * out was editing the ConfigMap by hand. It is deletable now, but behind an
 * explicit opt-in - that write hits everyone on the team, and nobody should
 * drop a colleague's forward by reaching for the same button they use for their
 * own.
 */
export function ConfirmDeleteDialog({
  open,
  target,
  label,
  shared,
  onCancel,
  onConfirm,
}: ConfirmDeleteDialogProps) {
  const { t } = useTranslation();
  const [unshare, setUnshare] = React.useState(false);

  // Never carried over from the previous forward: the checkbox arms a write that
  // affects the whole team, so it starts unchecked every time.
  React.useEffect(() => {
    if (open) {
      setUnshare(false);
    }
  }, [open]);

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle>{t('Delete port forward')}</DialogTitle>
      <DialogContent>
        <DialogContentText>{label ? `${label} — ${target}` : target}</DialogContentText>

        {shared && (
          <Box mt={2}>
            <Alert severity="warning" icon={<Icon icon="mdi:account-group-outline" width="20" />}>
              {`${t('Shared with the team in ConfigMap')} ${shared.location}`}
            </Alert>

            {shared.writable ? (
              <FormControlLabel
                sx={{ mt: 1 }}
                control={
                  <Checkbox
                    color="error"
                    checked={unshare}
                    onChange={event => setUnshare(event.target.checked)}
                  />
                }
                label={t('Also remove it from the shared ConfigMap, for everyone')}
              />
            ) : (
              <DialogContentText sx={{ mt: 1 }} variant="body2">
                {t(
                  'The shared ConfigMap is not writable from here, so the forward stays listed after deleting it.'
                )}
              </DialogContentText>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t('Cancel')}</Button>
        <Button variant="contained" color="error" onClick={() => onConfirm(unshare)}>
          {unshare ? t('Delete for everyone') : t('Delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
