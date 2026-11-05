import { createFileRoute } from "@tanstack/react-router";
import { StudioList, StudioShell } from "@/components/studio-view";

export const Route = createFileRoute("/studio/")({
  component: StudioHome,
});

function StudioHome() {
  return (
    <StudioShell>{() => <StudioList />}</StudioShell>
  );
}
