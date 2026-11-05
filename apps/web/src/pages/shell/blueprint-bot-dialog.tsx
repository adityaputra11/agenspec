import { Trans, useLingui } from "@lingui/react/macro";
import type { AgentBlueprintSummary, Bot } from "@rakazo/contracts";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
} from "@rakazo/ui-web";
import { useRef, useState } from "react";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

/** Mounted only while open. The parent passes at least one blueprint and unmounts it from `onCancel` or `onCreated`. */
export function BlueprintBotDialog({
  blueprints,
  onCancel,
  onCreated,
}: {
  blueprints: AgentBlueprintSummary[];
  onCancel: () => void;
  onCreated: (bot: Bot) => Promise<void>;
}) {
  const { t } = useLingui();
  const nameRef = useRef<HTMLInputElement>(null);
  const [blueprintId, setBlueprintId] = useState(blueprints[0]?.id ?? "");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  async function create() {
    if (!trimmed || !blueprintId || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const bot = await rpc.blueprints.createBot({ blueprintId, name: trimmed });
      await onCreated(bot);
    } catch (err) {
      setError(errorText(err, t`Could not create bot`));
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !submitting) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        initialFocus={nameRef}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        data-testid="blueprint-bot-dialog"
      >
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-center">
              <Trans>New from blueprint</Trans>
            </DialogTitle>
          </DialogHeader>
          {blueprints.length > 1 ? (
            <NativeSelect
              aria-label={t`Blueprint`}
              value={blueprintId}
              disabled={submitting}
              onChange={(event) => setBlueprintId(event.target.value)}
            >
              {blueprints.map((blueprint) => (
                <NativeSelectOption key={blueprint.id} value={blueprint.id}>
                  {blueprint.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : null}
          <Input
            ref={nameRef}
            aria-label={t`Name`}
            placeholder={t`Name`}
            value={name}
            disabled={submitting}
            onChange={(event) => setName(event.target.value)}
          />
          {error ? (
            <p role="alert" className="text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
              <Trans>Cancel</Trans>
            </Button>
            <Button type="submit" disabled={!trimmed || !blueprintId || submitting}>
              <Trans>Create</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
