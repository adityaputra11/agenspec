import { Trans, useLingui } from "@lingui/react/macro";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Spinner,
  toast,
} from "@rakazo/ui-web";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { SettingsGroup, SettingsRow } from "../../components/SettingsRows";
import { useSpaceQueries } from "../../lib/query";
import { rpc } from "../../lib/rpc";
import { errorText } from "../../lib/user-error";
import {
  DOCUMENT_ACCEPT,
  documentMimeType,
  documentTypeBadge,
  formatDate,
  formatSize,
  readBase64,
} from "./shared";

interface DocumentRow {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export function DocumentsPage() {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const queryClient = useQueryClient();
  const documents = useQuery(queries.cms.documents.list.queryOptions());
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DocumentRow | null>(null);

  async function upload(file: File) {
    const mimeType = documentMimeType(file.name);
    if (!mimeType) {
      toast.error(t`Use a PDF, TXT or Markdown file`);
      return;
    }
    setBusy(true);
    try {
      const contentBase64 = await readBase64(file);
      await rpc.cms.documents.upload({ name: file.name, mimeType, contentBase64 });
      await queryClient.invalidateQueries({ queryKey: queries.cms.documents.list.key() });
    } catch (err) {
      toast.error(errorText(err, t`Could not upload this file`));
    } finally {
      setBusy(false);
    }
  }

  async function remove(document: DocumentRow) {
    setPendingDelete(null);
    try {
      await rpc.cms.documents.delete({ id: document.id });
      await queryClient.invalidateQueries({ queryKey: queries.cms.documents.list.key() });
    } catch (err) {
      toast.error(errorText(err, t`Could not delete this file`));
    }
  }

  const rows = documents.data ?? [];

  return (
    <section
      aria-label={t`Documents`}
      className={`rounded-xl ${dragging ? "ring-2 ring-ring" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file && !busy) void upload(file);
      }}
    >
      <SettingsGroup>
        <SettingsRow
          label={<span className="text-muted-foreground">PDF, Markdown or text</span>}
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? <Spinner /> : <Upload />}
              <Trans>Upload</Trans>
            </Button>
          }
        />
        {rows.length === 0 ? (
          <SettingsRow label={<span className="text-muted-foreground">No documents yet</span>} />
        ) : (
          rows.map((document) => (
            <SettingsRow
              key={document.id}
              label={
                <div className="min-w-0">
                  <div className="truncate">{document.name}</div>
                  <div className="text-[12.5px] text-muted-foreground">
                    {documentTypeBadge(document.mimeType)} · {formatSize(document.sizeBytes)} ·{" "}
                    {formatDate(document.createdAt)}
                  </div>
                </div>
              }
              control={
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button variant="ghost" size="icon-sm" aria-label={t`Document actions`} />
                    }
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setPendingDelete(document)}
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
      <input
        ref={inputRef}
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="hidden"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void upload(file);
        }}
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
              <Trans>Delete this document?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>Bots stop reading it.</Trans>
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
