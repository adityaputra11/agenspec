import { Trans, useLingui } from "@lingui/react/macro";
import type { Bot, Group, GroupPerson } from "@rakazo/contracts";
import {
  GROUP_INSTRUCTIONS_MAX_LENGTH,
  GROUP_MEMBER_MAX,
  GROUP_MEMBER_MIN,
  GROUP_NAME_MAX_LENGTH,
} from "@rakazo/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  BotAvatar,
  Button,
  Checkbox,
  Input,
  SectionHeading,
  Textarea,
} from "@rakazo/ui-web";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { errorText } from "../lib/user-error";
import { DeleteItemDialog } from "./shell/dialogs";

function validSelection(name: string, selected: readonly string[]) {
  return (
    Boolean(name.trim()) &&
    selected.length >= GROUP_MEMBER_MIN &&
    selected.length <= GROUP_MEMBER_MAX
  );
}

function sameMembers(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function MemberPicker({
  bots,
  selected,
  onChange,
  onOpenBot,
  initiallyExpanded = false,
}: {
  bots: Bot[];
  selected: string[];
  onChange: (selected: string[]) => void;
  onOpenBot?: (botId: string) => void;
  initiallyExpanded?: boolean;
}) {
  const { t } = useLingui();
  const listId = useId();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [query, setQuery] = useState("");
  // Every bot ever picked this session stays listed when collapsed, so an
  // unchecked member remains re-checkable until the form is saved.
  const [everPicked, setEverPicked] = useState<ReadonlySet<string>>(() => new Set(selected));
  const selectable = useMemo(() => bots.filter((bot) => !bot.archivedAt), [bots]);
  // The filter field only exists in the expanded view; never let a stale
  // query hide members when the list is collapsed.
  const needle = expanded ? query.trim().toLowerCase() : "";
  const visible = useMemo(() => {
    const base = expanded ? selectable : selectable.filter((bot) => everPicked.has(bot.id));
    if (!needle) return base;
    return base.filter((bot) => bot.name.toLowerCase().includes(needle));
  }, [expanded, selectable, everPicked, needle]);

  function toggle(botId: string) {
    if (selected.includes(botId)) {
      onChange(selected.filter((id) => id !== botId));
    } else if (selected.length < GROUP_MEMBER_MAX) {
      setEverPicked((current) => new Set(current).add(botId));
      onChange([...selected, botId]);
    }
  }

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          <Trans>Members ({selected.length})</Trans>
        </span>
        <Button
          variant="text"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
          className="font-normal"
        >
          {expanded ? <Trans>Show selected</Trans> : <Trans>Show all</Trans>}
        </Button>
      </div>
      {expanded ? (
        <>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t`Filter bots`}
            aria-label={t`Filter bots`}
            className="mt-2"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            <Trans>
              Pick {GROUP_MEMBER_MIN}–{GROUP_MEMBER_MAX}
            </Trans>
          </p>
        </>
      ) : null}
      <div id={listId} className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {visible.map((bot) => {
          const checked = selected.includes(bot.id);
          return (
            <div
              key={bot.id}
              className={`flex w-full items-center rounded-xl px-2.5 py-2.5 ${
                checked ? "bg-accent" : "hover:bg-accent"
              }`}
            >
              <button
                type="button"
                onClick={() => onOpenBot?.(bot.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-start"
              >
                <BotAvatar
                  avatarSet={bot.avatarSet}
                  color={bot.color}
                  identity={bot.id}
                  size={32}
                  status={bot.status}
                />
                <span className="flex-1 text-[15px] text-foreground" dir="auto">
                  {bot.name}
                </span>
              </button>
              <Checkbox
                checked={checked}
                aria-label={
                  checked ? t`Remove ${bot.name} from the group` : t`Add ${bot.name} to the group`
                }
                onCheckedChange={() => toggle(bot.id)}
              />
            </div>
          );
        })}
        {visible.length === 0 ? (
          <p className="px-2.5 py-2.5 text-sm text-muted-foreground">
            {expanded ? <Trans>No bots match</Trans> : <Trans>No members yet</Trans>}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CreateGroupForm({
  bots,
  onCancel,
  onCreate,
  onOpenBot,
}: {
  bots: Bot[];
  onCancel: () => void;
  onCreate: (input: { name: string; botIds: string[] }) => Promise<void>;
  onOpenBot?: (botId: string) => void;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (submitting || !validSelection(name, selected)) return;
    setSubmitting(true);
    setError(null);
    try {
      await onCreate({ name: name.trim(), botIds: selected });
    } catch (cause) {
      setError(errorText(cause, t`Could not create group`));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          <Trans>New group</Trans>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Cancel new group`}
          onClick={onCancel}
          className="text-muted-foreground"
        >
          <X />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <label htmlFor={nameId} className="block text-sm text-muted-foreground">
        <Trans>Name</Trans>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t`Name this group`}
          maxLength={GROUP_NAME_MAX_LENGTH}
          className="mt-2"
        />
      </label>
      <MemberPicker
        bots={bots}
        selected={selected}
        onChange={setSelected}
        onOpenBot={onOpenBot}
        initiallyExpanded
      />
      <Button
        className="mt-5 w-full"
        disabled={submitting || !validSelection(name, selected)}
        onClick={() => void create()}
      >
        {submitting ? <Trans>Creating…</Trans> : <Trans>Create group</Trans>}
      </Button>
    </div>
  );
}

export function GroupSettings({
  group,
  bots,
  viewerId,
  onSave,
  onSavePeople,
  loadCandidates,
  onRemove,
  onLeave,
  onClose,
  onOpenBot,
  covered = false,
  pages,
}: {
  group: Group;
  bots: Bot[];
  /** The signed-in person. The owner is whoever made the group, or anyone when unknown. */
  viewerId?: string;
  onSave: (input: { name?: string; instructions?: string; botIds?: string[] }) => Promise<void>;
  onSavePeople: (userIds: string[]) => Promise<void>;
  loadCandidates: () => Promise<GroupPerson[]>;
  onRemove: () => Promise<void>;
  onLeave: () => Promise<void>;
  onClose: () => void;
  onOpenBot?: (botId: string) => void;
  /** A full-screen overlay is on top, so Escape belongs to it. */
  covered?: boolean;
  pages?: ReactNode;
}) {
  const { t } = useLingui();
  const nameId = useId();
  const [name, setName] = useState(group.name);
  const instructionsId = useId();
  const [instructions, setInstructions] = useState(group.instructions ?? "");
  const [selected, setSelected] = useState(group.members.map((member) => member.botId));
  const groupPeopleIds = (group.people ?? []).map((person) => person.userId);
  const [peopleIds, setPeopleIds] = useState(groupPeopleIds);
  const [candidates, setCandidates] = useState<GroupPerson[] | null>(null);
  const [addingPeople, setAddingPeople] = useState(false);
  const [peopleQuery, setPeopleQuery] = useState("");
  const peopleListId = useId();
  const isOwner = !group.ownerUserId || group.ownerUserId === viewerId;
  // The panel can open on a cached group. A refreshed one replaces whatever was not edited, so a
  // save does not send the cached name or members back as a change.
  const [shownGroup, setShownGroup] = useState(group);
  if (group !== shownGroup) {
    setShownGroup(group);
    if (name === shownGroup.name) setName(group.name);
    if (instructions === (shownGroup.instructions ?? "")) setInstructions(group.instructions ?? "");
    const shownMembers = shownGroup.members.map((member) => member.botId);
    if (sameMembers(selected, shownMembers)) {
      setSelected(group.members.map((member) => member.botId));
    }
    const shownPeopleIds = (shownGroup.people ?? []).map((person) => person.userId);
    if (sameMembers(peopleIds, shownPeopleIds)) setPeopleIds(groupPeopleIds);
  }
  const knownPeople = useMemo(
    () =>
      new Map(
        [...(group.people ?? []), ...(candidates ?? [])].map((person) => [person.userId, person]),
      ),
    [group.people, candidates],
  );
  const shownPeople = peopleIds.flatMap((id) => {
    const person = knownPeople.get(id);
    return person ? [person] : [];
  });
  const peopleNeedle = peopleQuery.trim().toLowerCase();
  const matchingCandidates = (candidates ?? []).filter(
    (person) =>
      !peopleNeedle ||
      person.name.toLowerCase().includes(peopleNeedle) ||
      (person.email ?? "").toLowerCase().includes(peopleNeedle),
  );
  const peopleChanged = !sameMembers(peopleIds, groupPeopleIds);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Closing while a save is in flight would let its completion close the panel
  // again after a reopen. While a confirmation or an overlay is open,
  // Escape belongs to it.
  useEffect(() => {
    if (saving || confirmingDelete || confirmingLeave || covered) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing &&
        event.keyCode !== 229
      ) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, confirmingDelete, confirmingLeave, covered, onClose]);

  async function togglePeoplePicker() {
    const opening = !addingPeople;
    setAddingPeople(opening);
    if (!opening || candidates) return;
    try {
      setCandidates(await loadCandidates());
    } catch (cause) {
      setError(errorText(cause, t`Could not load people`));
    }
  }

  function togglePerson(userId: string) {
    setPeopleIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim() !== group.name ? name.trim() : undefined,
        instructions:
          instructions.trim() !== (group.instructions ?? "").trim()
            ? instructions.trim()
            : undefined,
        botIds: sameMembers(
          selected,
          group.members.map((member) => member.botId),
        )
          ? undefined
          : selected,
      });
    } catch (cause) {
      setError(errorText(cause, t`Could not save group`));
      setSaving(false);
      return;
    }
    if (peopleChanged) {
      try {
        await onSavePeople(peopleIds);
      } catch (cause) {
        setError(errorText(cause, t`Could not update people`));
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    // A save that finishes after the user switched chats must not close
    // whatever panel is open there.
    if (mounted.current) onClose();
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          <Trans>Group settings</Trans>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t`Close panel`}
          disabled={saving}
          onClick={onClose}
        >
          <X size={16} strokeWidth={1.8} />
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <label htmlFor={nameId} className="block text-sm text-muted-foreground">
        <Trans>Name</Trans>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={GROUP_NAME_MAX_LENGTH}
          disabled={!isOwner}
          className="mt-2"
        />
      </label>
      <label htmlFor={instructionsId} className="mt-4 block text-sm text-muted-foreground">
        <Trans>Instructions</Trans>
        <Textarea
          id={instructionsId}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          maxLength={GROUP_INSTRUCTIONS_MAX_LENGTH}
          placeholder={t`What every bot here should do`}
          rows={3}
          disabled={!isOwner}
          className="mt-2 max-h-60 resize-none field-sizing-content"
        />
      </label>
      {isOwner ? (
        <MemberPicker
          bots={bots}
          selected={selected}
          onChange={setSelected}
          onOpenBot={onOpenBot}
        />
      ) : (
        <div className="mt-5">
          <span className="text-sm text-muted-foreground">
            <Trans>Members ({group.members.length})</Trans>
          </span>
          <ul className="mt-2 space-y-1">
            {group.members.map((member) => (
              <li key={member.botId} className="px-2.5 py-2 text-[15px] text-foreground" dir="auto">
                {member.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      <section className="mt-5">
        <div className="flex items-center justify-between">
          <SectionHeading variant="label">
            <Trans>People</Trans>
          </SectionHeading>
          {isOwner ? (
            <Button
              variant="text"
              aria-expanded={addingPeople}
              aria-controls={peopleListId}
              onClick={() => void togglePeoplePicker()}
              className="font-normal"
            >
              <Trans>Add people</Trans>
            </Button>
          ) : null}
        </div>
        <div id={peopleListId} className="mt-2 space-y-1">
          {shownPeople.map((person) => (
            <div key={person.userId} className="flex items-center gap-2 px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] text-foreground" dir="auto">
                  {person.name}
                </div>
                {person.email ? (
                  <div className="truncate text-sm text-muted-foreground">{person.email}</div>
                ) : null}
              </div>
              {isOwner ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t`Remove ${person.name}`}
                  disabled={saving}
                  onClick={() => togglePerson(person.userId)}
                  className="text-muted-foreground"
                >
                  <X size={16} strokeWidth={1.8} />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        {isOwner && addingPeople ? (
          <div className="mt-2">
            <Input
              value={peopleQuery}
              onChange={(event) => setPeopleQuery(event.target.value)}
              placeholder={t`Search people`}
              aria-label={t`Search people`}
            />
            <div className="mt-2 max-h-60 space-y-1 overflow-y-auto">
              {matchingCandidates.map((person) => {
                const checked = peopleIds.includes(person.userId);
                return (
                  <div
                    key={person.userId}
                    className={`flex items-center gap-2 rounded-xl px-2.5 py-2 ${
                      checked ? "bg-accent" : "hover:bg-accent"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[15px] text-foreground" dir="auto">
                        {person.name}
                      </div>
                      {person.email ? (
                        <div className="truncate text-sm text-muted-foreground">{person.email}</div>
                      ) : null}
                    </div>
                    <Checkbox
                      checked={checked}
                      aria-label={
                        checked
                          ? t`Remove ${person.name} from the group`
                          : t`Add ${person.name} to the group`
                      }
                      onCheckedChange={() => togglePerson(person.userId)}
                    />
                  </div>
                );
              })}
              {candidates && matchingCandidates.length === 0 ? (
                <p className="px-2.5 py-2 text-sm text-muted-foreground">
                  <Trans>No people match</Trans>
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>
      {isOwner ? (
        <Button
          className="mt-5 w-full"
          disabled={saving || !validSelection(name, selected)}
          onClick={() => void save()}
        >
          {saving ? <Trans>Saving…</Trans> : <Trans>Save</Trans>}
        </Button>
      ) : null}
      {pages ? (
        <section className="mt-6">
          <SectionHeading variant="label" className="mb-2">
            <Trans>Pages</Trans>
          </SectionHeading>
          {pages}
        </section>
      ) : null}
      {isOwner ? (
        <Button
          variant="destructive"
          className="mt-4 w-full"
          disabled={saving}
          onClick={() => setConfirmingDelete(true)}
        >
          <Trans>Delete group</Trans>
        </Button>
      ) : (
        <Button
          variant="destructive"
          className="mt-4 w-full"
          disabled={saving}
          onClick={() => setConfirmingLeave(true)}
        >
          <Trans>Leave group</Trans>
        </Button>
      )}
      {confirmingDelete ? (
        <DeleteItemDialog
          item={group}
          noun="group"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={onRemove}
        />
      ) : null}
      {confirmingLeave ? (
        <LeaveGroupDialog onCancel={() => setConfirmingLeave(false)} onConfirm={onLeave} />
      ) : null}
    </div>
  );
}

function LeaveGroupDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useLingui();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !leaving) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            <Trans>Leave this group?</Trans>
          </AlertDialogTitle>
          <AlertDialogDescription>
            <Trans>You stop seeing its messages.</Trans>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-[13.5px] text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={leaving}>
            <Trans>Cancel</Trans>
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={leaving}
            onClick={() => {
              setLeaving(true);
              setError(null);
              void onConfirm().catch((cause: unknown) => {
                setError(errorText(cause, t`Could not leave group`));
                setLeaving(false);
              });
            }}
          >
            <Trans>Leave group</Trans>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
