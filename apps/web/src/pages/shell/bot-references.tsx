import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, BotReference } from "@rakazo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import { DOCUMENT_ACCEPT, documentMimeType, readBase64 } from "../cms/shared";

/** Two seconds while any reference is still being indexed; otherwise the list is fetched once. */
const PROCESSING_POLL_MS = 2_000;

/** The documents a blueprint bot reads, one per slot its blueprint names. */
export function BotReferences({ bot }: { bot: Bot }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const blueprints = useQuery(queries.blueprints.list.queryOptions());
  const slots =
    blueprints.data?.find((blueprint) => blueprint.id === bot.blueprintId)?.referenceNames ?? [];
  const referencesKey = queries.blueprints.references.list.queryKey({
    input: { botId: bot.id },
  });
  const references = useQuery({
    ...queries.blueprints.references.list.queryOptions({ input: { botId: bot.id } }),
    refetchInterval: (query) =>
      query.state.data?.some((reference) => reference.status === "processing")
        ? PROCESSING_POLL_MS
        : false,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const targetSlot = useRef<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<BotReference | null>(null);

  function pickFile(slot: string) {
    targetSlot.current = slot;
    inputRef.current?.click();
  }

  async function upload(slot: string, file: File) {
    const mimeType = documentMimeType(file.name);
    if (!mimeType) {
      toast.error(t`Use a PDF, TXT or Markdown file`);
      return;
    }
    setBusySlot(slot);
    try {
      const contentBase64 = await readBase64(file);
      await rpc.blueprints.references.upload({
        botId: bot.id,
        referenceName: slot,
        name: file.name,
        mimeType,
        contentBase64,
      });
      await queryClient.invalidateQueries({ queryKey: referencesKey });
    } catch (err) {
      toast.error(errorText(err, t`Could not upload this file`));
    } finally {
      setBusySlot(null);
    }
  }

  async function remove(reference: BotReference) {
    setPendingRemove(null);
    try {
      await rpc.blueprints.references.remove({ botId: bot.id, id: reference.id });
      await queryClient.invalidateQueries({ queryKey: referencesKey });
    } catch (err) {
      toast.error(errorText(err, t`Could not remove this file`));
    }
  }

  if (slots.length === 0) return null;
  const rows = references.data ?? [];

  return (
    <>
      <SettingsGroup title={<Trans>References</Trans>} data-testid="bot-references">
        {slots.map((slot) => {
          const reference = rows.find((item) => item.referenceName === slot);
          const busy = busySlot === slot;
          return (
            <SettingsRow
              key={slot}
              label={
                <div className="min-w-0">
                  <div className="truncate">{slot}</div>
                  {reference ? (
                    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
                      <span className="truncate">{reference.name}</span>
                      <ReferenceStatus reference={reference} />
                    </div>
                  ) : (
                    <div className="text-[12.5px] text-muted-foreground">
                      <Trans>Missing</Trans>
                    </div>
                  )}
                </div>
              }
              control={
                reference ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t`Reference actions`}
                          disabled={busy}
                        />
                      }
                    >
                      <MoreHorizontal />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => pickFile(slot)}>
                        <Trans>Replace</Trans>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setPendingRemove(reference)}
                      >
                        <Trans>Remove</Trans>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => pickFile(slot)}
                  >
                    {busy ? <Spinner /> : <Upload />}
                    <Trans>Upload</Trans>
                  </Button>
                )
              }
            />
          );
        })}
      </SettingsGroup>
      <input
        ref={inputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          const slot = targetSlot.current;
          event.target.value = "";
          if (file && slot) void upload(slot, file);
        }}
      />
      <AlertDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Remove this file?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>The bot stops reading it.</Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pendingRemove && void remove(pendingRemove)}
            >
              <Trans>Remove</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ReferenceStatus({ reference }: { reference: BotReference }) {
  if (reference.status === "processing") {
    return (
      <Badge variant="secondary">
        <Spinner />
        <Trans>Processing</Trans>
      </Badge>
    );
  }
  if (reference.status === "failed") {
    return (
      <Badge variant="destructive" title={reference.error ?? undefined}>
        <Trans>Failed</Trans>
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <Trans>Ready</Trans>
    </Badge>
  );
}
