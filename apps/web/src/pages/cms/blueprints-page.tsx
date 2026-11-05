import { Trans, useLingui } from "@lingui/react/macro";
import type { AgentBlueprint } from "@rakazo/contracts";
import { SPEC_BLUEPRINT_TEMPLATE } from "@rakazo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Spinner,
  Textarea,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";

/** The editor's state: `id` is set when editing an existing blueprint. */
interface BlueprintDraft {
  id?: string;
  name: string;
  description: string;
  instructions: string;
  referenceNames: string[];
}

const MAX_REFERENCES = 10;

function draftOf(blueprint: AgentBlueprint): BlueprintDraft {
  return {
    id: blueprint.id,
    name: blueprint.name,
    description: blueprint.description,
    instructions: blueprint.instructions,
    referenceNames: blueprint.referenceNames.length > 0 ? blueprint.referenceNames : [""],
  };
}

const EMPTY_DRAFT: BlueprintDraft = {
  name: "",
  description: "",
  instructions: "",
  referenceNames: [""],
};

const SPEC_DRAFT: BlueprintDraft = {
  name: SPEC_BLUEPRINT_TEMPLATE.name,
  description: SPEC_BLUEPRINT_TEMPLATE.description,
  instructions: SPEC_BLUEPRINT_TEMPLATE.instructions,
  referenceNames: [...SPEC_BLUEPRINT_TEMPLATE.referenceNames],
};

export function BlueprintsPage() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const blueprints = useQuery(queries.cms.blueprints.list.queryOptions());
  const [draft, setDraft] = useState<BlueprintDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AgentBlueprint | null>(null);

  const rows = blueprints.data ?? [];

  async function save(input: BlueprintDraft) {
    const body = {
      name: input.name.trim(),
      description: input.description.trim(),
      instructions: input.instructions.trim(),
      referenceNames: input.referenceNames.map((name) => name.trim()).filter(Boolean),
    };
    setBusy(true);
    try {
      if (input.id) await rpc.cms.blueprints.update({ id: input.id, ...body });
      else await rpc.cms.blueprints.create(body);
      await queryClient.invalidateQueries({ queryKey: queries.cms.blueprints.list.key() });
      setDraft(null);
    } catch (err) {
      toast.error(errorText(err, t`Could not save blueprint`));
    } finally {
      setBusy(false);
    }
  }

  async function remove(blueprint: AgentBlueprint) {
    setPendingDelete(null);
    try {
      await rpc.cms.blueprints.delete({ id: blueprint.id });
      await queryClient.invalidateQueries({ queryKey: queries.cms.blueprints.list.key() });
    } catch (err) {
      toast.error(errorText(err, t`Could not delete blueprint`));
    }
  }

  return (
    <section aria-label={t`Blueprints`} className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {rows.length === 0 ? (
          <Button variant="outline" size="sm" onClick={() => setDraft(SPEC_DRAFT)}>
            <Trans>Use Spec template</Trans>
          </Button>
        ) : null}
        <Button size="sm" onClick={() => setDraft(EMPTY_DRAFT)}>
          <Plus />
          <Trans>New blueprint</Trans>
        </Button>
      </div>

      <SettingsGroup>
        {rows.length === 0 ? (
          <SettingsRow label={<span className="text-muted-foreground">No blueprints yet</span>} />
        ) : (
          rows.map((blueprint) => (
            <SettingsRow
              key={blueprint.id}
              label={
                <div className="min-w-0">
                  <div className="truncate">{blueprint.name}</div>
                  {blueprint.referenceNames.length > 0 ? (
                    <div className="truncate text-[12.5px] text-muted-foreground">
                      {blueprint.referenceNames.join(" · ")}
                    </div>
                  ) : null}
                </div>
              }
              control={
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon-sm" aria-label={t`Blueprint actions`} />
                    }
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setDraft(draftOf(blueprint))}>
                      <Pencil />
                      <Trans>Edit</Trans>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setPendingDelete(blueprint)}
                    >
                      <Trash2 />
                      <Trans>Delete</Trans>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
            />
          ))
        )}
      </SettingsGroup>

      <BlueprintEditor
        draft={draft}
        busy={busy}
        onClose={() => setDraft(null)}
        onSave={(input) => void save(input)}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Delete this blueprint?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>This cannot be undone.</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pendingDelete && void remove(pendingDelete)}
            >
              <Trans>Delete</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function BlueprintEditor({
  draft,
  busy,
  onClose,
  onSave,
}: {
  draft: BlueprintDraft | null;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: BlueprintDraft) => void;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100%-2rem)] overflow-y-auto sm:max-w-xl">
        {draft ? (
          <BlueprintForm
            key={draft.id ?? "new"}
            initial={draft}
            busy={busy}
            onCancel={onClose}
            onSave={onSave}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function BlueprintForm({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial: BlueprintDraft;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: BlueprintDraft) => void;
}) {
  const { t } = useLingui();
  const [values, setValues] = useState(initial);
  const canSave = values.name.trim() !== "" && values.instructions.trim() !== "" && !busy;

  function setReference(index: number, name: string) {
    setValues({
      ...values,
      referenceNames: values.referenceNames.map((item, i) => (i === index ? name : item)),
    });
  }

  function removeReference(index: number) {
    const next = values.referenceNames.filter((_, i) => i !== index);
    setValues({ ...values, referenceNames: next.length > 0 ? next : [""] });
  }

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSave(values);
      }}
    >
      <DialogHeader>
        <DialogTitle>{values.id ? t`Edit blueprint` : t`New blueprint`}</DialogTitle>
      </DialogHeader>

      <div className="space-y-2">
        <Label htmlFor="blueprint-name">
          <Trans>Name</Trans>
        </Label>
        <Input
          id="blueprint-name"
          value={values.name}
          maxLength={80}
          onChange={(event) => setValues({ ...values, name: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="blueprint-description">
          <Trans>Description</Trans>
        </Label>
        <Input
          id="blueprint-description"
          value={values.description}
          maxLength={300}
          onChange={(event) => setValues({ ...values, description: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="blueprint-instructions">
          <Trans>Instructions</Trans>
        </Label>
        <Textarea
          id="blueprint-instructions"
          value={values.instructions}
          rows={14}
          maxLength={20_000}
          onChange={(event) => setValues({ ...values, instructions: event.target.value })}
        />
      </div>

      <div className="space-y-2">
        <Label>
          <Trans>Reference documents</Trans>
        </Label>
        {values.referenceNames.map((name, index) => (
          <div key={index} className="flex gap-2">
            <Input
              aria-label={t`Reference document ${index + 1}`}
              value={name}
              maxLength={80}
              placeholder="Design Approval"
              onChange={(event) => setReference(index, event.target.value)}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t`Remove reference document ${index + 1}`}
              onClick={() => removeReference(index)}
            >
              <X />
            </Button>
          </div>
        ))}
        {values.referenceNames.length < MAX_REFERENCES ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setValues({ ...values, referenceNames: [...values.referenceNames, ""] })}
          >
            <Plus />
            <Trans>Add reference</Trans>
          </Button>
        ) : null}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          <Trans>Cancel</Trans>
        </Button>
        <Button type="submit" disabled={!canSave}>
          {busy ? <Spinner /> : null}
          <Trans>Save</Trans>
        </Button>
      </DialogFooter>
    </form>
  );
}
