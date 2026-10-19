import { redirect } from "next/navigation";
import { NoteView } from "../../components/NoteView";
import { sessionNotePage } from "../../lib/notePageSession";

export default async function SessionNote({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle } = await params;
  const session = await sessionNotePage(handle);
  if (!session) redirect("/");
  return (
    <NoteView
      noteKey={session.key}
      persist={session.persist}
      noteBinding={session.binding}
    />
  );
}
