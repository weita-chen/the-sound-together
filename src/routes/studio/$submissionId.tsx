import { createFileRoute } from "@tanstack/react-router";
import { StudioProfile, StudioShell } from "@/components/studio-view";

export const Route = createFileRoute("/studio/$submissionId")({
  component: StudioPerson,
});

function StudioPerson() {
  const { submissionId } = Route.useParams();
  return (
    <StudioShell>{() => <StudioProfile id={submissionId} />}</StudioShell>
  );
}
